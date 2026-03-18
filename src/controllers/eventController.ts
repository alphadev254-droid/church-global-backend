import { Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import prisma from '../lib/prisma';
import { getAccessibleChurchIds } from '../lib/churchScope';
import { generateTicketPDF } from '../lib/ticketPDF';
import { groupByDateRanges } from '../lib/dateGrouping';

const baseEventSchema = z.object({
  title: z.string().min(1, 'Title required'),
  description: z.string().optional().default(''),
  date: z.string().min(1, 'Date required'),
  endDate: z.string().min(1, 'End date required'),
  time: z.string().min(1, 'Time required'),
  location: z.string().min(1, 'Location required'),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().optional(),
  type: z.enum(['service', 'meeting', 'conference', 'outreach', 'fellowship']),
  status: z.enum(['upcoming', 'ongoing', 'completed', 'cancelled']).optional().default('upcoming'),
  attendeeCount: z.number().optional().default(0),
  churchId: z.string().min(1, 'Church ID required'),
  requiresTicket: z.boolean().optional().default(false),
  isFree: z.boolean().optional().default(true),
  ticketPrice: z.number().nullable().optional(),
  currency: z.enum(['MWK', 'KSH']).optional(),
  totalTickets: z.number().optional(),
  ticketSalesCutoff: z.string().optional(),
  allowPublicTicketing: z.boolean().optional().default(false),
  imageUrl: z.string().nullable().optional(),
});

const eventSchema = baseEventSchema.refine(data => new Date(data.endDate) >= new Date(data.date), {
  message: 'End date must be on or after start date',
  path: ['endDate'],
});

const bookTicketSchema = z.object({
  eventId: z.string().min(1),
  memberId: z.string().optional(),
  paymentMethod: z.enum(['cash', 'mobile_money', 'card', 'bank_transfer']).optional().default('cash'),
  reference: z.string().optional(),
  amount: z.number().optional(),
  currency: z.enum(['MWK', 'KSH']).optional(),
  transactionStatus: z.enum(['pending', 'completed', 'failed']).optional().default('completed'),
  ticketStatus: z.enum(['confirmed', 'pending', 'cancelled', 'used']).optional().default('confirmed'),
  notes: z.string().optional(),
  useExistingTransaction: z.boolean().optional(),
  existingTransactionId: z.string().optional(),
});

export async function getEvents(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role ?? 'member';
  const filterChurchId = req.query.churchId as string | undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  let churchIds: string[] = [];

  if (roleName === 'member') {
    // Members only see events from their own church
    if (!churchId) {
      res.status(400).json({ success: false, message: 'No church assigned' });
      return;
    }
    churchIds = [churchId];
  } else if (roleName === 'ministry_admin') {
    // National admin sees events from their churches
    const churches = await prisma.church.findMany({
      where: { ministryAdminId: userId },
      select: { id: true }
    });
    churchIds = churches.map(c => c.id);
  } else {
    // Other roles use existing scope logic
    if (!churchId) {
      res.status(400).json({ success: false, message: 'churchId required' });
      return;
    }
    churchIds = await getAccessibleChurchIds(roleName, churchId, req.user?.districts, req.user?.traditionalAuthorities, req.user?.regions, userId);
  }

  // Apply church filter if provided
  if (filterChurchId) {
    // Ensure the filtered church is in the accessible churches
    if (churchIds.includes(filterChurchId)) {
      churchIds = [filterChurchId];
    } else {
      // User doesn't have access to this church
      res.json({ success: true, data: [] });
      return;
    }
  }

  const whereClause: any = { churchId: { in: churchIds } };
  
  // Apply date filters
  if (startDate) {
    whereClause.date = { ...whereClause.date, gte: new Date(startDate) };
  }
  if (endDate) {
    const endDateTime = new Date(endDate);
    endDateTime.setHours(23, 59, 59, 999);
    whereClause.date = { ...whereClause.date, lte: endDateTime };
  }

  const events = await prisma.event.findMany({
    where: whereClause,
    orderBy: { date: 'asc' },
  });

  // Fetch all user tickets in one query
  const eventIds = events.map(e => e.id);
  const userTickets = await prisma.eventTicket.findMany({
    where: { eventId: { in: eventIds }, userId },
    select: { eventId: true, id: true, ticketNumber: true },
  });

  // Create a Map for O(1) lookup
  const ticketMap = new Map(userTickets.map(t => [t.eventId, { id: t.id, ticketNumber: t.ticketNumber }]));

  // Map events with ticket status
  const eventsWithTicketStatus = events.map(event => {
    const ticket = ticketMap.get(event.id);
    return {
      ...event,
      userHasTicket: !!ticket,
      userTicketId: ticket?.id,
      userTicketNumber: ticket?.ticketNumber,
    };
  });

  // Group by date ranges
  const grouped = groupByDateRanges(eventsWithTicketStatus);

  res.json({ success: true, data: grouped });
}

export async function getPublicEvent(req: Request, res: Response): Promise<void> {
  const eventId = String(req.params.id);
  const event = await prisma.event.findUnique({ 
    where: { id: eventId },
    include: {
      church: { select: { name: true } }
    }
  });
  
  if (!event) { 
    res.status(404).json({ success: false, message: 'Event not found' }); 
    return; 
  }
  
  res.json({ success: true, data: event });
}

export async function getEvent(req: Request, res: Response): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
  if (!event) { res.status(404).json({ success: false, message: 'Event not found' }); return; }
  res.json({ success: true, data: event });
}

