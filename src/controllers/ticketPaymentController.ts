import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import axios from 'axios';
import { getPaymentGateway, getCurrency, getGatewayCountry } from '../utils/gatewayRouter';
import { calculatePaymentFees } from '../utils/feeCalculations';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';
const BACKEND_URL = process.env.BACKEND_URL!;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

const purchaseTicketSchema = z.object({
  eventId: z.string().min(1, 'Event ID required'),
  quantity: z.number().int().positive().default(1),
});

export async function initiateTicketPurchase(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const traceId = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`[${traceId}] ========== TICKET PURCHASE INITIATED ==========`);
  console.log(`[${traceId}] User ID: ${userId}`);
  console.log(`[${traceId}] Request body:`, req.body);
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  const parsed = purchaseTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { eventId, quantity } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { church: true }
  });

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

  const baseAmount = event.ticketPrice! * quantity;
  
  // Determine gateway using existing function (handles member → church → ministryAdmin → country)
  const gateway = await getPaymentGateway(userId);
  const currency = getCurrency(gateway);
  const gatewayCountry = getGatewayCountry(gateway);
  
  console.log(`[${traceId}] Gateway: ${gateway}, Country: ${gatewayCountry}, Currency: ${currency}`);
  
  // Calculate fees
  const fees = calculatePaymentFees(baseAmount, gatewayCountry);
  
  console.log(`[${traceId}] Fees - Base: ${fees.baseAmount}, Convenience: ${fees.convenienceFee}, Tax: ${fees.systemFeeAmount}, Total: ${fees.totalAmount}`);

  // Create pending transaction
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 30);

  const pendingTx = await prisma.pendingTransaction.create({
    data: {
      amount: fees.totalAmount,
      currency,
      userId,
      churchId: event.churchId,
      eventId,
      type: 'event_ticket',
      expiresAt,
      metadata: JSON.stringify({
        traceId,
        eventId,
        eventTitle: event.title,
        quantity,
        baseAmount: fees.baseAmount,
        convenienceFee: fees.convenienceFee,
        systemFeeAmount: fees.systemFeeAmount,
        totalAmount: fees.totalAmount,
        gateway,
        gatewayCountry,
      }),
    },
  });

  console.log(`[${traceId}] Pending transaction created: ${pendingTx.id}`);

  // Route to gateway
  if (gateway === 'paychangu') {
    return await initiatePaychanguTicketPayment(pendingTx, user, event, fees, traceId, res);
  } else {
    return await initiatePaystackTicketPayment(pendingTx, user, event, fees, traceId, res);
  }
}

async function initiatePaystackTicketPayment(
  pendingTx: any,
  user: any,
  event: any,
  fees: any,
  traceId: string,
  res: Response
): Promise<void> {
  console.log(`[${traceId}] Routing to Paystack`);
  
  try {
    const metadata = JSON.parse(pendingTx.metadata);
    const amountInKobo = Math.round(fees.totalAmount * 100);
    
    // Get church subaccount
    const subaccount = await prisma.subaccount.findUnique({
      where: { churchId: event.churchId }
    });

    console.log(`[${traceId}] Subaccount found: ${subaccount ? subaccount.subaccountCode : 'NONE'}`);
    console.log(`[${traceId}] Subaccount name: ${subaccount ? subaccount.businessName : 'NONE'}`);

    const paystackPayload = {
      email: user.email,
      amount: amountInKobo,
      currency: 'KES',
      callback_url: `${BACKEND_URL}/api/payments/verify`,
      metadata: {
        ...metadata,
        type: 'event_ticket',
        pendingTxId: pendingTx.id,
        userId: user.id,
        subaccountCode: subaccount?.subaccountCode,
        subaccountName: subaccount?.businessName,
      },
      ...(subaccount && {
        subaccount: subaccount.subaccountCode,
        transaction_charge: Math.round((fees.convenienceFee + fees.systemFeeAmount) * 100),
        bearer: 'account',
      }),
    };

    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      paystackPayload,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    await prisma.pendingTransaction.update({
      where: { id: pendingTx.id },
      data: { reference: response.data.data.reference },
    });

    console.log(`[${traceId}] Paystack SUCCESS`);
    res.json({
      success: true,
      data: {
        authorization_url: response.data.data.authorization_url,
        reference: response.data.data.reference,
        baseAmount: fees.baseAmount,
        convenienceFee: fees.convenienceFee,
        systemFeeAmount: fees.systemFeeAmount,
        totalAmount: fees.totalAmount,
        currency: pendingTx.currency,
      },
    });
  } catch (error: any) {
    await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
    console.error(`[${traceId}] Paystack error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Failed to initialize payment',
    });
  }
}

async function initiatePaychanguTicketPayment(
  pendingTx: any,
  user: any,
  event: any,
  fees: any,
  traceId: string,
  res: Response
): Promise<void> {
  console.log(`[${traceId}] Routing to Paychangu`);
  
  const PAYCHANGU_SECRET_KEY = process.env.PAYCHANGU_SECRET_KEY!;
  const tx_ref = `TKT-${Date.now()}`;

  try {
    const paychanguPayload = {
      amount: fees.totalAmount,
      currency: 'MWK',
      email: user.email,
      tx_ref,
      callback_url: `${BACKEND_URL}/api/webhooks/paychangu/callback`,
      return_url: `${FRONTEND_URL}/events/${event.id}?status=cancelled`,
      customization: {
        title: `Ticket: ${event.title}`,
        description: `Event ticket purchase`
      }
    };

    const response = await axios.post(
      'https://api.paychangu.com/payment',
      paychanguPayload,
      {
        headers: {
          Authorization: `Bearer ${PAYCHANGU_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    await prisma.pendingTransaction.update({
      where: { id: pendingTx.id },
      data: { reference: tx_ref },
    });

    console.log(`[${traceId}] Paychangu SUCCESS`);
    res.json({
      success: true,
      data: {
        authorization_url: response.data.data?.checkout_url,
        reference: tx_ref,
        baseAmount: fees.baseAmount,
        convenienceFee: fees.convenienceFee,
        systemFeeAmount: fees.systemFeeAmount,
        totalAmount: fees.totalAmount,
        currency: pendingTx.currency,
      },
    });
  } catch (error: any) {
    await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
    console.error(`[${traceId}] Paychangu error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Failed to initialize payment',
    });
  }
}
