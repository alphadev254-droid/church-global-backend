import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { getPaymentGateway, getCurrency, getGatewayCountry } from '../utils/gatewayRouter';
import { calculatePaymentFees } from '../utils/feeCalculations';
import { initiateStkPush, formatMpesaPhone } from '../utils/mpesa';

const purchaseTicketSchema = z.object({
  eventId:  z.string().min(1, 'Event ID required'),
  quantity: z.number().int().positive().default(1),
  phone:    z.string().optional(), // required for Kenya (M-Pesa)
});

export async function initiateTicketPurchase(req: Request, res: Response): Promise<void> {
  const userId  = req.user?.userId;
  const traceId = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  console.log(`[${traceId}] ========== TICKET PURCHASE INITIATED ==========`);

  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  const parsed = purchaseTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { eventId, quantity, phone } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { church: true } });
  if (!event) {
    res.status(404).json({ success: false, message: 'Event not found' });
    return;
  }
  if (!event.requiresTicket) {
    res.status(400).json({ success: false, message: 'Event does not require tickets' });
    return;
  }
  if (event.isFree) {
    res.status(400).json({ success: false, message: 'Free events do not require payment' });
    return;
  }
  if (event.totalTickets && event.ticketsSold + quantity > event.totalTickets) {
    res.status(400).json({ success: false, message: 'Not enough tickets available' });
    return;
  }

  const gateway      = await getPaymentGateway(userId);
  const currency     = getCurrency(gateway);
  const gatewayCountry = getGatewayCountry(gateway);
  const baseAmount   = event.ticketPrice! * quantity;
  const fees         = calculatePaymentFees(baseAmount, gatewayCountry);

  console.log(`[${traceId}] Gateway: ${gateway}, Fees:`, fees);

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 30);

  if (gateway === 'mpesa') {
    // Phone is required for M-Pesa — use provided phone or fall back to user's profile phone
    const rawPhone = phone || user.phone;
    if (!rawPhone) {
      res.status(400).json({ success: false, message: 'Phone number is required for M-Pesa payment' });
      return;
    }

    let formattedPhone: string;
    try {
      formattedPhone = formatMpesaPhone(rawPhone);
    } catch {
      res.status(400).json({ success: false, message: 'Invalid Kenyan phone number' });
      return;
    }

    const pendingTx = await prisma.pendingTransaction.create({
      data: {
        amount:   fees.totalAmount,
        currency,
        userId,
        churchId: event.churchId,
        eventId,
        type:     'event_ticket',
        status:   'pending',
        expiresAt,
        mpesaPhoneNumber: formattedPhone,
        metadata: JSON.stringify({
          traceId,
          eventId,
          eventTitle: event.title,
          quantity,
          baseAmount:  fees.baseAmount,
          totalAmount: fees.totalAmount,
          gateway,
        }),
      },
    });

    try {
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

      console.log(`[${traceId}] STK push sent: ${stk.checkoutRequestId}`);
      res.json({
        success: true,
        data: {
          checkoutRequestId: stk.checkoutRequestId,
          customerMessage:   stk.customerMessage,
          totalAmount:       fees.totalAmount,
          currency,
        },
      });
    } catch (error: any) {
      await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
      console.error(`[${traceId}] STK push error:`, error.message);
      res.status(500).json({ success: false, message: error.message || 'Failed to initiate M-Pesa payment' });
    }
    return;
  }
}