export async function createEvent(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  
  // Check if user has events_management feature
  const { hasFeature } = await import('../lib/packageChecker');
  if (!(await hasFeature(userId, 'events_management'))) {
    res.status(403).json({ success: false, message: 'Your package does not include Events Management. Please upgrade to access this feature.' });
    return;
  }
  
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, message: parsed.error.errors[0].message }); return; }

  // Check if event requires payment and if Kenya account has subaccount
  if (!parsed.data.isFree && parsed.data.requiresTicket) {
    const { getPaymentGateway } = await import('../utils/gatewayRouter');
    const gateway = await getPaymentGateway(userId);
    
    if (gateway === 'paystack') {
      // Kenya account - check for subaccount
      const subaccount = await prisma.subaccount.findUnique({
        where: { churchId: parsed.data.churchId }
      });
      
      if (!subaccount) {
        res.status(400).json({ 
          success: false, 
          message: 'To create giving campaigns, you need to set up a Paystack subaccount first. Please go to Branches > Finance account management to create your finance account..' 
        });
        return;
      }
    }
  }

  const event = await prisma.event.create({
    data: {
      ...parsed.data,
      date: new Date(parsed.data.date),
      endDate: new Date(parsed.data.endDate),
      ticketSalesCutoff: parsed.data.ticketSalesCutoff && parsed.data.ticketSalesCutoff !== '' 
        ? new Date(parsed.data.ticketSalesCutoff) 
        : null,
      createdById: req.user!.userId,
    },
  });
  res.status(201).json({ success: true, data: event });
}

export async function updateEvent(req: Request, res: Response): Promise<void> {
  const parsed = baseEventSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, message: parsed.error.errors[0].message }); return; }

  const eventId = String(req.params.id);
  const oldEvent = await prisma.event.findUnique({ where: { id: eventId } });
  
  // Delete old image if exists and new imageUrl is different
  if (oldEvent?.imageUrl && parsed.data.imageUrl !== oldEvent.imageUrl) {
    const oldPath = path.join(process.cwd(), oldEvent.imageUrl);
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
  }

  const event = await prisma.event.update({
    where: { id: eventId },
    data: {
      ...parsed.data,
      date: parsed.data.date ? new Date(parsed.data.date) : undefined,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
      ticketSalesCutoff: parsed.data.ticketSalesCutoff !== undefined
        ? (parsed.data.ticketSalesCutoff === '' ? null : new Date(parsed.data.ticketSalesCutoff))
        : undefined,
      totalTickets: parsed.data.totalTickets !== undefined
        ? (parsed.data.totalTickets === 0 ? null : parsed.data.totalTickets)
        : undefined,
      ticketPrice: parsed.data.ticketPrice !== undefined
        ? (parsed.data.ticketPrice === null ? null : parsed.data.ticketPrice)
        : undefined,
    },
  });
  res.json({ success: true, data: event });
}

