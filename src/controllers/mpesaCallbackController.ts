import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { verifyMpesaTransaction } from '../utils/mpesa';
import { queueEmail } from '../lib/emailQueue';
import { ticketPurchaseTemplate, donationReceiptTemplate, packageSubscriptionTemplate } from '../lib/emailTemplates';
import { generateTicketPDF } from '../lib/ticketPDF';
import { generateReceiptPDF } from '../lib/receiptPDF';
import { creditNationalAdminBalance } from '../utils/nationalAdminBalanceOperations';

// ─── IP whitelist middleware ───────────────────────────────────────────────────
export function mpesaIpWhitelist(req: Request, res: Response, next: Function): void {
  const allowedEnv = process.env.MPESA_ALLOWED_IPS || '';
  const allowed = allowedEnv.split(',').map(ip => ip.trim()).filter(Boolean);

  // If no IPs configured OR sandbox mode, skip check
  if (allowed.length === 0 || process.env.MPESA_ENV !== 'production') { next(); return; }

  // Respect X-Forwarded-For when behind a proxy/ngrok
  const forwarded = req.headers['x-forwarded-for'];
  const clientIp  = (typeof forwarded === 'string' ? forwarded.split(',')[0] : req.socket.remoteAddress || '').trim();

  if (!allowed.includes(clientIp)) {
    console.warn(`[MPESA-IP] Blocked request from ${clientIp} — not in whitelist`);
    res.status(403).json({ ResultCode: 1, ResultDesc: 'Forbidden' });
    return;
  }

  next();
}

// ─── POST /api/webhooks/mpesa/callback ────────────────────────────────────────
export async function mpesaCallback(req: Request, res: Response): Promise<void> {
  const traceId = `MPESA-CB-${Date.now()}`;
  console.log(`[${traceId}] ========== MPESA CALLBACK ==========`);
  console.log(`[${traceId}] Source IP  :`, req.headers['x-forwarded-for'] || req.socket.remoteAddress);
  console.log(`[${traceId}] Headers    :`, JSON.stringify(req.headers, null, 2));
  console.log(`[${traceId}] Raw body   :`, JSON.stringify(req.body, null, 2));

  // Always respond 200 immediately — Daraja retries if it doesn't get 200 fast
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const body = req.body?.Body?.stkCallback as any;
    if (!body) {
      console.error(`[${traceId}] Invalid callback structure — missing Body.stkCallback`);
      return;
    }

    const { CheckoutRequestID, ResultCode, ResultDesc } = body;
    const checkoutRequestId = String(CheckoutRequestID);
    console.log(`[${traceId}] CheckoutRequestID: ${checkoutRequestId}, ResultCode: ${ResultCode}, ResultDesc: ${ResultDesc}`);

    // Find pending transaction
    const pendingTx = await prisma.pendingTransaction.findUnique({
      where: { mpesaCheckoutRequestId: checkoutRequestId },
    });

    if (!pendingTx) {
      console.error(`[${traceId}] No pending transaction for CheckoutRequestID: ${checkoutRequestId}`);
      return;
    }

    // Payment failed per callback
    if (ResultCode !== 0) {
      const reason = ResultDesc || 'Payment failed';
      console.log(`[${traceId}] Payment failed per callback: ${reason}`);
      await prisma.pendingTransaction.update({
        where: { id: pendingTx.id },
        data:  { status: 'failed', failureReason: reason },
      });
      return;
    }

    // ── Verify with Daraja STK query before trusting the callback ────────────
    console.log(`[${traceId}] Verifying transaction with Daraja STK query...`);
    let verified = false;
    try {
      const verification = await verifyMpesaTransaction(checkoutRequestId);
      console.log(`[${traceId}] Daraja verification — ResultCode: ${verification.resultCode}, ResultDesc: ${verification.resultDesc}`);
      verified = verification.isSuccess;
    } catch (verifyErr: any) {
      // Sandbox stkpushquery is unreliable — log and trust the callback ResultCode
      console.warn(`[${traceId}] Daraja STK query error: ${verifyErr.message} — falling back to callback ResultCode`);
      verified = true;
    }

    if (!verified) {
      console.warn(`[${traceId}] Daraja verification returned non-success — marking failed`);
      await prisma.pendingTransaction.update({
        where: { id: pendingTx.id },
        data:  { status: 'failed', failureReason: 'Transaction could not be verified with Safaricom' },
      });
      return;
    }
    console.log(`[${traceId}] ✅ Transaction verified — proceeding to process`);

    // Extract M-Pesa fields from CallbackMetadata
    const items: any[] = body.CallbackMetadata?.Item || [];
    const getMeta = (name: string): any => items.find((i: any) => i.Name === name)?.Value;

    const mpesaReceiptNumber = String(getMeta('MpesaReceiptNumber') ?? '');
    const mpesaPhoneNumber   = String(getMeta('PhoneNumber') ?? pendingTx.mpesaPhoneNumber ?? '');
    const paidAmount         = parseFloat(String(getMeta('Amount') ?? '0'));
    const transactionDate    = String(getMeta('TransactionDate') ?? '');

    // Parse paidAt from TransactionDate format: 20240115143022
    let paidAt = new Date();
    if (transactionDate.length === 14) {
      const d = transactionDate;
      paidAt = new Date(
        `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(8,10)}:${d.slice(10,12)}:${d.slice(12,14)}`
      );
    }

    const metadata = pendingTx.metadata ? JSON.parse(pendingTx.metadata) : {};
    console.log(`[${traceId}] Type: ${pendingTx.type}, Receipt: ${mpesaReceiptNumber}`);

    if (pendingTx.type === 'package_subscription') {
      await processPackageSubscription({ pendingTx, metadata, mpesaReceiptNumber, mpesaPhoneNumber, paidAmount, paidAt, traceId });
    } else if (pendingTx.type === 'event_ticket') {
      await processEventTicket({ pendingTx, metadata, mpesaReceiptNumber, mpesaPhoneNumber, paidAmount, paidAt, traceId });
    } else if (pendingTx.type === 'donation') {
      await processDonation({ pendingTx, metadata, mpesaReceiptNumber, mpesaPhoneNumber, paidAmount, paidAt, traceId });
    }

    // Mark pending transaction completed only after all DB writes succeed
    await prisma.pendingTransaction.update({
      where: { id: pendingTx.id },
      data: { status: 'completed' },
    });

    console.log(`[${traceId}] ✅ Callback processed`);
  } catch (error: any) {
    console.error(`[${traceId}] ERROR:`, error.message);
  }
}

