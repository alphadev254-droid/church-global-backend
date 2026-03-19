import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { getPaymentGatewayByChurch, getCurrency, getGatewayCountry } from '../utils/gatewayRouter';
import { calculatePaymentFees } from '../utils/feeCalculations';
import { initiateStkPush, formatMpesaPhone } from '../utils/mpesa';
import { queueEmail } from '../lib/emailQueue';
import { ticketPurchaseTemplate } from '../lib/emailTemplates';
import { generateTicketPDF } from '../lib/ticketPDF';

const BACKEND_URL  = process.env.BACKEND_URL!;

const guestTicketSchema = z.object({
  eventId:    z.string().min(1, 'Event ID required'),
  guestName:  z.string().min(1, 'Full name required'),
  guestEmail: z.string().email('Valid email required'),
  guestPhone: z.string().optional(),
  quantity:   z.number().int().positive().default(1),
});

export async function getGuestTicketFees(req: Request, res: Response): Promise<void> {
  const { eventId } = req.query as { eventId: string };
  if (!eventId) {
    res.status(400).json({ success: false, message: 'eventId required' });
    return;
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ success: false, message: 'Event not found' });
    return;
  }
  if (!event.ticketPrice) {
    res.status(400).json({ success: false, message: 'Event has no ticket price' });
    return;
  }

  const gateway = await getPaymentGatewayByChurch(event.churchId);
  const currency = getCurrency(gateway);
  const gatewayCountry = getGatewayCountry(gateway);
  const fees = calculatePaymentFees(event.ticketPrice, gatewayCountry);

  res.json({
    success: true,
    data: {
      currency,
      baseAmount:  fees.baseAmount,
      totalAmount: fees.totalAmount,
    },
  });
}

export async function initiateGuestTicketPurchase(req: Request, res: Response): Promise<void> {
  const traceId = `GUEST-TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[${traceId}] ========== GUEST TICKET PURCHASE ==========`);

  const parsed = guestTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { eventId, guestName, guestEmail, guestPhone, quantity } = parsed.data;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { church: true },
  });

  if (!event) {
    res.status(404).json({ success: false, message: 'Event not found' });
    return;
  }
  if (!event.requiresTicket) {
    res.status(400).json({ success: false, message: 'Event does not require tickets' });
    return;
  }
  if (!event.allowPublicTicketing) {
    res.status(403).json({ success: false, message: 'Public ticket purchasing is not enabled for this event' });
    return;
  }
  if (event.status === 'completed' || event.status === 'cancelled') {
    res.status(400).json({ success: false, message: 'Event is no longer available' });
    return;
  }
  if (event.ticketSalesCutoff && new Date(event.ticketSalesCutoff) < new Date()) {
    res.status(400).json({ success: false, message: 'Ticket sales have ended' });
    return;
  }
  if (event.totalTickets && event.ticketsSold + quantity > event.totalTickets) {
    res.status(400).json({ success: false, message: 'Not enough tickets available' });
    return;
  }

  // ── Free event: create ticket directly, no payment gateway ──────────────────
  if (event.isFree) {
    await handleFreeGuestTicket({ event, guestName, guestEmail, guestPhone: guestPhone || null, quantity, traceId, res });
    return;
  }

  const gateway = await getPaymentGatewayByChurch(event.churchId);
  const currency = getCurrency(gateway);
  const gatewayCountry = getGatewayCountry(gateway);
  const baseAmount = event.ticketPrice! * quantity;
  const fees = calculatePaymentFees(baseAmount, gatewayCountry);

  console.log(`[${traceId}] Gateway: ${gateway}, Fees:`, fees);

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 30);

  const pendingTx = await prisma.pendingTransaction.create({
    data: {
      amount: fees.totalAmount,
      currency,
      userId: null,
      churchId: event.churchId,
      eventId,
      type: 'event_ticket',
      expiresAt,
      metadata: JSON.stringify({
        traceId,
        eventId,
        eventTitle:  event.title,
        quantity,
        baseAmount:  fees.baseAmount,
        totalAmount: fees.totalAmount,
        gateway,
        isGuest:     true,
        guestName,
        guestEmail,
        guestPhone:  guestPhone || null,
      }),
    },
  });

  console.log(`[${traceId}] PendingTransaction created: ${pendingTx.id}`);

  await initiateMpesaGuestPayment(pendingTx, event, fees, guestPhone || null, traceId, res);
}