export async function deleteEvent(req: Request, res: Response): Promise<void> {
  await prisma.event.delete({ where: { id: String(req.params.id) } });
  res.json({ success: true, message: 'Event deleted' });
}

export async function bookTicket(req: Request, res: Response): Promise<void> {
  const parsed = bookTicketSchema.safeParse(req.body);
  if (!parsed.success) { 
    console.log('Validation error:', parsed.error.errors);
    res.status(400).json({ success: false, message: parsed.error.errors[0].message, errors: parsed.error.errors }); 
    return; 
  }

  const { eventId, memberId, paymentMethod, reference } = parsed.data;
  const userId = req.user!.userId;
  const roleName = req.user?.role ?? 'member';
  const churchId = req.user!.churchId;
  
  // If memberId not provided and user is a member, use their own ID
  const targetUserId = !memberId && roleName === 'member' ? userId : memberId;
  
  if (!targetUserId) {
    res.status(400).json({ success: false, message: 'memberId required' });
    return;
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) { res.status(404).json({ success: false, message: 'Event not found' }); return; }
  if (!event.requiresTicket) { res.status(400).json({ success: false, message: 'Event does not require tickets' }); return; }
  if (event.status === 'completed' || event.status === 'cancelled') {
    res.status(400).json({ success: false, message: 'Cannot book tickets for completed or cancelled events' }); return;
  }
  if (event.ticketSalesCutoff && new Date(event.ticketSalesCutoff) < new Date()) {
    res.status(400).json({ success: false, message: 'Ticket sales have ended' }); return;
  }
  if (event.totalTickets && event.ticketsSold >= event.totalTickets) {
    res.status(400).json({ success: false, message: 'Event is sold out' }); return;
  }

  const eventDate = new Date(event.date).toISOString().slice(0, 10).replace(/-/g, '');
  const ticketCount = await prisma.eventTicket.count({ where: { eventId } });
  const eventPrefix = event.title.replace(/\s+/g, '').substring(0, 6).toUpperCase();
  const ticketNumber = `${eventPrefix}-${eventDate}-${String(ticketCount + 1).padStart(4, '0')}`;

  let transactionId = null;
  if (!event.isFree && event.ticketPrice) {
    const transaction = await prisma.transaction.create({
      data: {
        amount: event.ticketPrice,
        currency: event.currency || 'MWK',
        status: 'completed',
        paymentMethod,
        reference,
        userId,
        churchId: churchId!,
        type: 'event_ticket',
      },
    });
    transactionId = transaction.id;
  }

  const ticket = await prisma.eventTicket.create({
    data: { ticketNumber, eventId, userId: targetUserId, transactionId, status: 'confirmed' },
  });

  await prisma.event.update({
    where: { id: eventId },
    data: { ticketsSold: { increment: 1 } },
  });

  res.status(201).json({ success: true, data: ticket });
}

