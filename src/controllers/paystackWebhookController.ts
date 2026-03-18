import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import axios from 'axios';
import crypto from 'crypto';
import { queueEmail } from '../lib/emailQueue';
import { ticketPurchaseTemplate, donationReceiptTemplate, packageSubscriptionTemplate } from '../lib/emailTemplates';
import { generateTicketPDF } from '../lib/ticketPDF';
import { generateReceiptPDF } from '../lib/receiptPDF';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';
const SYSTEM_SUBACCOUNT_CODE = process.env.SYSTEM_SUBACCOUNT_CODE!;

function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export async function paystackWebhook(req: Request, res: Response): Promise<void> {
  const traceId = `PAYSTACK-WEBHOOK-${Date.now()}`;

  console.log(`[${traceId}] ========== PAYSTACK WEBHOOK HIT ==========`);
  console.log(`[${traceId}] Timestamp: ${new Date().toISOString()}`);
  console.log(`[${traceId}] URL: ${req.originalUrl}`);
  console.log(`[${traceId}] Method: ${req.method}`);
  console.log(`[${traceId}] Headers:`, JSON.stringify(req.headers, null, 2));
  console.log(`[${traceId}] Body:`, JSON.stringify(req.body, null, 2));
  console.log(`[${traceId}] Raw body exists: ${!!req.rawBody}`);

  const signature = req.headers['x-paystack-signature'] as string;
  console.log(`[${traceId}] Signature header: ${signature || 'MISSING'}`);

  if (!signature || !req.rawBody || !verifyWebhookSignature(req.rawBody, signature)) {
    console.error(`[${traceId}] ❌ Invalid webhook signature — signature: ${signature}, rawBody: ${!!req.rawBody}`);
    res.status(401).json({ received: false });
    return;
  }

  const { event, data } = req.body;
  console.log(`[${traceId}] ✅ Signature valid — event: ${event}`);

  if (event !== 'charge.success') {
    console.log(`[${traceId}] Ignoring event type: ${event}`);
    res.json({ received: true });
    return;
  }

  console.log(`[${traceId}] charge.success - reference: ${data.reference}`);

  // Verify with Paystack API
  try {
    const verifyResponse = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${data.reference}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );

    if (verifyResponse.data.data?.status !== 'success') {
      console.log(`[${traceId}] Payment verification failed`);
      res.json({ received: true });
      return;
    }

    const txData = verifyResponse.data.data;
    const { metadata } = txData;
    const amount = txData.amount / 100;
    const type = metadata?.type || 'event_ticket';

    console.log(`[${traceId}] Verified - type: ${type}, amount: ${amount}`);

    if (type === 'package_subscription') {
      console.log(`[${traceId}] ========== PACKAGE SUBSCRIPTION ==========`);
      console.log(`[${traceId}] ministryAdminId: ${metadata.ministryAdminId}`);
      console.log(`[${traceId}] packageId: ${metadata.packageId}`);
      console.log(`[${traceId}] billingCycle: ${metadata.billingCycle}`);
      console.log(`[${traceId}] pendingTxId: ${metadata.pendingTxId}`);
      console.log(`[${traceId}] initiatedBy: ${metadata.initiatedBy}`);

      const existingPayment = await prisma.payment.findFirst({ where: { reference: txData.reference } });
      if (existingPayment) {
        console.log(`[${traceId}] Already processed: ${existingPayment.id}`);
        res.json({ received: true });
        return;
      }
      console.log(`[${traceId}] No duplicate found — proceeding`);

      const pendingTx = await prisma.pendingTransaction.findUnique({ where: { id: metadata.pendingTxId } });
      console.log(`[${traceId}] PendingTransaction found: ${pendingTx ? pendingTx.id : 'NOT FOUND'}`);
      const pendingMetadata = pendingTx?.metadata ? JSON.parse(pendingTx.metadata) : {};
      console.log(`[${traceId}] PendingMetadata:`, pendingMetadata);

      const baseAmount = pendingMetadata.baseAmount || amount;
      const convenienceFee = pendingMetadata.convenienceFee || 0;
      const systemFeeAmount = pendingMetadata.systemFeeAmount || 0;
      const totalAmount = pendingMetadata.totalAmount || amount;
      const gateway = pendingMetadata.gateway || 'paystack';
      const systemGatewayFeeRate = pendingMetadata.gatewayFeeRate || 0;
      const systemFeeRate = pendingMetadata.systemFeeRate || 0;

      console.log(`[${traceId}] Fee breakdown — base: ${baseAmount}, convenience: ${convenienceFee}, systemFee: ${systemFeeAmount}, total: ${totalAmount}`);

      const startsAt = new Date(txData.paid_at);
      const expiresAt = new Date(startsAt);
      if (metadata.billingCycle === 'monthly') {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      } else {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      }
      console.log(`[${traceId}] Subscription period — startsAt: ${startsAt.toISOString()}, expiresAt: ${expiresAt.toISOString()}`);

      const pkg = await prisma.package.findUnique({ where: { id: metadata.packageId } });
      console.log(`[${traceId}] Package: ${pkg ? pkg.name : 'NOT FOUND'}`);

      const payment = await prisma.payment.create({
        data: {
          ministryAdminId: metadata.ministryAdminId,
          packageId: metadata.packageId,
          amount,
          currency: txData.currency,
          type: 'package_subscription',
          status: 'completed',
          packageName: pkg?.name || 'Unknown',
          reference: txData.reference,
          createdById: metadata.initiatedBy,
          billingCycle: metadata.billingCycle,
          baseAmount,
          convenienceFee,
          systemFeeAmount,
          totalAmount,
          gateway,
          paymentMethod: txData.channel || 'card',
          channel: txData.channel,
          paidAt: new Date(txData.paid_at),
          customerEmail: txData.customer?.email,
          customerPhone: txData.customer?.phone,
          cardLast4: txData.authorization?.last4,
          cardBank: txData.authorization?.bank,
          subaccountCode: txData.subaccount?.subaccount_code || SYSTEM_SUBACCOUNT_CODE,
          subaccountName: txData.subaccount?.business_name || 'ICIMS System',
          gatewayCharge: txData.fees ? txData.fees / 100 : 0,
          systemGatewayFeeRate,
          systemFeeRate,
          gatewayResponse: JSON.stringify(txData),
          expiresAt,
        },
      });
      console.log(`[${traceId}] Payment record created: ${payment.id}`);

      await prisma.subscription.upsert({
        where: { ministryAdminId: metadata.ministryAdminId },
        create: { ministryAdminId: metadata.ministryAdminId, packageId: metadata.packageId, status: 'active', startsAt, expiresAt, lastEmailDay: null },
        update: { packageId: metadata.packageId, status: 'active', startsAt, expiresAt, lastEmailDay: null },
      });

      if (pendingTx) await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } });

      const subscriberUser = await prisma.user.findUnique({ where: { id: metadata.initiatedBy } });
      const packageFeatures = await prisma.packageFeatureLink.findMany({
        where: { packageId: metadata.packageId },
        include: { feature: { select: { displayName: true } } }
      });

      if (subscriberUser && pkg) {
        const receiptPDF = await generateReceiptPDF({
          receiptNumber: txData.reference,
          type: 'package_subscription',
          customerName: `${subscriberUser.firstName} ${subscriberUser.lastName}`,
          customerEmail: subscriberUser.email,
          amount: baseAmount,
          currency: txData.currency,
          paidAt: new Date(txData.paid_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          paymentMethod: txData.channel || 'card',
          description: `${pkg.displayName} - ${metadata.billingCycle} subscription`,
          itemDetails: [
            { label: 'Package', value: pkg.displayName },
            { label: 'Billing Cycle', value: metadata.billingCycle },
            { label: 'Expires On', value: expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }
          ]
        });
        queueEmail(
          subscriberUser.email,
          `Subscription Confirmed - ${pkg.displayName}`,
          packageSubscriptionTemplate({
            firstName: subscriberUser.firstName,
            packageName: pkg.displayName,
            amount: baseAmount,
            currency: txData.currency,
            billingCycle: metadata.billingCycle,
            expiresAt: expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            features: packageFeatures.map(pf => pf.feature.displayName)
          }),
          [{ filename: `receipt-${txData.reference}.pdf`, content: receiptPDF }]
        );
      }

    } else if (type === 'event_ticket') {
      const existingTransaction = await prisma.transaction.findFirst({ where: { reference: txData.reference } });
      if (existingTransaction) {
        console.log(`[${traceId}] Already processed: ${existingTransaction.id}`);
        res.json({ received: true });
        return;
      }

      const pendingTx = await prisma.pendingTransaction.findUnique({ where: { reference: txData.reference } });
      if (!pendingTx) {
        console.log(`[${traceId}] Pending transaction not found`);
        res.json({ received: true });
        return;
      }

      const pendingMetadata = pendingTx.metadata ? JSON.parse(pendingTx.metadata) : {};

      const transaction = await prisma.transaction.create({
        data: {
          userId: pendingMetadata.isGuest ? null : (metadata.userId || pendingTx.userId),
          churchId: pendingTx.churchId,
          eventId: pendingMetadata.eventId,
          type: 'event_ticket',
          amount,
          baseAmount: pendingMetadata.baseAmount,
          convenienceFee: pendingMetadata.convenienceFee,
          systemFeeAmount: pendingMetadata.systemFeeAmount,
          totalAmount: pendingMetadata.totalAmount,
          currency: txData.currency,
          status: 'completed',
          gateway: pendingMetadata.gateway,
          gatewayCountry: pendingMetadata.gatewayCountry,
          reference: txData.reference,
          paymentMethod: txData.channel || 'card',
          channel: txData.channel,
          paidAt: new Date(txData.paid_at),
          customerEmail: txData.customer?.email,
          customerPhone: txData.customer?.phone,
          cardLast4: txData.authorization?.last4,
          cardBank: txData.authorization?.bank,
          gatewayCharge: txData.fees ? txData.fees / 100 : 0,
          systemGatewayFeeRate: pendingMetadata.gatewayFeeRate || 0,
          systemFeeRate: pendingMetadata.systemFeeRate || 0,
          subaccountCode: metadata.subaccountCode || txData.subaccount?.subaccount_code,
          subaccountName: metadata.subaccountName || txData.subaccount?.business_name,
          gatewayResponse: JSON.stringify(txData),
          isGuest: pendingMetadata.isGuest === true,
          guestName: pendingMetadata.isGuest ? pendingMetadata.guestName : null,
          guestEmail: pendingMetadata.isGuest ? pendingMetadata.guestEmail : null,
          guestPhone: pendingMetadata.isGuest ? pendingMetadata.guestPhone : null,
        }
      });
      console.log(`[${traceId}] Transaction created: ${transaction.id}`);

      const quantity = pendingMetadata.quantity || 1;
      const event = await prisma.event.findUnique({ where: { id: pendingMetadata.eventId }, include: { church: true } });
      const user = pendingMetadata.isGuest ? null : await prisma.user.findUnique({ where: { id: pendingTx.userId! } });
      const isGuest = pendingMetadata.isGuest === true;

      for (let i = 0; i < quantity; i++) {
        const eventDate = new Date(event!.date).toISOString().slice(0, 10).replace(/-/g, '');
        const ticketCount = await prisma.eventTicket.count({ where: { eventId: pendingMetadata.eventId } });
        const eventPrefix = event!.title.replace(/\s+/g, '').substring(0, 6).toUpperCase();
        const ticketNumber = `${eventPrefix}-${eventDate}-${String(ticketCount + i + 1).padStart(4, '0')}`;

        await prisma.eventTicket.create({
          data: {
            ticketNumber,
            eventId: pendingMetadata.eventId,
            userId: isGuest ? null : pendingTx.userId,
            transactionId: transaction.id,
            status: 'confirmed',
            isGuest,
            guestName: isGuest ? pendingMetadata.guestName : null,
            guestEmail: isGuest ? pendingMetadata.guestEmail : null,
            guestPhone: isGuest ? pendingMetadata.guestPhone : null,
          }
        });

        const attendeeName = isGuest
          ? pendingMetadata.guestName
          : `${user!.firstName} ${user!.lastName}`;
        const emailTo = isGuest ? pendingMetadata.guestEmail : user!.email;

        if (event && emailTo) {
          const ticketPDF = await generateTicketPDF({
            ticketNumber,
            eventTitle: event.title,
            eventDate: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            eventEndDate: new Date(event.endDate || event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            eventLocation: event.location,
            attendeeName,
            churchName: event.church.name,
            amount: pendingMetadata.baseAmount,
            currency: txData.currency,
          });
          const receiptPDF = await generateReceiptPDF({
            receiptNumber: txData.reference,
            type: 'event_ticket',
            customerName: attendeeName,
            customerEmail: emailTo,
            amount: pendingMetadata.baseAmount,
            currency: txData.currency,
            paidAt: new Date(txData.paid_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            paymentMethod: txData.channel || 'card',
            description: `Event Ticket - ${event.title}`,
            itemDetails: [
              { label: 'Event', value: event.title },
              { label: 'Church', value: event.church.name },
              { label: 'Date', value: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) },
              { label: 'Location', value: event.location },
              { label: 'Ticket Number', value: ticketNumber }
            ]
          });
          queueEmail(
            emailTo,
            `Ticket Confirmation - ${event.title}`,
            ticketPurchaseTemplate({
              firstName: isGuest ? pendingMetadata.guestName.split(' ')[0] : user!.firstName,
              eventTitle: event.title,
              ticketNumber,
              amount: pendingMetadata.baseAmount,
              currency: txData.currency,
              eventDate: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
              eventEndDate: new Date(event.endDate || event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
              eventLocation: event.location,
              churchName: event.church.name,
              ...(isGuest && {
                viewUrl: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/payment/callback?status=success&type=event_ticket&isGuest=true&reference=${txData.reference}&guestEmail=${encodeURIComponent(pendingMetadata.guestEmail)}&guestName=${encodeURIComponent(pendingMetadata.guestName)}&amount=${pendingMetadata.baseAmount}&currency=${txData.currency}&eventId=${pendingMetadata.eventId}`,
              }),
            }),
            [
              { filename: `ticket-${ticketNumber}.pdf`, content: ticketPDF },
              { filename: `receipt-${txData.reference}.pdf`, content: receiptPDF }
            ]
          );
        }
      }

      await prisma.event.update({ where: { id: pendingMetadata.eventId }, data: { ticketsSold: { increment: quantity } } });
      await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } });

    } else if (type === 'donation') {
      const existingTransaction = await prisma.transaction.findFirst({ where: { reference: txData.reference } });
      if (existingTransaction) {
        console.log(`[${traceId}] Already processed: ${existingTransaction.id}`);
        res.json({ received: true });
        return;
      }

      const pendingTx = await prisma.pendingTransaction.findUnique({ where: { reference: txData.reference } });
      if (!pendingTx) {
        console.log(`[${traceId}] Pending transaction not found`);
        res.json({ received: true });
        return;
      }

      const pendingMetadata = pendingTx.metadata ? JSON.parse(pendingTx.metadata) : {};

      const transaction = await prisma.transaction.create({
        data: {
          userId: pendingMetadata.isGuest ? null : (metadata.userId || pendingTx.userId),
          churchId: pendingTx.churchId,
          type: 'donation',
          amount,
          baseAmount: pendingMetadata.baseAmount,
          convenienceFee: pendingMetadata.convenienceFee,
          systemFeeAmount: pendingMetadata.systemFeeAmount,
          totalAmount: pendingMetadata.totalAmount,
          currency: txData.currency,
          status: 'completed',
          gateway: pendingMetadata.gateway,
          gatewayCountry: pendingMetadata.gatewayCountry,
          reference: txData.reference,
          paymentMethod: txData.channel || 'card',
          channel: txData.channel,
          paidAt: new Date(txData.paid_at),
          customerEmail: txData.customer?.email,
          customerPhone: txData.customer?.phone,
          cardLast4: txData.authorization?.last4,
          cardBank: txData.authorization?.bank,
          gatewayCharge: txData.fees ? txData.fees / 100 : 0,
          systemGatewayFeeRate: pendingMetadata.gatewayFeeRate || 0,
          systemFeeRate: pendingMetadata.systemFeeRate || 0,
          subaccountCode: metadata.subaccountCode || txData.subaccount?.subaccount_code,
          subaccountName: metadata.subaccountName || txData.subaccount?.business_name,
          gatewayResponse: JSON.stringify(txData),
          isGuest: pendingMetadata.isGuest === true,
          guestName: pendingMetadata.isGuest ? pendingMetadata.guestName : null,
          guestEmail: pendingMetadata.isGuest ? pendingMetadata.guestEmail : null,
          guestPhone: pendingMetadata.isGuest ? pendingMetadata.guestPhone : null,
        }
      });
      console.log(`[${traceId}] Transaction created: ${transaction.id}`);

      await prisma.donationTransaction.create({
        data: {
          campaignId: pendingMetadata.campaignId,
          userId: pendingMetadata.isGuest ? null : pendingTx.userId,
          churchId: pendingTx.churchId,
          amount: pendingMetadata.baseAmount,
          currency: txData.currency,
          transactionId: transaction.id,
          reference: txData.reference,
          status: 'completed',
          isAnonymous: pendingMetadata.isAnonymous || false,
          isGuest: pendingMetadata.isGuest === true,
          guestName: pendingMetadata.isGuest ? pendingMetadata.guestName : null,
          guestEmail: pendingMetadata.isGuest ? pendingMetadata.guestEmail : null,
          guestPhone: pendingMetadata.isGuest ? pendingMetadata.guestPhone : null,
          donorName: pendingMetadata.donorName,
          donorPhone: pendingMetadata.donorPhone,
          notes: pendingMetadata.notes,
        }
      });

      const isGuestDonation = pendingMetadata.isGuest === true;
      const donorEmail = isGuestDonation ? pendingMetadata.guestEmail : (await prisma.user.findUnique({ where: { id: pendingTx.userId! } }))?.email;
      const donorFirstName = isGuestDonation ? pendingMetadata.guestName.split(' ')[0] : (await prisma.user.findUnique({ where: { id: pendingTx.userId! } }))?.firstName;
      const donorFullName = isGuestDonation ? pendingMetadata.guestName : `${donorFirstName} ${(await prisma.user.findUnique({ where: { id: pendingTx.userId! } }))?.lastName || ''}`;

      const campaign = await prisma.givingCampaign.findUnique({
        where: { id: pendingMetadata.campaignId },
        include: { church: { select: { name: true } } }
      });

      if (donorEmail && campaign) {
        const receiptPDF = await generateReceiptPDF({
          receiptNumber: txData.reference,
          type: 'donation',
          customerName: donorFullName || '',
          customerEmail: donorEmail,
          amount: pendingMetadata.baseAmount,
          currency: txData.currency,
          paidAt: new Date(txData.paid_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          paymentMethod: txData.channel || 'card',
          description: `Donation to ${campaign.name}`,
          itemDetails: [
            { label: 'Campaign', value: campaign.name },
            { label: 'Church', value: campaign.church.name },
            { label: 'Anonymous', value: pendingMetadata.isAnonymous ? 'Yes' : 'No' }
          ]
        });
        queueEmail(
          donorEmail,
          `Donation Receipt - ${campaign.name}`,
          donationReceiptTemplate({
            firstName: donorFirstName || 'Donor',
            amount: pendingMetadata.baseAmount,
            currency: txData.currency,
            campaignName: campaign.name,
            reference: txData.reference,
            isAnonymous: pendingMetadata.isAnonymous || false,
            isGuest: pendingMetadata.isGuest === true,
            churchName: campaign.church.name
          }),
          [{ filename: `donation-receipt-${txData.reference}.pdf`, content: receiptPDF }]
        );
      }

      await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } });
    }

    console.log(`[${traceId}] Webhook processed successfully`);
    res.json({ received: true });

  } catch (error: any) {
    console.error(`[${traceId}] ERROR:`, error.message);
    res.status(500).json({ received: true, error: error.message });
  }
}