async function handleFreeGuestTicket({
  event, guestName, guestEmail, guestPhone, quantity, traceId, res,
}: {
  event: any;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  quantity: number;
  traceId: string;
  res: Response;
}): Promise<void> {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
  const ticketNumbers: string[] = [];

  // One ticket per email per event
  const existing = await prisma.eventTicket.findFirst({
    where: { eventId: event.id, guestEmail, isGuest: true },
  });
  if (existing) {
    res.status(409).json({ success: false, message: 'A ticket for this email already exists for this event' });
    return;
  }
  for (let i = 0; i < quantity; i++) {
    const eventDate = new Date(event.date).toISOString().slice(0, 10).replace(/-/g, '');
    const ticketCount = await prisma.eventTicket.count({ where: { eventId: event.id } });
    const eventPrefix = event.title.replace(/\s+/g, '').substring(0, 6).toUpperCase();
    const ticketNumber = `${eventPrefix}-${eventDate}-${String(ticketCount + i + 1).padStart(4, '0')}`;

    await prisma.eventTicket.create({
      data: {
        ticketNumber,
        eventId: event.id,
        userId: null,
        transactionId: null,
        status: 'confirmed',
        isGuest: true,
        guestName,
        guestEmail,
        guestPhone,
      },
    });

    ticketNumbers.push(ticketNumber);

    const eventDateStr = new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const eventEndDateStr = new Date(event.endDate || event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const ticketPDF = await generateTicketPDF({
      ticketNumber,
      eventTitle: event.title,
      eventDate: eventDateStr,
      eventEndDate: eventEndDateStr,
      eventLocation: event.location,
      attendeeName: guestName,
      churchName: event.church.name,
      amount: 0,
      currency: 'FREE',
    });

    queueEmail(
      guestEmail,
      `Free Ticket - ${event.title}`,
      ticketPurchaseTemplate({
        firstName: guestName.split(' ')[0],
        eventTitle: event.title,
        ticketNumber,
        amount: 0,
        currency: 'FREE',
        eventDate: eventDateStr,
        eventEndDate: eventEndDateStr,
        eventLocation: event.location,
        churchName: event.church.name,
        viewUrl: `${FRONTEND_URL}/events/${event.id}`,
      }),
      [{ filename: `ticket-${ticketNumber}.pdf`, content: ticketPDF }]
    );
  }

  await prisma.event.update({
    where: { id: event.id },
    data: { ticketsSold: { increment: quantity } },
  });

  console.log(`[${traceId}] Free guest ticket(s) created: ${ticketNumbers.join(', ')}`);

  res.json({
    success: true,
    data: {
      isFree: true,
      ticketNumbers,
      eventTitle: event.title,
      guestEmail,
    },
  });
}

async function initiateMpesaGuestPayment(
  pendingTx: any,
  event: any,
  fees: any,
  guestPhone: string | null,
  traceId: string,
  res: Response
): Promise<void> {
  if (!guestPhone) {
    await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
    res.status(400).json({ success: false, message: 'Phone number is required for M-Pesa payment' });
    return;
  }

  let formattedPhone: string;
  try {
    formattedPhone = formatMpesaPhone(guestPhone);
  } catch {
    await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
    res.status(400).json({ success: false, message: 'Invalid Kenyan phone number' });
    return;
  }

  try {
    await prisma.pendingTransaction.update({
      where: { id: pendingTx.id },
      data:  { mpesaPhoneNumber: formattedPhone },
    });

    const stk = await initiateStkPush(
      formattedPhone,
      fees.totalAmount,
      event.church.mpesaAccountRef || event.church.name.substring(0, 12),
      `Ticket-${event.title.substring(0, 8)}`
    );

    await prisma.pendingTransaction.update({
      where: { id: pendingTx.id },
      data:  { mpesaCheckoutRequestId: stk.checkoutRequestId },
    });

    console.log(`[${traceId}] M-Pesa guest STK push sent: ${stk.checkoutRequestId}`);
    res.json({
      success: true,
      data: {
        checkoutRequestId: stk.checkoutRequestId,
        customerMessage:   stk.customerMessage,
        totalAmount:       fees.totalAmount,
        currency:          pendingTx.currency,
      },
    });
  } catch (error: any) {
    await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
    console.error(`[${traceId}] M-Pesa error:`, error.message);
    res.status(500).json({ success: false, message: error.message || 'Failed to initiate M-Pesa payment' });
  }
}