export async function getMyTickets(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const tickets = await prisma.eventTicket.findMany({
    where: { userId },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      createdAt: true,
      transactionId: true,
      eventId: true,
      event: {
        select: {
          title: true,
          date: true,
          time: true,
          location: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: tickets });
}

export async function getEventTickets(req: Request, res: Response): Promise<void> {
  const eventId = String(req.params.id);
  const tickets = await prisma.eventTicket.findMany({
    where: { eventId },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      attended: true,
      attendedAt: true,
      createdAt: true,
      isGuest: true,
      guestName: true,
      guestEmail: true,
      guestPhone: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      transaction: { select: { amount: true, baseAmount: true, currency: true, paymentMethod: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: tickets });
}

export async function markAttendance(req: Request, res: Response): Promise<void> {
  const ticketId = String(req.params.ticketId);
  const { attended } = req.body;

  if (typeof attended !== 'boolean') {
    res.status(400).json({ success: false, message: 'attended must be a boolean' });
    return;
  }

  const ticket = await prisma.eventTicket.update({
    where: { id: ticketId },
    data: {
      attended,
      attendedAt: attended ? new Date() : null,
    },
  });

  res.json({ success: true, data: ticket });
}

export async function createManualTicket(req: Request, res: Response): Promise<void> {
  const eventId = String(req.params.id);
  const parsed = bookTicketSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, message: parsed.error.errors[0].message }); return; }

  const { memberId, paymentMethod, reference, amount, currency, transactionStatus, ticketStatus, notes, useExistingTransaction, existingTransactionId } = parsed.data;
  
  if (!memberId) {
    res.status(400).json({ success: false, message: 'memberId is required for manual ticket creation' });
    return;
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) { res.status(404).json({ success: false, message: 'Event not found' }); return; }
  if (!event.requiresTicket) { res.status(400).json({ success: false, message: 'Event does not require tickets' }); return; }
  if (event.status === 'completed' || event.status === 'cancelled') {
    res.status(400).json({ success: false, message: 'Cannot book tickets for completed or cancelled events' }); return;
  }
  if (event.ticketSalesCutoff && new Date(event.ticketSalesCutoff) < new Date()) {
    res.status(400).json({ success: false, message: 'Ticket sales have ended' }); return;
  }
  if (event.totalTickets && event.ticketsSold >= event.totalTickets) {
    res.status(400).json({ success: false, message: 'Event is sold out' }); return;
  }

  const member = await prisma.user.findUnique({ 
    where: { id: memberId },
    include: { role: true }
  });
  if (!member) { res.status(404).json({ success: false, message: 'Member not found' }); return; }
  if (member.role?.name !== 'member') { res.status(400).json({ success: false, message: 'Selected user is not a member' }); return; }

  const eventDate = new Date(event.date).toISOString().slice(0, 10).replace(/-/g, '');
  const ticketCount = await prisma.eventTicket.count({ where: { eventId } });
  const eventPrefix = event.title.replace(/\s+/g, '').substring(0, 6).toUpperCase();
  const ticketNumber = `${eventPrefix}-${eventDate}-${String(ticketCount + 1).padStart(4, '0')}`;

  let transactionId = null;

  if (useExistingTransaction && existingTransactionId) {
    const existingTransaction = await prisma.transaction.findUnique({ where: { id: existingTransactionId } });
    if (!existingTransaction) { res.status(404).json({ success: false, message: 'Transaction not found' }); return; }
    transactionId = existingTransactionId;
  } else {
    const ticketAmount = amount !== undefined ? amount : (event.isFree ? 0 : event.ticketPrice || 0);
    const ticketCurrency = currency || event.currency || 'MWK';

    if (ticketAmount > 0) {
      const transaction = await prisma.transaction.create({
        data: {
          amount: ticketAmount,
          currency: ticketCurrency,
          status: transactionStatus || 'completed',
          paymentMethod,
          reference: reference || `MANUAL-${Date.now()}`,
          userId: memberId,
          churchId: member.churchId!,
          type: 'event_ticket',
          notes,
          isManual: true,
        },
      });
      transactionId = transaction.id;
    }
  }

  const ticket = await prisma.eventTicket.create({
    data: { 
      ticketNumber, 
      eventId, 
      userId: memberId, 
      transactionId, 
      status: ticketStatus || 'confirmed',
      isManual: true,
    },
    include: { user: { select: { firstName: true, lastName: true, email: true } }, transaction: true },
  });

  await prisma.event.update({
    where: { id: eventId },
    data: { ticketsSold: { increment: 1 } },
  });

  res.status(201).json({ success: true, data: ticket });
}

export async function getTicketTransaction(req: Request, res: Response): Promise<void> {
  const ticketId = String(req.params.ticketId);
  const userId = req.user!.userId;
  const roleName = req.user?.role ?? 'member';
  
  const whereClause = roleName === 'member' 
    ? { id: ticketId, userId } 
    : { id: ticketId };
  
  if (roleName === 'member') {
    const ticket = await prisma.eventTicket.findUnique({
      where: whereClause,
      select: {
        transaction: {
          select: {
            amount: true,
            currency: true,
            paymentMethod: true,
            status: true,
            reference: true,
            paidAt: true,
            channel: true,
            baseAmount: true,
            convenienceFee: true,
            systemFeeAmount: true,
            totalAmount: true,
            gateway: true,
          },
        },
      },
    });
    
    if (!ticket) { 
      res.status(404).json({ success: false, message: 'Forbidden' }); 
      return; 
    }
    
    res.json({ success: true, data: ticket.transaction });
  } else {
    const ticket = await prisma.eventTicket.findUnique({
      where: whereClause,
      select: {
        transaction: {
          select: {
            amount: true,
            currency: true,
            paymentMethod: true,
            status: true,
            reference: true,
            paidAt: true,
            channel: true,
            customerEmail: true,
            customerPhone: true,
            type: true,
            isManual: true,
            notes: true,
            createdAt: true,
            subaccountName: true,
            baseAmount: true,
            convenienceFee: true,
            systemFeeAmount: true,
            totalAmount: true,
            gateway: true,
          },
        },
      },
    });
    
    if (!ticket) { 
      res.status(404).json({ success: false, message: 'Ticket not found' }); 
      return; 
    }
    
    res.json({ success: true, data: ticket.transaction });
  }
}

export async function getUnallocatedTransactions(req: Request, res: Response): Promise<void> {
  const eventId = String(req.params.id);
  
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) { res.status(404).json({ success: false, message: 'Event not found' }); return; }

  const allocatedTransactionIds = await prisma.eventTicket.findMany({
    where: { eventId, transactionId: { not: null } },
    select: { transactionId: true },
  });

  const transactions = await prisma.transaction.findMany({
    where: {
      type: 'event_ticket',
      churchId: event.churchId,
      id: { notIn: allocatedTransactionIds.map(t => t.transactionId!).filter(Boolean) },
    },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: transactions });
}

