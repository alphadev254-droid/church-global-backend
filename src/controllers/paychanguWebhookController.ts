import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import axios from 'axios';
import crypto from 'crypto';
import { queueEmail } from '../lib/emailQueue';
import { packageSubscriptionTemplate, ticketPurchaseTemplate } from '../lib/emailTemplates';
import { generateTicketPDF } from '../lib/ticketPDF';
import { generateReceiptPDF } from '../lib/receiptPDF';

function verifyWebhookSignature(payload: any, signature: string): boolean {
  const WEBHOOK_SECRET = process.env.PAYCHANGU_WEBHOOK_SECRET || process.env.TEST_WEBHOOK_SECRET;
  
  if (!WEBHOOK_SECRET) {
    console.warn('[WEBHOOK] No webhook secret configured, skipping signature verification');
    return true;
  }
  
  const hash = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return hash === signature;
}

export async function paychanguWebhook(req: Request, res: Response): Promise<void> {
  const traceId = `PAYCHANGU-${Date.now()}`;
  
  console.log(`[${traceId}] ========== PAYCHANGU WEBHOOK ==========`);
  console.log(`[${traceId}] Body:`, JSON.stringify(req.body, null, 2));

  // Verify webhook signature
  const signature = req.headers['x-paychangu-signature'] as string;
  if (signature && !verifyWebhookSignature(req.body, signature)) {
    console.error(`[${traceId}] Invalid webhook signature`);
    res.status(401).json({ received: false, error: 'Invalid signature' });
    return;
  }

  const { tx_ref, status, amount, currency, customer, event_type, charge_id, reference } = req.body;

  console.log(`[${traceId}] Event type: ${event_type}`);
  console.log(`[${traceId}] Status: ${status}`);
  
  // Handle payout webhooks
  if (event_type === 'api.payout') {
    console.log(`[${traceId}] Processing payout webhook`);
    
    const withdrawalId = charge_id?.replace('PAYOUT-', '');
    if (!withdrawalId) {
      console.log(`[${traceId}] Invalid charge_id format`);
      res.json({ received: true });
      return;
    }
    
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId }
    });
    
    if (!withdrawal) {
      console.log(`[${traceId}] Withdrawal not found: ${withdrawalId}`);
      res.json({ received: true });
      return;
    }
    
    if (status === 'success') {
      await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'completed',
          processedAt: new Date(),
          gatewayResponse: JSON.stringify(req.body)
        }
      });
      console.log(`[${traceId}] ✅ Withdrawal marked as completed`);
    } else {
      await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'failed',
          failureReason: JSON.stringify(req.body)
        }
      });
      console.log(`[${traceId}] ❌ Withdrawal marked as failed`);
    }
    
    res.json({ received: true });
    return;
  }
  
  if (status !== 'success') {
    console.log(`[${traceId}] Payment not successful, ignoring webhook`);
    res.json({ received: true });
    return;
  }
  
  console.log(`[${traceId}] Payment successful, verifying with Paychangu API...`);

  try {
    // Verify payment with Paychangu API
    const PAYCHANGU_SECRET_KEY = process.env.PAYCHANGU_SECRET_KEY;
    const verifyResponse = await axios.get(
      `https://api.paychangu.com/verify-payment/${tx_ref}`,
      {
        headers: {
          Authorization: `Bearer ${PAYCHANGU_SECRET_KEY}`,
        },
      }
    );
    
    console.log(`[${traceId}] Paychangu verification:`, verifyResponse.data);
    
    if (verifyResponse.data.data?.status !== 'success') {
      console.log(`[${traceId}] Payment verification failed`);
      res.json({ received: true });
      return;
    }
    
    console.log(`[${traceId}] Payment verified successfully`);
    console.log(`[${traceId}] Looking for pending transaction with reference: ${tx_ref}`);
    
    const pendingTx = await prisma.pendingTransaction.findUnique({
      where: { reference: tx_ref }
    });

    if (!pendingTx) {
      console.log(`[${traceId}] Pending transaction not found: ${tx_ref}`);
      res.json({ received: true });
      return;
    }
    
    console.log(`[${traceId}] Pending transaction found: ${pendingTx.id}`);
    console.log(`[${traceId}] Type: ${pendingTx.type}`);
    
    const metadata = pendingTx.metadata ? JSON.parse(pendingTx.metadata) : {};
    console.log(`[${traceId}] Metadata:`, metadata);

    // Handle package subscriptions
    if (pendingTx.type === 'package_subscription') {
      console.log(`[${traceId}] Processing package subscription`);
      
      // Check for duplicate processing
      const existingPayment = await prisma.payment.findFirst({
        where: { reference: tx_ref }
      });
      
      if (existingPayment) {
        console.log(`[${traceId}] Payment already processed: ${existingPayment.id}`);
        res.json({ received: true, message: 'Already processed' });
        return;
      }
      const payment = await prisma.payment.create({
        data: {
          ministryAdminId: metadata.ministryAdminId,
          packageId: metadata.packageId,
          baseAmount: metadata.baseAmount,
          convenienceFee: metadata.convenienceFee,
          systemFeeAmount: metadata.systemFeeAmount,
          totalAmount: metadata.totalAmount,
          amount: metadata.totalAmount,
          currency: pendingTx.currency,
          type: 'subscription',
          status: 'completed',
          gateway: metadata.gateway,
          reference: tx_ref,
          billingCycle: metadata.billingCycle,
          paidAt: new Date(),
          gatewayResponse: JSON.stringify(req.body),
          gatewayCharge: req.body.charge ? parseFloat(req.body.charge) : 0,
          paymentMethod: req.body.authorization?.channel || 'mobile_money',
          cardBank: req.body.authorization?.bank_payment_details?.payer_bank || null,
          customerEmail: req.body.customer?.email || null,
          customerPhone: req.body.customer?.phone_number || null,
          systemGatewayFeeRate: metadata.gatewayFeeRate || 0,
          systemFeeRate: metadata.systemFeeRate || 0,
          createdById: pendingTx.userId ?? metadata.ministryAdminId,
        }
      });
      
      console.log(`[${traceId}] Payment record created: ${payment.id}`);

      // Activate subscription
      const startsAt = new Date();
      const expiresAt = new Date(startsAt);
      if (metadata.billingCycle === 'monthly') {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      } else {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      }

      await prisma.subscription.upsert({
        where: { ministryAdminId: metadata.ministryAdminId },
        create: {
          ministryAdminId: metadata.ministryAdminId,
          packageId: metadata.packageId,
          status: 'active',
          startsAt,
          expiresAt
        },
        update: {
          packageId: metadata.packageId,
          status: 'active',
          startsAt,
          expiresAt
        }
      });

      console.log(`[${traceId}] Subscription activated until: ${expiresAt}`);

      // Send confirmation email to user
      const user = await prisma.user.findUnique({
        where: { id: pendingTx.userId! },
        select: { firstName: true, email: true, ministryAdminId: true }
      });

      const pkg = await prisma.package.findUnique({
        where: { id: metadata.packageId },
        include: {
          features: {
            include: { feature: true },
            orderBy: { feature: { sortOrder: 'asc' } }
          }
        }
      });

      if (user?.email && pkg) {
        const features = pkg.features.map(f => f.feature.displayName);
        const emailHtml = packageSubscriptionTemplate({
          firstName: user.firstName,
          packageName: pkg.displayName,
          amount: metadata.totalAmount,
          currency: pendingTx.currency,
          billingCycle: metadata.billingCycle === 'monthly' ? 'Monthly' : 'Yearly',
          expiresAt: expiresAt.toLocaleDateString(),
          features
        });
        await queueEmail(user.email, 'Subscription Confirmed', emailHtml, 'package_subscription');
        console.log(`[${traceId}] Subscription confirmation email queued`);

        // Send email to national admin if buyer is not national admin
        if (metadata.ministryAdminId !== pendingTx.userId) {
          const ministryAdmin = await prisma.user.findUnique({
            where: { id: metadata.ministryAdminId },
            select: { email: true, firstName: true }
          });

          if (ministryAdmin?.email) {
            const adminEmailHtml = packageSubscriptionTemplate({
              firstName: ministryAdmin.firstName,
              packageName: pkg.displayName,
              amount: metadata.totalAmount,
              currency: pendingTx.currency,
              billingCycle: metadata.billingCycle === 'monthly' ? 'Monthly' : 'Yearly',
              expiresAt: expiresAt.toLocaleDateString(),
              features
            });
            await queueEmail(ministryAdmin.email, 'Subscription Confirmed', adminEmailHtml, 'package_subscription');
            console.log(`[${traceId}] Subscription confirmation email queued for national admin`);
          }
        }
      }
    }
    
    // Handle event tickets
    if (pendingTx.type === 'event_ticket') {
      console.log(`[${traceId}] Processing event ticket`);
      console.log(`[${traceId}] Fee breakdown - Base: ${metadata.baseAmount}, Convenience: ${metadata.convenienceFee}, System Fee: ${metadata.systemFeeAmount}, Total: ${metadata.totalAmount}`);
      
      // Check for duplicate
      const existingTransaction = await prisma.transaction.findFirst({
        where: { reference: tx_ref }
      });
      
      if (existingTransaction) {
        console.log(`[${traceId}] Transaction already processed: ${existingTransaction.id}`);
        res.json({ received: true, message: 'Already processed' });
        return;
      }
      
      // Create transaction record
      const transaction = await prisma.transaction.create({
        data: {
          userId: metadata.isGuest ? null : pendingTx.userId,
          churchId: pendingTx.churchId,
          eventId: metadata.eventId,
          type: 'event_ticket',
          amount: metadata.totalAmount,
          baseAmount: metadata.baseAmount,
          convenienceFee: metadata.convenienceFee,
          systemFeeAmount: metadata.systemFeeAmount,
          totalAmount: metadata.totalAmount,
          currency: pendingTx.currency,
          status: 'completed',
          gateway: metadata.gateway,
          gatewayCountry: metadata.gatewayCountry,
          reference: tx_ref,
          paymentMethod: req.body.authorization?.channel || 'mobile_money',
          gatewayCharge: req.body.charge ? parseFloat(req.body.charge) : 0,
          systemGatewayFeeRate: metadata.gatewayFeeRate || 0,
          systemFeeRate: metadata.systemFeeRate || 0,
          paidAt: new Date(),
          gatewayResponse: JSON.stringify(req.body),
          isGuest: metadata.isGuest === true,
          guestName: metadata.isGuest ? metadata.guestName : null,
          guestEmail: metadata.isGuest ? metadata.guestEmail : null,
          guestPhone: metadata.isGuest ? metadata.guestPhone : null,
        }
      });
      
      console.log(`[${traceId}] Transaction saved with fees - Base: ${transaction.baseAmount}, Convenience: ${transaction.convenienceFee}, System Fee: ${transaction.systemFeeAmount}, Gateway Charge: ${transaction.gatewayCharge}`);
      
      console.log(`[${traceId}] Transaction created: ${transaction.id}`);
      console.log(`[${traceId}] System fee applied: ${metadata.systemFeeAmount > 0 ? 'YES' : 'NO'} (${metadata.gatewayCountry})`);
      
      // Create tickets
      const quantity = metadata.quantity || 1;
      const event = await prisma.event.findUnique({ where: { id: metadata.eventId }, include: { church: true } });
      const isGuest = metadata.isGuest === true;

      for (let i = 0; i < quantity; i++) {
        const eventDate = new Date(event!.date).toISOString().slice(0, 10).replace(/-/g, '');
        const ticketCount = await prisma.eventTicket.count({ where: { eventId: metadata.eventId } });
        const eventPrefix = event!.title.replace(/\s+/g, '').substring(0, 6).toUpperCase();
        const ticketNumber = `${eventPrefix}-${eventDate}-${String(ticketCount + i + 1).padStart(4, '0')}`;

        await prisma.eventTicket.create({
          data: {
            ticketNumber,
            eventId: metadata.eventId,
            userId: isGuest ? null : pendingTx.userId,
            transactionId: transaction.id,
            status: 'confirmed',
            isGuest,
            guestName: isGuest ? metadata.guestName : null,
            guestEmail: isGuest ? metadata.guestEmail : null,
            guestPhone: isGuest ? metadata.guestPhone : null,
          },
        });

        if (isGuest && event) {
          const attendeeName = metadata.guestName;
          const emailTo = metadata.guestEmail;

          const ticketPDF = await generateTicketPDF({
            ticketNumber,
            eventTitle: event.title,
            eventDate: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            eventEndDate: new Date(event.endDate || event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            eventLocation: event.location,
            attendeeName,
            churchName: (event as any).church.name,
            amount: metadata.baseAmount,
            currency: pendingTx.currency,
          });

          const receiptPDF = await generateReceiptPDF({
            receiptNumber: tx_ref,
            type: 'event_ticket',
            customerName: attendeeName,
            customerEmail: emailTo,
            amount: metadata.baseAmount,
            currency: pendingTx.currency,
            paidAt: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            paymentMethod: req.body.authorization?.channel || 'mobile_money',
            description: `Event Ticket - ${event.title}`,
            itemDetails: [
              { label: 'Event', value: event.title },
              { label: 'Church', value: (event as any).church.name },
              { label: 'Date', value: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) },
              { label: 'Location', value: event.location },
              { label: 'Ticket Number', value: ticketNumber },
            ],
          });

          queueEmail(
            emailTo,
            `Ticket Confirmation - ${event.title}`,
            ticketPurchaseTemplate({
              firstName: metadata.guestName.split(' ')[0],
              eventTitle: event.title,
              ticketNumber,
              amount: metadata.baseAmount,
              currency: pendingTx.currency,
              eventDate: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
              eventEndDate: new Date(event.endDate || event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
              eventLocation: event.location,
              churchName: (event as any).church.name,
              viewUrl: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/payment/callback?status=success&type=event_ticket&isGuest=true&reference=${tx_ref}&guestEmail=${encodeURIComponent(metadata.guestEmail)}&guestName=${encodeURIComponent(metadata.guestName)}&amount=${metadata.baseAmount}&currency=${pendingTx.currency}&eventId=${metadata.eventId}`,
            }),
            [
              { filename: `ticket-${ticketNumber}.pdf`, content: ticketPDF },
              { filename: `receipt-${tx_ref}.pdf`, content: receiptPDF },
            ]
          );
        }
      }
      
      // Update event ticket count
      await prisma.event.update({
        where: { id: metadata.eventId },
        data: { ticketsSold: { increment: quantity } }
      });
      
      // Credit church wallet for Malawi
      if (metadata.gateway === 'paychangu' && pendingTx.churchId) {
        const { creditChurchWallet } = await import('../utils/walletOperations');
        await creditChurchWallet(
          pendingTx.churchId,
          metadata.baseAmount,
          'event_ticket',
          transaction.id,
          `Ticket purchase - ${metadata.eventTitle}`
        );
        console.log(`[${traceId}] Church wallet credited: ${metadata.baseAmount} MWK`);
      }
      
      console.log(`[${traceId}] ${quantity} ticket(s) created`);
    }
    
    // Handle donations
    if (pendingTx.type === 'donation') {
      console.log(`[${traceId}] Processing donation`);
      console.log(`[${traceId}] Fee breakdown - Base: ${metadata.baseAmount}, Convenience: ${metadata.convenienceFee}, System Fee: ${metadata.systemFeeAmount}, Total: ${metadata.totalAmount}`);
      
      // Check for duplicate
      const existingTransaction = await prisma.transaction.findFirst({
        where: { reference: tx_ref }
      });
      
      if (existingTransaction) {
        console.log(`[${traceId}] Transaction already processed: ${existingTransaction.id}`);
        res.json({ received: true, message: 'Already processed' });
        return;
      }
      
      // Create transaction record
      const transaction = await prisma.transaction.create({
        data: {
          userId: metadata.isGuest ? null : pendingTx.userId,
          churchId: pendingTx.churchId,
          type: 'donation',
          amount: metadata.totalAmount,
          baseAmount: metadata.baseAmount,
          convenienceFee: metadata.convenienceFee,
          systemFeeAmount: metadata.systemFeeAmount,
          totalAmount: metadata.totalAmount,
          currency: pendingTx.currency,
          status: 'completed',
          gateway: metadata.gateway,
          gatewayCountry: metadata.gatewayCountry,
          reference: tx_ref,
          paymentMethod: req.body.authorization?.channel || 'mobile_money',
          gatewayCharge: req.body.charge ? parseFloat(req.body.charge) : 0,
          systemGatewayFeeRate: metadata.gatewayFeeRate || 0,
          systemFeeRate: metadata.systemFeeRate || 0,
          paidAt: new Date(),
          gatewayResponse: JSON.stringify(req.body),
          isGuest: metadata.isGuest === true,
          guestName: metadata.isGuest ? metadata.guestName : null,
          guestEmail: metadata.isGuest ? metadata.guestEmail : null,
          guestPhone: metadata.isGuest ? metadata.guestPhone : null,
        }
      });
      
      console.log(`[${traceId}] Transaction saved with fees - Base: ${transaction.baseAmount}, Convenience: ${transaction.convenienceFee}, System Fee: ${transaction.systemFeeAmount}, Gateway Charge: ${transaction.gatewayCharge}`);
      console.log(`[${traceId}] Transaction created: ${transaction.id}`);
      console.log(`[${traceId}] System fee applied: ${metadata.systemFeeAmount > 0 ? 'YES' : 'NO'} (${metadata.gatewayCountry})`);
      
      // Create donation record
      await prisma.donationTransaction.create({
        data: {
          campaignId: metadata.campaignId,
          userId: metadata.isGuest ? null : pendingTx.userId,
          churchId: pendingTx.churchId,
          amount: metadata.baseAmount,
          currency: pendingTx.currency,
          transactionId: transaction.id,
          reference: tx_ref,
          status: 'completed',
          isAnonymous: metadata.isAnonymous || false,
          isGuest: metadata.isGuest === true,
          guestName: metadata.isGuest ? metadata.guestName : null,
          guestEmail: metadata.isGuest ? metadata.guestEmail : null,
          guestPhone: metadata.isGuest ? metadata.guestPhone : null,
          donorName: metadata.donorName,
          donorPhone: metadata.donorPhone,
          notes: metadata.notes,
        }
      });
      
      // Credit church wallet for Malawi
      if (metadata.gateway === 'paychangu' && pendingTx.churchId) {
        const { creditChurchWallet } = await import('../utils/walletOperations');
        await creditChurchWallet(
          pendingTx.churchId,
          metadata.baseAmount,
          'donation',
          transaction.id,
          `Donation - ${metadata.campaignName}`
        );
        console.log(`[${traceId}] Church wallet credited: ${metadata.baseAmount} MWK`);
      }

      // Send receipt email for guest donations
      if (metadata.isGuest && metadata.guestEmail) {
        const campaign = await prisma.givingCampaign.findUnique({
          where: { id: metadata.campaignId },
          include: { church: { select: { name: true } } },
        });
        if (campaign) {
          const { generateReceiptPDF } = await import('../lib/receiptPDF');
          const { donationReceiptTemplate } = await import('../lib/emailTemplates');
          const receiptPDF = await generateReceiptPDF({
            receiptNumber: tx_ref,
            type: 'donation',
            customerName: metadata.guestName,
            customerEmail: metadata.guestEmail,
            amount: metadata.baseAmount,
            currency: pendingTx.currency,
            paidAt: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            paymentMethod: req.body.authorization?.channel || 'mobile_money',
            description: `Donation to ${campaign.name}`,
            itemDetails: [
              { label: 'Campaign', value: campaign.name },
              { label: 'Church', value: (campaign as any).church.name },
            ],
          });
          queueEmail(
            metadata.guestEmail,
            `Donation Receipt - ${campaign.name}`,
            donationReceiptTemplate({
              firstName: metadata.guestName.split(' ')[0],
              amount: metadata.baseAmount,
              currency: pendingTx.currency,
              campaignName: campaign.name,
              reference: tx_ref,
              isAnonymous: false,
              isGuest: true,
              churchName: (campaign as any).church.name,
            }),
            [{ filename: `donation-receipt-${tx_ref}.pdf`, content: receiptPDF }]
          );
        }
      }
      
      console.log(`[${traceId}] Donation created`);
    }
    
    // Delete pending transaction
    await prisma.pendingTransaction.delete({
      where: { id: pendingTx.id }
    });
    
    console.log(`[${traceId}] Pending transaction deleted`);
    console.log(`[${traceId}] Webhook processed successfully`);
    res.json({ received: true });

  } catch (error: any) {
    console.error(`[${traceId}] ERROR:`, error.message);
    res.status(500).json({ received: true, error: error.message });
  }
}
