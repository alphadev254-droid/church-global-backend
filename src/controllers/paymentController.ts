import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import axios from 'axios';
import { getPaymentGateway, getCurrency, getGatewayCountry } from '../utils/gatewayRouter';
import { calculatePaymentFees } from '../utils/feeCalculations';
import { convertUSDToLocal } from '../utils/currencyConversion';
import { queueEmail } from '../lib/emailQueue';
import { ticketPurchaseTemplate, donationReceiptTemplate, packageSubscriptionTemplate } from '../lib/emailTemplates';
import { generateTicketPDF } from '../lib/ticketPDF';
import { generateReceiptPDF } from '../lib/receiptPDF';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';
const SYSTEM_SUBACCOUNT_CODE = process.env.SYSTEM_SUBACCOUNT_CODE!;
const BACKEND_URL = process.env.BACKEND_URL!;

const subscribeSchema = z.object({
  packageId: z.string().min(1, 'Package ID required'),
  billingCycle: z.enum(['monthly', 'yearly']),
});

export async function initiatePackageSubscription(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role;
  const traceId = `PKG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`[${traceId}] ========== PACKAGE SUBSCRIPTION INITIATED ==========`);
  console.log(`[${traceId}] User ID: ${userId}, Role: ${role}`);
  console.log(`[${traceId}] Request body:`, req.body);
  
  if (!userId) {
    console.log(`[${traceId}] ERROR: Not authenticated`);
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log(`[${traceId}] ERROR: Validation failed:`, parsed.error.errors);
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { packageId, billingCycle } = parsed.data;
  console.log(`[${traceId}] Package ID: ${packageId}, Billing: ${billingCycle}`);

  // Get current user with ministryAdminId field
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    console.log(`[${traceId}] ERROR: User not found`);
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }
  console.log(`[${traceId}] User found: ${user.email}`);

  // Determine national admin
  let ministryAdminId: string;
  let ministryAdmin: any;
  
  if (role === 'ministry_admin') {
    ministryAdminId = userId;
    ministryAdmin = user;
    console.log(`[${traceId}] User is national admin`);
  } else {
    // Other roles: get national admin from ministryAdminId field
    if (!user.ministryAdminId) {
      console.log(`[${traceId}] ERROR: No national admin assigned`);
      res.status(400).json({ success: false, message: 'No national admin assigned to your account' });
      return;
    }
    ministryAdminId = user.ministryAdminId;
    ministryAdmin = await prisma.user.findUnique({ where: { id: ministryAdminId } });
    if (!ministryAdmin) {
      console.log(`[${traceId}] ERROR: National admin not found: ${ministryAdminId}`);
      res.status(404).json({ success: false, message: 'National admin not found' });
      return;
    }
    console.log(`[${traceId}] National admin found: ${ministryAdmin.email}`);
  }

  if (!ministryAdmin.email) {
    console.log(`[${traceId}] ERROR: National admin email missing`);
    res.status(400).json({ success: false, message: 'National admin email required for payment' });
    return;
  }

  const pkg = await prisma.package.findUnique({ where: { id: packageId } });
  if (!pkg) {
    console.log(`[${traceId}] ERROR: Package not found: ${packageId}`);
    res.status(404).json({ success: false, message: 'Package not found' });
    return;
  }
  console.log(`[${traceId}] Package: ${pkg.name} (${pkg.displayName})`);

  // Package prices are stored in USD, convert to local currency based on user's country
  // - Malawi users: USD → MWK (via Paychangu gateway)
  // - Kenya users: USD → KSH (via Paystack gateway)
  const baseAmountUSD = billingCycle === 'monthly' ? pkg.priceMonthly : pkg.priceYearly;
  
  // Determine gateway based on national admin's accountCountry
  console.log(`[${traceId}] Calling getPaymentGateway for ministryAdminId: ${ministryAdminId}`);
  const gateway = await getPaymentGateway(ministryAdminId);
  const currency = getCurrency(gateway); // Returns 'MWK' for Malawi, 'KSH' for Kenya
  const gatewayCountry = getGatewayCountry(gateway);
  
  console.log(`[${traceId}] Gateway: ${gateway}, Country: ${gatewayCountry}, Currency: ${currency}`);
  console.log(`[${traceId}] National Admin accountCountry: ${ministryAdmin.accountCountry}`);
  console.log(`[${traceId}] Package price in USD: ${baseAmountUSD}`);
  
  // Convert USD to local currency using exchange rates
  const baseAmount = convertUSDToLocal(baseAmountUSD, currency as 'MWK' | 'KES');
  console.log(`[${traceId}] Converted amount: ${baseAmount} ${currency}`);
  
  // Calculate fees (Kenya has no tax, Malawi has 17.5% tax)
  const fees = calculatePaymentFees(baseAmount, gatewayCountry);
  
  console.log(`[${traceId}] Fees - Base: ${fees.baseAmount}, Convenience: ${fees.convenienceFee}, System Fee: ${fees.systemFeeAmount}, Total: ${fees.totalAmount}`);
  console.log(`[${traceId}] Routing to: ${gateway === 'paychangu' ? 'PAYCHANGU (Malawi)' : 'PAYSTACK (Kenya)'}`);
  
  const amountInKobo = Math.round(fees.totalAmount * 100);
  


  // Create pending transaction (expires in 1 hour)
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1);

  const pendingTx = await prisma.pendingTransaction.create({
    data: {
      amount: fees.totalAmount,
      currency,
      userId,
      churchId: user.churchId || '',
      type: 'package_subscription',
      expiresAt,
      metadata: JSON.stringify({
        traceId,
        ministryAdminId,
        packageId,
        packageName: pkg.name,
        billingCycle,
        baseAmount: fees.baseAmount,
        convenienceFee: fees.convenienceFee,
        systemFeeAmount: fees.systemFeeAmount,
        totalAmount: fees.totalAmount,
        gatewayFeeRate: fees.systemGatewayFeeRate,
        systemFeeRate: fees.systemFeeRate,
        gateway,
        gatewayCountry,
      }),
    },
  });
  console.log(`[${traceId}] Pending transaction created: ${pendingTx.id}`);
  console.log(`[${traceId}] Pending transaction metadata:`, pendingTx.metadata ? JSON.parse(pendingTx.metadata) : {});

  // Route to appropriate gateway
  if (gateway === 'paychangu') {
    console.log(`[${traceId}] ========== ROUTING TO PAYCHANGU ==========`);
    return await initiatePaychanguPayment(pendingTx, ministryAdmin, fees, traceId, res);
  } else {
    console.log(`[${traceId}] ========== ROUTING TO PAYSTACK ==========`);
    return await initiatePaystackPayment(pendingTx, ministryAdmin, fees, traceId, res);
  }
}

async function initiatePaystackPayment(
  pendingTx: any,
  ministryAdmin: any,
  fees: any,
  traceId: string,
  res: Response
): Promise<void> {
  console.log(`[${traceId}] initiatePaystackPayment called`);
  const amountInKobo = Math.round(fees.totalAmount * 100);
  console.log(`[${traceId}] Amount in kobo: ${amountInKobo}`);

  try {
    const metadata = pendingTx.metadata ? JSON.parse(pendingTx.metadata) : {};
    const paystackPayload = {
      email: ministryAdmin.email,
      amount: amountInKobo,
      callback_url: `${BACKEND_URL}/api/payments/verify`,
      metadata: {
        ...metadata,
        type: 'package_subscription',
        pendingTxId: pendingTx.id,
        initiatedBy: pendingTx.userId,
      },
      ...(SYSTEM_SUBACCOUNT_CODE && { subaccount: SYSTEM_SUBACCOUNT_CODE }),
    };
    
    console.log(`[${traceId}] Paystack request:`, JSON.stringify(paystackPayload, null, 2));
    console.log(`[${traceId}] Calling Paystack API: ${PAYSTACK_BASE_URL}/transaction/initialize`);
    
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

    console.log(`[${traceId}] Paystack API call successful`);
    console.log(`[${traceId}] Paystack response:`, JSON.stringify(response.data, null, 2));

    // Update pending transaction with reference
    console.log(`[${traceId}] Updating pending transaction with reference: ${response.data.data.reference}`);
    await prisma.pendingTransaction.update({
      where: { id: pendingTx.id },
      data: { reference: response.data.data.reference },
    });

    console.log(`[${traceId}] Paystack SUCCESS:`, {
      reference: response.data.data.reference,
      access_code: response.data.data.access_code,
    });

    console.log(`[${traceId}] Sending response to client`);
    res.json({
      success: true,
      data: {
        authorization_url: response.data.data.authorization_url,
        access_code: response.data.data.access_code,
        reference: response.data.data.reference,
      },
    });
  } catch (error: any) {
    console.log(`[${traceId}] Paystack error occurred, deleting pending transaction`);
    await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
    
    console.error(`[${traceId}] ========== PAYSTACK ERROR ==========`);
    console.error(`[${traceId}] Status:`, error.response?.status);
    console.error(`[${traceId}] Response:`, JSON.stringify(error.response?.data, null, 2));
    console.error(`[${traceId}] Message:`, error.message);
    
    if (error.response?.data?.message?.includes('No active channel')) {
      res.status(400).json({ 
        success: false, 
        message: 'Payment channels not activated. Please ensure SYSTEM_SUBACCOUNT_CODE is properly configured in Paystack.' 
      });
    } else {
      res.status(500).json({
        success: false,
        message: error.response?.data?.message || 'Failed to initialize payment',
      });
    }
  }
}

async function initiatePaychanguPayment(
  pendingTx: any,
  ministryAdmin: any,
  fees: any,
  traceId: string,
  res: Response
): Promise<void> {
  console.log(`[${traceId}] initiatePaychanguPayment called`);
  const PAYCHANGU_SECRET_KEY = process.env.PAYCHANGU_SECRET_KEY!;
  console.log(`[${traceId}] Paychangu secret key exists: ${!!PAYCHANGU_SECRET_KEY}`);

  try {
    const tx_ref = pendingTx.reference || `PKG-${Date.now()}`;
    console.log(`[${traceId}] Transaction reference: ${tx_ref}`);
    
    const paychanguPayload = {
      amount: fees.totalAmount,
      currency: 'MWK',
      email: ministryAdmin.email,
      tx_ref,
      callback_url: `${BACKEND_URL}/api/webhooks/paychangu/callback`,
      return_url: `${process.env.FRONTEND_URL}/dashboard/packages?status=cancelled`,
      customization: {
        title: 'Package Subscription',
        description: 'ICIMS Package Subscription'
      }
    };
    
    console.log(`[${traceId}] Paychangu request:`, JSON.stringify(paychanguPayload, null, 2));
    console.log(`[${traceId}] Calling Paychangu API: https://api.paychangu.com/payment`);
    
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

    console.log(`[${traceId}] Paychangu API call successful`);
    console.log(`[${traceId}] Paychangu response:`, JSON.stringify(response.data, null, 2));

    // Update pending transaction with reference
    console.log(`[${traceId}] Updating pending transaction with reference: ${tx_ref}`);
    await prisma.pendingTransaction.update({
      where: { id: pendingTx.id },
      data: { reference: tx_ref },
    });

    console.log(`[${traceId}] Paychangu SUCCESS:`, {
      checkout_url: response.data.data?.checkout_url,
    });

    console.log(`[${traceId}] Sending response to client`);
    res.json({
      success: true,
      data: {
        authorization_url: response.data.data?.checkout_url,
        reference: tx_ref,
      },
    });
  } catch (error: any) {
    console.log(`[${traceId}] Paychangu error occurred, deleting pending transaction`);
    await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
    
    console.error(`[${traceId}] ========== PAYCHANGU ERROR ==========`);
    console.error(`[${traceId}] Status:`, error.response?.status);
    console.error(`[${traceId}] Response:`, JSON.stringify(error.response?.data, null, 2));
    console.error(`[${traceId}] Message:`, error.message);
    
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Failed to initialize payment',
    });
  }
}