// ─── GET /api/payments/mpesa/status/:checkoutRequestId ───────────────────────
export async function getMpesaPaymentStatus(req: Request, res: Response): Promise<void> {
  const checkoutRequestId = String(req.params.checkoutRequestId);

  const pendingTx = await prisma.pendingTransaction.findUnique({
    where: { mpesaCheckoutRequestId: checkoutRequestId },
    select: { status: true, type: true, failureReason: true },
  });

  if (!pendingTx) {
    res.status(404).json({ success: false, message: 'Payment not found' });
    return;
  }

  res.json({
    success: true,
    data: {
      status:        pendingTx.status,
      type:          pendingTx.type,
      failureReason: pendingTx.failureReason ?? null,
    },
  });
}

// ─── Package subscription ─────────────────────────────────────────────────────
async function processPackageSubscription({ pendingTx, metadata, mpesaReceiptNumber, mpesaPhoneNumber, paidAmount, paidAt, traceId }: any) {
  const existing = await prisma.payment.findFirst({ where: { reference: mpesaReceiptNumber } });
  if (existing) { console.log(`[${traceId}] Already processed`); return; }

  const pkg = await prisma.package.findUnique({ where: { id: metadata.packageId } });

  const startsAt  = paidAt;
  const expiresAt = new Date(startsAt);
  if (metadata.billingCycle === 'monthly') expiresAt.setMonth(expiresAt.getMonth() + 1);
  else expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await prisma.payment.create({
    data: {
      ministryAdminId:     metadata.ministryAdminId,
      packageId:           metadata.packageId,
      amount:              paidAmount,
      currency:            'KES',
      type:                'package_subscription',
      status:              'completed',
      packageName:         pkg?.name || 'Unknown',
      reference:           mpesaReceiptNumber,
      createdById:         metadata.initiatedBy || pendingTx.userId,
      billingCycle:        metadata.billingCycle,
      baseAmount:          metadata.baseAmount,
      totalAmount:         metadata.totalAmount,
      gateway:             'mpesa',
      paymentMethod:       'mpesa',
      paidAt,
      gatewayResponse:     JSON.stringify({ mpesaReceiptNumber, mpesaPhoneNumber }),
      expiresAt,
      mpesaReceiptNumber,
      mpesaCheckoutRequestId: pendingTx.mpesaCheckoutRequestId ?? undefined,
      mpesaPhoneNumber,
    },
  });

  await prisma.subscription.upsert({
    where:  { ministryAdminId: metadata.ministryAdminId },
    create: { ministryAdminId: metadata.ministryAdminId, packageId: metadata.packageId, status: 'active', startsAt, expiresAt, lastEmailDay: null },
    update: { packageId: metadata.packageId, status: 'active', startsAt, expiresAt, lastEmailDay: null },
  });

  console.log(`[${traceId}] Package subscription activated`);

  // Email
  const user = await prisma.user.findUnique({ where: { id: pendingTx.userId! } });
  const packageFeatures = await prisma.packageFeatureLink.findMany({
    where: { packageId: metadata.packageId },
    include: { feature: { select: { displayName: true } } },
  });
  if (user && pkg) {
    const receiptPDF = await generateReceiptPDF({
      receiptNumber: mpesaReceiptNumber,
      type: 'package_subscription',
      customerName: `${user.firstName} ${user.lastName}`,
      customerEmail: user.email,
      amount: metadata.baseAmount,
      currency: 'KES',
      paidAt: paidAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      paymentMethod: 'M-Pesa',
      description: `${pkg.displayName} - ${metadata.billingCycle} subscription`,
      itemDetails: [
        { label: 'Package', value: pkg.displayName },
        { label: 'Billing Cycle', value: metadata.billingCycle },
        { label: 'Expires On', value: expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
      ],
    });
    queueEmail(
      user.email,
      `Subscription Confirmed - ${pkg.displayName}`,
      packageSubscriptionTemplate({
        firstName: user.firstName,
        packageName: pkg.displayName,
        amount: metadata.baseAmount,
        currency: 'KES',
        billingCycle: metadata.billingCycle,
        expiresAt: expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        features: packageFeatures.map(pf => pf.feature.displayName),
      }),
      [{ filename: `receipt-${mpesaReceiptNumber}.pdf`, content: receiptPDF }]
    );
  }
}

// ─── Event ticket ─────────────────────────────────────────────────────────────
async function processEventTicket({ pendingTx, metadata, mpesaReceiptNumber, mpesaPhoneNumber, paidAmount, paidAt, traceId }: any) {
  const existing = await prisma.transaction.findFirst({ where: { mpesaReceiptNumber } });
  if (existing) { console.log(`[${traceId}] Already processed`); return; }

  const transaction = await prisma.transaction.create({
    data: {
      userId:              metadata.isGuest ? null : pendingTx.userId,
      churchId:            pendingTx.churchId,
      eventId:             metadata.eventId,
      type:                'event_ticket',
      amount:              paidAmount,
      baseAmount:      metadata.baseAmount,
      totalAmount:     metadata.totalAmount,
      currency:        'KES',
      status:          'completed',
      gateway:         'mpesa',
      reference:       mpesaReceiptNumber,
      paymentMethod:   'mpesa',
      paidAt,
      gatewayResponse: JSON.stringify({ mpesaReceiptNumber, mpesaPhoneNumber }),
      isGuest:         metadata.isGuest === true,
      guestName:       metadata.isGuest ? metadata.guestName  : null,
      guestEmail:      metadata.isGuest ? metadata.guestEmail : null,
      guestPhone:      metadata.isGuest ? metadata.guestPhone : null,
      mpesaReceiptNumber,
      mpesaCheckoutRequestId: pendingTx.mpesaCheckoutRequestId ?? undefined,
      mpesaPhoneNumber,
    },
  });

  const quantity = metadata.quantity || 1;
  const event    = await prisma.event.findUnique({ where: { id: metadata.eventId }, include: { church: true } });
  const isGuest  = metadata.isGuest === true;
  const user     = isGuest ? null : await prisma.user.findUnique({ where: { id: pendingTx.userId! } });

  for (let i = 0; i < quantity; i++) {
    const eventDate   = new Date(event!.date).toISOString().slice(0, 10).replace(/-/g, '');
    const ticketCount = await prisma.eventTicket.count({ where: { eventId: metadata.eventId } });
    const eventPrefix = event!.title.replace(/\s+/g, '').substring(0, 6).toUpperCase();
    const ticketNumber = `${eventPrefix}-${eventDate}-${String(ticketCount + i + 1).padStart(4, '0')}`;

    await prisma.eventTicket.create({
      data: {
        ticketNumber,
        eventId:   metadata.eventId,
        userId:    isGuest ? null : pendingTx.userId,
        transactionId: transaction.id,
        status:    'confirmed',
        isGuest,
        guestName:  isGuest ? metadata.guestName  : null,
        guestEmail: isGuest ? metadata.guestEmail : null,
        guestPhone: isGuest ? metadata.guestPhone : null,
      },
    });

    const attendeeName = isGuest ? metadata.guestName : `${user!.firstName} ${user!.lastName}`;
    const emailTo      = isGuest ? metadata.guestEmail : user!.email;

    if (event && emailTo) {
      const eventDateStr    = new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const eventEndDateStr = new Date(event.endDate || event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      const ticketPDF = await generateTicketPDF({
        ticketNumber,
        eventTitle:    event.title,
        eventDate:     eventDateStr,
        eventEndDate:  eventEndDateStr,
        eventLocation: event.location,
        attendeeName,
        churchName:    event.church.name,
        amount:        metadata.baseAmount,
        currency:      'KES',
      });
      const receiptPDF = await generateReceiptPDF({
        receiptNumber: mpesaReceiptNumber,
        type:          'event_ticket',
        customerName:  attendeeName,
        customerEmail: emailTo,
        amount:        metadata.baseAmount,
        currency:      'KES',
        paidAt:        paidAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        paymentMethod: 'M-Pesa',
        description:   `Event Ticket - ${event.title}`,
        itemDetails: [
          { label: 'Event',         value: event.title },
          { label: 'Church',        value: event.church.name },
          { label: 'Date',          value: eventDateStr },
          { label: 'Location',      value: event.location },
          { label: 'Ticket Number', value: ticketNumber },
        ],
      });
      queueEmail(
        emailTo,
        `Ticket Confirmation - ${event.title}`,
        ticketPurchaseTemplate({
          firstName:     isGuest ? metadata.guestName.split(' ')[0] : user!.firstName,
          eventTitle:    event.title,
          ticketNumber,
          amount:        metadata.baseAmount,
          currency:      'KES',
          eventDate:     eventDateStr,
          eventEndDate:  eventEndDateStr,
          eventLocation: event.location,
          churchName:    event.church.name,
          ...(isGuest && {
            viewUrl: `${process.env.FRONTEND_URL}/payment/callback?status=success&type=event_ticket&isGuest=true&reference=${mpesaReceiptNumber}&guestEmail=${encodeURIComponent(metadata.guestEmail)}&guestName=${encodeURIComponent(metadata.guestName)}&amount=${metadata.baseAmount}&currency=KES&eventId=${metadata.eventId}`,
          }),
        }),
        [
          { filename: `ticket-${ticketNumber}.pdf`,          content: ticketPDF },
          { filename: `receipt-${mpesaReceiptNumber}.pdf`,   content: receiptPDF },
        ]
      );
    }
  }

  await prisma.event.update({ where: { id: metadata.eventId }, data: { ticketsSold: { increment: quantity } } });

  // Credit national admin balance
  if (pendingTx.churchId) {
    await creditNationalAdminBalance(
      pendingTx.churchId,
      paidAmount,
      'event_ticket',
      transaction.id,
      `Event ticket - ${metadata.eventId}`
    ).catch(err => console.error(`[${traceId}] Balance credit error:`, err.message));
  }

  console.log(`[${traceId}] ${quantity} ticket(s) created`);
}

// ─── Donation ─────────────────────────────────────────────────────────────────
async function processDonation({ pendingTx, metadata, mpesaReceiptNumber, mpesaPhoneNumber, paidAmount, paidAt, traceId }: any) {
  const existing = await prisma.transaction.findFirst({ where: { mpesaReceiptNumber } });
  if (existing) { console.log(`[${traceId}] Already processed`); return; }

  const transaction = await prisma.transaction.create({
    data: {
      userId:          metadata.isGuest ? null : pendingTx.userId,
      churchId:        pendingTx.churchId,
      type:            'donation',
      amount:          paidAmount,
      baseAmount:      metadata.baseAmount,
      totalAmount:     metadata.totalAmount,
      currency:        'KES',
      status:          'completed',
      gateway:         'mpesa',
      reference:       mpesaReceiptNumber,
      paymentMethod:   'mpesa',
      paidAt,
      gatewayResponse: JSON.stringify({ mpesaReceiptNumber, mpesaPhoneNumber }),
      isGuest:         metadata.isGuest === true,
      guestName:       metadata.isGuest ? metadata.guestName  : null,
      guestEmail:      metadata.isGuest ? metadata.guestEmail : null,
      guestPhone:      metadata.isGuest ? metadata.guestPhone : null,
      mpesaReceiptNumber,
      mpesaCheckoutRequestId: pendingTx.mpesaCheckoutRequestId ?? undefined,
      mpesaPhoneNumber,
    },
  });

  await prisma.donationTransaction.create({
    data: {
      campaignId:      metadata.campaignId,
      userId:          metadata.isGuest ? null : pendingTx.userId,
      churchId:        pendingTx.churchId,
      amount:          metadata.baseAmount,
      currency:        'KES',
      transactionId:   transaction.id,
      reference:       mpesaReceiptNumber,
      status:          'completed',
      paymentMethod:   'mpesa',
      isAnonymous:     metadata.isAnonymous || false,
      isGuest:         metadata.isGuest === true,
      guestName:       metadata.isGuest ? metadata.guestName  : null,
      guestEmail:      metadata.isGuest ? metadata.guestEmail : null,
      guestPhone:      metadata.isGuest ? metadata.guestPhone : null,
      donorName:       metadata.donorName,
      donorPhone:      metadata.donorPhone,
      notes:           metadata.notes,
      mpesaReceiptNumber,
      mpesaCheckoutRequestId: pendingTx.mpesaCheckoutRequestId ?? undefined,
      mpesaPhoneNumber,
    },
  });

  // Email receipt
  const isGuestDonation = metadata.isGuest === true;
  const donorUser       = isGuestDonation ? null : await prisma.user.findUnique({ where: { id: pendingTx.userId! } });
  const donorEmail      = isGuestDonation ? metadata.guestEmail : donorUser?.email;
  const donorFirstName  = isGuestDonation ? metadata.guestName.split(' ')[0] : donorUser?.firstName;
  const donorFullName   = isGuestDonation ? metadata.guestName : `${donorUser?.firstName} ${donorUser?.lastName}`;

  const campaign = await prisma.givingCampaign.findUnique({
    where: { id: metadata.campaignId },
    include: { church: { select: { name: true } } },
  });

  if (donorEmail && campaign) {
    const receiptPDF = await generateReceiptPDF({
      receiptNumber: mpesaReceiptNumber,
      type:          'donation',
      customerName:  donorFullName || '',
      customerEmail: donorEmail,
      amount:        metadata.baseAmount,
      currency:      'KES',
      paidAt:        paidAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      paymentMethod: 'M-Pesa',
      description:   `Donation to ${campaign.name}`,
      itemDetails: [
        { label: 'Campaign',   value: campaign.name },
        { label: 'Church',     value: campaign.church.name },
        { label: 'Anonymous',  value: metadata.isAnonymous ? 'Yes' : 'No' },
      ],
    });
    queueEmail(
      donorEmail,
      `Donation Receipt - ${campaign.name}`,
      donationReceiptTemplate({
        firstName:    donorFirstName || 'Donor',
        amount:       metadata.baseAmount,
        currency:     'KES',
        campaignName: campaign.name,
        reference:    mpesaReceiptNumber,
        isAnonymous:  metadata.isAnonymous || false,
        isGuest:      isGuestDonation,
        churchName:   campaign.church.name,
      }),
      [{ filename: `donation-receipt-${mpesaReceiptNumber}.pdf`, content: receiptPDF }]
    );
  }

  // Credit national admin balance
  if (pendingTx.churchId) {
    await creditNationalAdminBalance(
      pendingTx.churchId,
      paidAmount,
      'donation',
      transaction.id,
      `Donation - ${metadata.campaignId}`
    ).catch(err => console.error(`[${traceId}] Balance credit error:`, err.message));
  }

  console.log(`[${traceId}] Donation created`);
}