export async function downloadTicket(req: Request, res: Response): Promise<void> {
  const ticketId = String(req.params.ticketId);
  const userId = req.user!.userId;
  const roleName = req.user?.role ?? 'member';

  const whereClause = roleName === 'member' ? { id: ticketId, userId } : { id: ticketId };

  const ticket = await prisma.eventTicket.findUnique({
    where: whereClause,
    include: {
      event: { include: { church: true } },
      user: { select: { firstName: true, lastName: true } },
      transaction: { select: { amount: true, currency: true } },
    },
  });

  if (!ticket) {
    res.status(404).json({ success: false, message: 'Ticket not found' });
    return;
  }

  const attendeeName = ticket.isGuest
    ? (ticket.guestName || 'Guest')
    : `${ticket.user!.firstName} ${ticket.user!.lastName}`;

  const pdfBuffer = await generateTicketPDF({
    ticketNumber: ticket.ticketNumber,
    eventTitle: ticket.event.title,
    eventDate: new Date(ticket.event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    eventEndDate: new Date(ticket.event.endDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    eventLocation: ticket.event.location,
    attendeeName,
    churchName: ticket.event.church.name,
    amount: ticket.transaction?.amount || 0,
    currency: ticket.transaction?.currency || ticket.event.currency || 'MWK',
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=ticket-${ticket.ticketNumber}.pdf`);
  res.send(pdfBuffer);
}
