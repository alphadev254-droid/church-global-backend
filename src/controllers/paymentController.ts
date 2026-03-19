import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { getPaymentGateway, getCurrency, getGatewayCountry } from '../utils/gatewayRouter';
import { calculatePaymentFees } from '../utils/feeCalculations';
import { convertUSDToLocal } from '../utils/currencyConversion';
import { initiateStkPush, formatMpesaPhone } from '../utils/mpesa';

const subscribeSchema = z.object({
  packageId:    z.string().min(1, 'Package ID required'),
  billingCycle: z.enum(['monthly', 'yearly']),
  phone:        z.string().optional(), // required for Kenya M-Pesa
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

  const { packageId, billingCycle, phone } = parsed.data;
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
  const currency = getCurrency(gateway); // Always KES
  const gatewayCountry = getGatewayCountry(gateway);
  
  console.log(`[${traceId}] Gateway: ${gateway}, Country: ${gatewayCountry}, Currency: ${currency}`);
  console.log(`[${traceId}] National Admin accountCountry: ${ministryAdmin.accountCountry}`);
  console.log(`[${traceId}] Package price in USD: ${baseAmountUSD}`);
  
  // Convert USD to local currency using exchange rates
  const baseAmount = convertUSDToLocal(baseAmountUSD, 'KES');
  console.log(`[${traceId}] Converted amount: ${baseAmount} ${currency}`);

  // Calculate fees (Kenya has no tax, Malawi has 17.5% tax)
  const fees = calculatePaymentFees(baseAmount, gatewayCountry);

  console.log(`[${traceId}] Amount: ${fees.baseAmount} ${currency}`);
  console.log(`[${traceId}] Routing to: MPESA (Kenya)`);


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
        packageName:  pkg.name,
        billingCycle,
        baseAmount:   fees.baseAmount,
        totalAmount:  fees.totalAmount,
        gateway,
        initiatedBy:  userId,
      }),
    },
  });
  console.log(`[${traceId}] Pending transaction created: ${pendingTx.id}`);
  console.log(`[${traceId}] Pending transaction metadata:`, pendingTx.metadata ? JSON.parse(pendingTx.metadata) : {});

  return await initiateMpesaPayment(pendingTx, ministryAdmin, fees, phone, traceId, res);
}

async function initiateMpesaPayment(
  pendingTx: any,
  ministryAdmin: any,
  fees: any,
  phone: string | undefined,
  traceId: string,
  res: Response
): Promise<void> {
  console.log(`[${traceId}] initiateMpesaPayment called`);

  // Use provided phone or fall back to ministry admin's profile phone
  const rawPhone = phone || ministryAdmin.phone;
  if (!rawPhone) {
    await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
    res.status(400).json({ success: false, message: 'Phone number is required for M-Pesa payment' });
    return;
  }

  let formattedPhone: string;
  try {
    formattedPhone = formatMpesaPhone(rawPhone);
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

    const metadata = pendingTx.metadata ? JSON.parse(pendingTx.metadata) : {};
    const stk = await initiateStkPush(
      formattedPhone,
      fees.totalAmount,
      'ICIMS',
      `Package-${metadata.packageName?.substring(0, 7) || 'Sub'}`
    );

    await prisma.pendingTransaction.update({
      where: { id: pendingTx.id },
      data:  { mpesaCheckoutRequestId: stk.checkoutRequestId },
    });

    console.log(`[${traceId}] M-Pesa STK push sent: ${stk.checkoutRequestId}`);
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