export async function verifyPayment(req: Request, res: Response): Promise<void> {
  const { reference } = req.query;
  const traceId = `VERIFY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  console.log(`[${traceId}] ========== PAYMENT VERIFICATION ==========`);
  console.log(`[${traceId}] Reference: ${reference}`);

  if (!reference) {
    console.log(`[${traceId}] ERROR: Missing reference`);
    res.status(400).json({ success: false, message: 'Reference required' });
    return;
  }

  try {
    console.log(`[${traceId}] Verifying with Paystack...`);
    
    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const { data } = response.data;
    console.log(`[${traceId}] Paystack response:`, {
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      paid_at: data.paid_at,
      metadata: data.metadata,
    });

    if (data.status === 'success') {
      const { metadata } = data;
      const amount = data.amount / 100;
      const type = metadata.type || 'event_ticket';
      const originalTraceId = metadata.traceId || 'UNKNOWN';

      console.log(`[${traceId}] Payment successful - Type: ${type}, Amount: ${amount}`);
      console.log(`[${traceId}] Original trace ID: ${originalTraceId}`);

      // Handle package subscription
      if (type === 'package_subscription') {
        console.log(`[${traceId}] ========== PACKAGE SUBSCRIPTION ==========`);
        console.log(`[${traceId}] ministryAdminId: ${metadata.ministryAdminId}`);
        console.log(`[${traceId}] packageId: ${metadata.packageId}`);
        console.log(`[${traceId}] billingCycle: ${metadata.billingCycle}`);
        console.log(`[${traceId}] pendingTxId: ${metadata.pendingTxId}`);
        console.log(`[${traceId}] initiatedBy: ${metadata.initiatedBy}`);

        const existingPayment = await prisma.payment.findFirst({ where: { reference: data.reference } });
        if (existingPayment) {
          console.log(`[${traceId}] Payment already processed: ${existingPayment.id}`);
          res.redirect(`${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=success&type=package_subscription`);
          return;
        }
        console.log(`[${traceId}] No duplicate found — proceeding`);
        
        const pkg = await prisma.package.findUnique({ where: { id: metadata.packageId } });
        console.log(`[${traceId}] Package: ${pkg ? pkg.name : 'NOT FOUND'}`);

        // Get pending transaction
        const pendingTx = await prisma.pendingTransaction.findUnique({
          where: { id: metadata.pendingTxId },
        });
        console.log(`[${traceId}] PendingTransaction: ${pendingTx ? pendingTx.id : 'NOT FOUND'}`);

        // Parse metadata from pending transaction
        const pendingMetadata = pendingTx?.metadata ? JSON.parse(pendingTx.metadata) : {};
        console.log(`[${traceId}] PendingMetadata:`, pendingMetadata);
        const baseAmount = pendingMetadata.baseAmount || amount;
        const convenienceFee = pendingMetadata.convenienceFee || 0;
        const systemFeeAmount = pendingMetadata.systemFeeAmount || 0;
        const totalAmount = pendingMetadata.totalAmount || amount;
        const gateway = pendingMetadata.gateway || 'paystack';
        const gatewayCountry = pendingMetadata.gatewayCountry || 'Kenya';
        const systemGatewayFeeRate = pendingMetadata.gatewayFeeRate || 0;
        const systemFeeRate = pendingMetadata.systemFeeRate || 0;
        console.log(`[${traceId}] Fee breakdown — base: ${baseAmount}, convenience: ${convenienceFee}, systemFee: ${systemFeeAmount}, total: ${totalAmount}`);

        // Create payment record
        const startsAt = new Date(data.paid_at);
        const expiresAt = new Date(startsAt);
        if (metadata.billingCycle === 'monthly') {
          expiresAt.setMonth(expiresAt.getMonth() + 1);
        } else {
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        }
        console.log(`[${traceId}] Subscription period — startsAt: ${startsAt.toISOString()}, expiresAt: ${expiresAt.toISOString()}`);

        const payment = await prisma.payment.create({
          data: {
            ministryAdminId: metadata.ministryAdminId,
            packageId: metadata.packageId,
            amount,
            currency: data.currency,
            type: 'package_subscription',
            status: 'completed',
            packageName: pkg?.name || 'Unknown',
            reference: data.reference,
            createdById: metadata.initiatedBy,
            billingCycle: metadata.billingCycle,
            baseAmount,
            convenienceFee,
            systemFeeAmount,
            totalAmount,
            gateway,
            paymentMethod: data.channel || 'card',
            channel: data.channel,
            paidAt: new Date(data.paid_at),
            customerEmail: data.customer?.email,
            customerPhone: data.customer?.phone,
            cardLast4: data.authorization?.last4,
            cardBank: data.authorization?.bank,
            subaccountCode: data.subaccount?.subaccount_code || SYSTEM_SUBACCOUNT_CODE,
            subaccountName: data.subaccount?.business_name || 'ICIMS System',
            gatewayCharge: data.fees ? data.fees / 100 : 0,
            systemGatewayFeeRate,
            systemFeeRate,
            gatewayResponse: JSON.stringify(data),
            expiresAt,
          },
        });
        console.log(`[${traceId}] Payment record created: ${payment.id}`);
        console.log(`[${traceId}] Payment — amount: ${payment.amount}, currency: ${payment.currency}, gateway: ${payment.gateway}, gatewayCharge: ${payment.gatewayCharge}`);

        // Create or update subscription and reset email tracking
        await prisma.subscription.upsert({
          where: { ministryAdminId: metadata.ministryAdminId },
          create: {
            ministryAdminId: metadata.ministryAdminId,
            packageId: metadata.packageId,
            status: 'active',
            startsAt,
            expiresAt,
            lastEmailDay: null,
          },
          update: {
            packageId: metadata.packageId,
            status: 'active',
            startsAt,
            expiresAt,
            lastEmailDay: null,
          },
        });
        console.log(`[${traceId}] Subscription upserted — ministryAdminId: ${metadata.ministryAdminId}, expiresAt: ${expiresAt.toISOString()}`);

        // Delete pending transaction
        if (pendingTx) {
          await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } });
          console.log(`[${traceId}] Pending transaction deleted`);
        }

        // Send package subscription confirmation email with PDF receipt
        const subscriberUser = await prisma.user.findUnique({ where: { id: metadata.initiatedBy } });
        const packageFeatures = await prisma.packageFeatureLink.findMany({
          where: { packageId: metadata.packageId },
          include: { feature: { select: { displayName: true } } }
        });
        
        if (subscriberUser && pkg) {
          const receiptPDF = await generateReceiptPDF({
            receiptNumber: data.reference,
            type: 'package_subscription',
            customerName: `${subscriberUser.firstName} ${subscriberUser.lastName}`,
            customerEmail: subscriberUser.email,
            amount: baseAmount,
            currency: data.currency,
            paidAt: new Date(data.paid_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            paymentMethod: data.channel || 'card',
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
              currency: data.currency,
              billingCycle: metadata.billingCycle,
              expiresAt: expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
              features: packageFeatures.map(pf => pf.feature.displayName)
            }),
            [{ filename: `receipt-${data.reference}.pdf`, content: receiptPDF }]
          );
        }

        console.log(`[${traceId}] Redirecting to: /payment/callback?reference=${reference}&status=success&type=package_subscription`);

        res.redirect(`${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=success&type=package_subscription`);
      } else if (type === 'event_ticket') {
        console.log(`[${traceId}] Processing event ticket...`);

        const existingTransaction = await prisma.transaction.findFirst({ where: { reference: data.reference } });
        if (existingTransaction) {
          console.log(`[${traceId}] Already processed by webhook: ${existingTransaction.id}`);
          const isGuest = metadata.isGuest === 'true' || metadata.isGuest === true;
          const callbackUrl = isGuest
            ? `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=success&type=event_ticket&isGuest=true&guestEmail=${encodeURIComponent(metadata.guestEmail)}&guestName=${encodeURIComponent(metadata.guestName)}&amount=${metadata.baseAmount}&currency=${data.currency}&eventId=${metadata.eventId}`
            : `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=success&type=event_ticket`;
          res.redirect(callbackUrl);
          return;
        }

        const pendingTx = await prisma.pendingTransaction.findUnique({
          where: { reference: String(reference) }
        });

        if (!pendingTx) {
          console.log(`[${traceId}] Pending transaction not found and no existing transaction`);
          res.redirect(`${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=failed`);
          return;
        }
        
        const pendingMetadata = pendingTx.metadata ? JSON.parse(pendingTx.metadata) : {};
        console.log(`[${traceId}] Fee breakdown - Base: ${pendingMetadata.baseAmount}, Convenience: ${pendingMetadata.convenienceFee}, System Fee: ${pendingMetadata.systemFeeAmount}, Total: ${pendingMetadata.totalAmount}`);
        
        // Create transaction
        const transaction = await prisma.transaction.create({
          data: {
            userId: pendingMetadata.isGuest ? null : (metadata.userId || pendingTx.userId),
            churchId: pendingTx.churchId,
            eventId: pendingMetadata.eventId,
            type: 'event_ticket',
            amount: data.amount / 100,
            baseAmount: pendingMetadata.baseAmount,
            convenienceFee: pendingMetadata.convenienceFee,
            systemFeeAmount: pendingMetadata.systemFeeAmount,
            totalAmount: pendingMetadata.totalAmount,
            currency: data.currency,
            status: 'completed',
            gateway: pendingMetadata.gateway,
            gatewayCountry: pendingMetadata.gatewayCountry,
            reference: data.reference,
            paymentMethod: data.channel || 'card',
            channel: data.channel,
            paidAt: new Date(data.paid_at),
            customerEmail: data.customer?.email,
            customerPhone: data.customer?.phone,
            cardLast4: data.authorization?.last4,
            cardBank: data.authorization?.bank,
            gatewayCharge: data.fees ? data.fees / 100 : 0,
            systemGatewayFeeRate: pendingMetadata.gatewayFeeRate || 0,
            systemFeeRate: pendingMetadata.systemFeeRate || 0,
            subaccountCode: metadata.subaccountCode || data.subaccount?.subaccount_code,
            subaccountName: metadata.subaccountName || data.subaccount?.business_name,
            gatewayResponse: JSON.stringify(data),
            isGuest: pendingMetadata.isGuest === true,
            guestName: pendingMetadata.isGuest ? pendingMetadata.guestName : null,
            guestEmail: pendingMetadata.isGuest ? pendingMetadata.guestEmail : null,
            guestPhone: pendingMetadata.isGuest ? pendingMetadata.guestPhone : null,
          }
        });
        
        console.log(`[${traceId}] Transaction created: ${transaction.id}`);
        console.log(`[${traceId}] Subaccount: ${transaction.subaccountCode} - ${transaction.subaccountName}`);
        console.log(`[${traceId}] Transaction saved with fees - Base: ${transaction.baseAmount}, Convenience: ${transaction.convenienceFee}, System Fee: ${transaction.systemFeeAmount}, Gateway Charge: ${transaction.gatewayCharge}`);
        console.log(`[${traceId}] System fee applied: ${pendingMetadata.systemFeeAmount > 0 ? 'YES' : 'NO'} (${pendingMetadata.gatewayCountry})`);
        
        // Create tickets
        const quantity = pendingMetadata.quantity || 1;
        const event = await prisma.event.findUnique({ where: { id: pendingMetadata.eventId }, include: { church: true } });
        const isGuestTicket = pendingMetadata.isGuest === true;
        const user = isGuestTicket ? null : await prisma.user.findUnique({ where: { id: pendingTx.userId! } });
        
        for (let i = 0; i < quantity; i++) {
          const eventDate = new Date(event!.date).toISOString().slice(0, 10).replace(/-/g, '');
          const ticketCount = await prisma.eventTicket.count({ where: { eventId: pendingMetadata.eventId } });
          const eventPrefix = event!.title.replace(/\s+/g, '').substring(0, 6).toUpperCase();
          const ticketNumber = `${eventPrefix}-${eventDate}-${String(ticketCount + i + 1).padStart(4, '0')}`;
          
          await prisma.eventTicket.create({
            data: {
              ticketNumber,
              eventId: pendingMetadata.eventId,
              userId: isGuestTicket ? null : pendingTx.userId,
              transactionId: transaction.id,
              status: 'confirmed',
              isGuest: isGuestTicket,
              guestName: isGuestTicket ? pendingMetadata.guestName : null,
              guestEmail: isGuestTicket ? pendingMetadata.guestEmail : null,
              guestPhone: isGuestTicket ? pendingMetadata.guestPhone : null,
            }
          });
          
          // Send email — guest path
          if (isGuestTicket && event) {
            const attendeeName = pendingMetadata.guestName;
            const emailTo = pendingMetadata.guestEmail;
            const ticketPDF = await generateTicketPDF({
              ticketNumber,
              eventTitle: event.title,
              eventDate: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
              eventEndDate: new Date(event.endDate || event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
              eventLocation: event.location,
              attendeeName,
              churchName: event.church.name,
              amount: pendingMetadata.baseAmount,
              currency: data.currency,
            });
            const receiptPDF = await generateReceiptPDF({
              receiptNumber: data.reference,
              type: 'event_ticket',
              customerName: attendeeName,
              customerEmail: emailTo,
              amount: pendingMetadata.baseAmount,
              currency: data.currency,
              paidAt: new Date(data.paid_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
              paymentMethod: data.channel || 'card',
              description: `Event Ticket - ${event.title}`,
              itemDetails: [
                { label: 'Event', value: event.title },
                { label: 'Church', value: event.church.name },
                { label: 'Date', value: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) },
                { label: 'Location', value: event.location },
                { label: 'Ticket Number', value: ticketNumber },
              ],
            });
            queueEmail(
              emailTo,
              `Ticket Confirmation - ${event.title}`,
              ticketPurchaseTemplate({
                firstName: attendeeName.split(' ')[0],
                eventTitle: event.title,
                ticketNumber,
                amount: pendingMetadata.baseAmount,
                currency: data.currency,
                eventDate: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
                eventEndDate: new Date(event.endDate || event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
                eventLocation: event.location,
                churchName: event.church.name,
                viewUrl: `${process.env.FRONTEND_URL}/payment/callback?status=success&type=event_ticket&isGuest=true&reference=${data.reference}&guestEmail=${encodeURIComponent(emailTo)}&guestName=${encodeURIComponent(attendeeName)}&amount=${pendingMetadata.baseAmount}&currency=${data.currency}&eventId=${pendingMetadata.eventId}`,
              }),
              [
                { filename: `ticket-${ticketNumber}.pdf`, content: ticketPDF },
                { filename: `receipt-${data.reference}.pdf`, content: receiptPDF },
              ]
            );
          }

          // Send email — registered user path
          if (!isGuestTicket && user && event) {
            const ticketPDF = await generateTicketPDF({
              ticketNumber,
              eventTitle: event.title,
              eventDate: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
              eventEndDate: new Date(event.endDate || event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
              eventLocation: event.location,
              attendeeName: `${user.firstName} ${user.lastName}`,
              churchName: event.church.name,
              amount: pendingMetadata.baseAmount,
              currency: data.currency,
            });
            const receiptPDF = await generateReceiptPDF({
              receiptNumber: data.reference,
              type: 'event_ticket',
              customerName: `${user.firstName} ${user.lastName}`,
              customerEmail: user.email,
              amount: pendingMetadata.baseAmount,
              currency: data.currency,
              paidAt: new Date(data.paid_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
              paymentMethod: data.channel || 'card',
              description: `Event Ticket - ${event.title}`,
              itemDetails: [
                { label: 'Event', value: event.title },
                { label: 'Church', value: event.church.name },
                { label: 'Date', value: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) },
                { label: 'Location', value: event.location },
                { label: 'Ticket Number', value: ticketNumber },
              ],
            });
            queueEmail(
              user.email,
              `Ticket Confirmation - ${event.title}`,
              ticketPurchaseTemplate({
                firstName: user.firstName,
                eventTitle: event.title,
                ticketNumber,
                amount: pendingMetadata.baseAmount,
                currency: data.currency,
                eventDate: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
                eventEndDate: new Date(event.endDate || event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
                eventLocation: event.location,
                churchName: event.church.name,
              }),
              [
                { filename: `ticket-${ticketNumber}.pdf`, content: ticketPDF },
                { filename: `receipt-${data.reference}.pdf`, content: receiptPDF },
              ]
            );
          }
        }
        
        // Update event
        await prisma.event.update({
          where: { id: pendingMetadata.eventId },
          data: { ticketsSold: { increment: quantity } }
        });
        
        // Delete pending transaction
        await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } });
        
        console.log(`[${traceId}] ${quantity} ticket(s) created`);
        const ticketCallbackUrl = pendingMetadata.isGuest
          ? `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=success&type=event_ticket&isGuest=true&guestEmail=${encodeURIComponent(pendingMetadata.guestEmail)}&guestName=${encodeURIComponent(pendingMetadata.guestName)}&amount=${pendingMetadata.baseAmount}&currency=${data.currency}&eventId=${pendingMetadata.eventId}`
          : `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=success&type=event_ticket`;
        res.redirect(ticketCallbackUrl);
      } else if (type === 'donation') {
        console.log(`[${traceId}] Processing donation...`);

        const existingTransaction = await prisma.transaction.findFirst({ where: { reference: data.reference } });
        if (existingTransaction) {
          console.log(`[${traceId}] Already processed by webhook: ${existingTransaction.id}`);
          const isGuest = metadata.isGuest === 'true' || metadata.isGuest === true;
          const callbackUrl = isGuest
            ? `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=success&type=donation&isGuest=true&guestEmail=${encodeURIComponent(metadata.guestEmail)}&guestName=${encodeURIComponent(metadata.guestName)}&amount=${metadata.baseAmount}&currency=${data.currency}`
            : `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=success&type=donation`;
          res.redirect(callbackUrl);
          return;
        }

        const pendingTx = await prisma.pendingTransaction.findUnique({
          where: { reference: String(reference) }
        });

        if (!pendingTx) {
          console.log(`[${traceId}] Pending transaction not found and no existing transaction`);
          res.redirect(`${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=failed`);
          return;
        }
        
        const pendingMetadata = pendingTx.metadata ? JSON.parse(pendingTx.metadata) : {};
        console.log(`[${traceId}] Fee breakdown - Base: ${pendingMetadata.baseAmount}, Convenience: ${pendingMetadata.convenienceFee}, System Fee: ${pendingMetadata.systemFeeAmount}, Total: ${pendingMetadata.totalAmount}`);
        
        // Create transaction
        const transaction = await prisma.transaction.create({
          data: {
            userId: pendingMetadata.isGuest ? null : (metadata.userId || pendingTx.userId),
            churchId: pendingTx.churchId,
            type: 'donation',
            amount: data.amount / 100,
            baseAmount: pendingMetadata.baseAmount,
            convenienceFee: pendingMetadata.convenienceFee,
            systemFeeAmount: pendingMetadata.systemFeeAmount,
            totalAmount: pendingMetadata.totalAmount,
            currency: data.currency,
            status: 'completed',
            gateway: pendingMetadata.gateway,
            gatewayCountry: pendingMetadata.gatewayCountry,
            reference: data.reference,
            paymentMethod: data.channel || 'card',
            channel: data.channel,
            paidAt: new Date(data.paid_at),
            customerEmail: data.customer?.email,
            customerPhone: data.customer?.phone,
            cardLast4: data.authorization?.last4,
            cardBank: data.authorization?.bank,
            gatewayCharge: data.fees ? data.fees / 100 : 0,
            systemGatewayFeeRate: pendingMetadata.gatewayFeeRate || 0,
            systemFeeRate: pendingMetadata.systemFeeRate || 0,
            subaccountCode: metadata.subaccountCode || data.subaccount?.subaccount_code,
            subaccountName: metadata.subaccountName || data.subaccount?.business_name,
            gatewayResponse: JSON.stringify(data),
            isGuest: pendingMetadata.isGuest === true,
            guestName: pendingMetadata.isGuest ? pendingMetadata.guestName : null,
            guestEmail: pendingMetadata.isGuest ? pendingMetadata.guestEmail : null,
            guestPhone: pendingMetadata.isGuest ? pendingMetadata.guestPhone : null,
          }
        });
        
        console.log(`[${traceId}] Transaction created: ${transaction.id}`);
        console.log(`[${traceId}] Subaccount: ${transaction.subaccountCode} - ${transaction.subaccountName}`);
        console.log(`[${traceId}] Transaction saved with fees - Base: ${transaction.baseAmount}, Convenience: ${transaction.convenienceFee}, System Fee: ${transaction.systemFeeAmount}, Gateway Charge: ${transaction.gatewayCharge}`);
        console.log(`[${traceId}] System fee applied: ${pendingMetadata.systemFeeAmount > 0 ? 'YES' : 'NO'} (${pendingMetadata.gatewayCountry})`);
        
        // Create donation record
        await prisma.donationTransaction.create({
          data: {
            campaignId: pendingMetadata.campaignId,
            userId: pendingMetadata.isGuest ? null : pendingTx.userId,
            churchId: pendingTx.churchId,
            amount: pendingMetadata.baseAmount,
            currency: data.currency,
            transactionId: transaction.id,
            reference: data.reference,
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
        
        // Send donation receipt email with PDF
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
            receiptNumber: data.reference,
            type: 'donation',
            customerName: donorFullName || '',
            customerEmail: donorEmail,
            amount: pendingMetadata.baseAmount,
            currency: data.currency,
            paidAt: new Date(data.paid_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            paymentMethod: data.channel || 'card',
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
              currency: data.currency,
              campaignName: campaign.name,
              reference: data.reference,
              isAnonymous: pendingMetadata.isAnonymous || false,
              isGuest: pendingMetadata.isGuest === true,
              churchName: campaign.church.name
            }),
            [{ filename: `donation-receipt-${data.reference}.pdf`, content: receiptPDF }]
          );
        }
        
        // Delete pending transaction
        await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } });
        
        console.log(`[${traceId}] Donation created`);
        const donationCallbackUrl = isGuestDonation
          ? `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=success&type=donation&isGuest=true&guestEmail=${encodeURIComponent(pendingMetadata.guestEmail)}&guestName=${encodeURIComponent(pendingMetadata.guestName)}&amount=${pendingMetadata.baseAmount}&currency=${data.currency}`
          : `${process.env.FRONTEND_URL}/payment/callback?reference=${reference}&status=success&type=donation`;
        res.redirect(donationCallbackUrl);
      } else {
        // Handle other payment types (event tickets, donations, etc.)
        console.log(`[${traceId}] Other payment type, redirecting to callback`);
        res.redirect(`${process.env.FRONTEND_URL}/payment/callback?reference=${reference}`);
      }
    } else {
      console.log(`[${traceId}] Payment NOT successful - Status: ${data.status}`);
      res.redirect(`${process.env.FRONTEND_URL}/dashboard/packages?reference=${reference}&status=failed`);
    }
  } catch (error: any) {
    console.error(`[${traceId}] ========== VERIFICATION ERROR ==========`);
    console.error(`[${traceId}] Status:`, error.response?.status);
    console.error(`[${traceId}] Response:`, JSON.stringify(error.response?.data, null, 2));
    console.error(`[${traceId}] Message:`, error.message);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard/packages?reference=${reference}&status=error`);
  }
}
