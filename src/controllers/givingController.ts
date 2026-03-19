import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { groupByDateRanges } from '../lib/dateGrouping';
import { getAccessibleChurchIds } from '../lib/churchScope';

const createCampaignSchema = z.object({
  churchId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(['tithe', 'offering', 'partnership', 'welfare', 'missions']),
  subcategory: z.string().optional(),
  targetAmount: z.number().positive().optional().or(z.literal(0)).or(z.nan()).transform(val => val && val > 0 ? val : undefined),
  currency: z.literal('KES').default('KES'),
  endDate: z.string().optional(),
  imageUrl: z.string().optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  subcategory: z.string().optional(),
  targetAmount: z.number().positive().optional().or(z.literal(0)).or(z.nan()).transform(val => val && val > 0 ? val : undefined),
  currency: z.literal('KES').optional(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
  endDate: z.string().optional(),
  imageUrl: z.string().optional(),
  allowPublicDonations: z.boolean().optional(),
});

export async function createCampaign(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role;

  // Check if user has giving_tracking feature
  const { hasFeature } = await import('../lib/packageChecker');
  if (!(await hasFeature(userId!, 'giving_tracking'))) {
    res.status(403).json({ success: false, message: 'Your package does not include Giving & Donations. Please upgrade to access this feature.' });
    return;
  }

  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { churchId: targetChurchId, endDate, ...data } = parsed.data;

  // Verify user has access to this church
  const accessibleChurchIds = await getAccessibleChurchIds(
    roleName!,
    churchId,
    req.user?.districts,
    req.user?.traditionalAuthorities,
    req.user?.regions,
    userId
  );

  if (!accessibleChurchIds.includes(targetChurchId)) {
    res.status(403).json({ success: false, message: 'Access denied to this church' });
    return;
  }

  const campaign = await prisma.givingCampaign.create({
    data: {
      ...data,
      churchId: targetChurchId,
      endDate: endDate ? new Date(endDate) : null,
      allowPublicDonations: (req.body.allowPublicDonations === true || req.body.allowPublicDonations === 'true') ? true : false,
    },
  });

  res.status(201).json({ success: true, data: campaign });
}

export async function getCampaigns(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const roleName = req.user?.role;
  const { churchId, category, status } = req.query;

  // Get user's accessible churches based on role
  const accessibleChurchIds = await getAccessibleChurchIds(
    roleName!,
    req.user?.churchId,
    req.user?.districts,
    req.user?.traditionalAuthorities,
    req.user?.regions,
    userId
  );

  const campaigns = await prisma.givingCampaign.findMany({
    where: {
      ...(churchId && { churchId: String(churchId) }),
      ...(accessibleChurchIds.length > 0 && { churchId: { in: accessibleChurchIds } }),
      ...(category && { category: String(category) }),
      ...(status && { status: String(status) }),
      ...(roleName === 'member' && { status: 'active' }),
    },
    include: {
      church: { select: { name: true } },
      _count: { select: { donations: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate total raised for each campaign
  const campaignsWithStats = await Promise.all(
    campaigns.map(async (campaign) => {
      const stats = await prisma.donationTransaction.aggregate({
        where: { campaignId: campaign.id, status: 'completed' },
        _sum: { amount: true },
      });

      // Count unique donors
      const uniqueDonors = await prisma.donationTransaction.findMany({
        where: { campaignId: campaign.id, status: 'completed' },
        select: { userId: true },
        distinct: ['userId'],
      });

      // Check if member has donated to this campaign and get their total
      let userHasDonated = false;
      let userTotalDonated = 0;
      if (roleName === 'member') {
        const userDonations = await prisma.donationTransaction.findMany({
          where: { campaignId: campaign.id, userId, status: 'completed' },
        });
        userHasDonated = userDonations.length > 0;
        userTotalDonated = userDonations.reduce((sum, d) => sum + d.amount, 0);
      }

      return {
        ...campaign,
        totalRaised: stats._sum.amount || 0,
        donorCount: uniqueDonors.length,
        userHasDonated,
        userTotalDonated,
      };
    })
  );

  // Group by date ranges
  const grouped = groupByDateRanges(campaignsWithStats);

  res.json({ success: true, data: grouped });
}

export async function getCampaign(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const campaign = await prisma.givingCampaign.findUnique({
    where: { id: String(id) },
    include: {
      church: { select: { name: true } },
      _count: { select: { donations: true } },
    },
  });

  if (!campaign) {
    res.status(404).json({ success: false, message: 'Campaign not found' });
    return;
  }

  const stats = await prisma.donationTransaction.aggregate({
    where: { campaignId: String(id), status: 'completed' },
    _sum: { amount: true },
  });

  // Count unique donors
  const uniqueDonors = await prisma.donationTransaction.findMany({
    where: { campaignId: String(id), status: 'completed' },
    select: { userId: true },
    distinct: ['userId'],
  });

  res.json({
    success: true,
    data: {
      ...campaign,
      totalRaised: stats._sum?.amount || 0,
      donorCount: uniqueDonors.length,
    },
  });
}

export async function updateCampaign(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role;

  const parsed = updateCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  // Check if campaign exists and user has access
  const existingCampaign = await prisma.givingCampaign.findUnique({ 
    where: { id: String(id) }, 
    include: { church: true } 
  });
  if (!existingCampaign) {
    res.status(404).json({ success: false, message: 'Campaign not found' });
    return;
  }

  // Verify user has access to this church
  const accessibleChurchIds = await getAccessibleChurchIds(
    roleName!,
    churchId,
    req.user?.districts,
    req.user?.traditionalAuthorities,
    req.user?.regions,
    userId
  );

  if (!accessibleChurchIds.includes(existingCampaign.churchId)) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return;
  }

  const { endDate, ...data } = parsed.data;

  const campaign = await prisma.givingCampaign.update({
    where: { id: String(id) },
    data: {
      ...data,
      ...(endDate && { endDate: new Date(endDate) }),
    },
  });

  res.json({ success: true, data: campaign });
}

export async function deleteCampaign(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role;

  // Check if campaign exists and user has access
  const existingCampaign = await prisma.givingCampaign.findUnique({ 
    where: { id: String(id) }, 
    include: { church: true } 
  });
  if (!existingCampaign) {
    res.status(404).json({ success: false, message: 'Campaign not found' });
    return;
  }

  // Verify user has access to this church
  const accessibleChurchIds = await getAccessibleChurchIds(
    roleName!,
    churchId,
    req.user?.districts,
    req.user?.traditionalAuthorities,
    req.user?.regions,
    userId
  );

  if (!accessibleChurchIds.includes(existingCampaign.churchId)) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return;
  }

  await prisma.givingCampaign.delete({ where: { id: String(id) } });

  res.json({ success: true, message: 'Campaign deleted' });
}

export async function getDonations(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const roleName = req.user?.role;
  const { campaignId, churchId } = req.query;

  // Members see only their own donations
  if (roleName === 'member') {
    const donations = await prisma.donationTransaction.findMany({
      where: {
        userId,
        ...(campaignId && { campaignId: String(campaignId) }),
      },
      include: {
        campaign: { select: { name: true, category: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: donations });
    return;
  }

  // Get user's accessible churches based on role
  const accessibleChurchIds = await getAccessibleChurchIds(
    roleName!,
    req.user?.churchId,
    req.user?.districts,
    req.user?.traditionalAuthorities,
    req.user?.regions,
    userId
  );

  const donationWhere = {
    ...(campaignId && { campaignId: String(campaignId) }),
    ...(churchId && { churchId: String(churchId) }),
    ...(accessibleChurchIds.length > 0 && { churchId: { in: accessibleChurchIds } }),
  };

  const [donations, totalAmount] = await Promise.all([
    prisma.donationTransaction.findMany({
      where: donationWhere,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        isAnonymous: true,
        donorName: true,
        donorEmail: true,
        isGuest: true,
        guestName: true,
        guestEmail: true,
        guestPhone: true,
        notes: true,
        createdAt: true,
        campaign: { select: { name: true, category: true } },
        church: { select: { name: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.donationTransaction.aggregate({ where: { ...donationWhere, status: 'completed' }, _sum: { amount: true } }),
  ]);

  res.json({ success: true, data: donations, totalAmount: totalAmount._sum.amount ?? 0 });
}

const createDonationSchema = z.object({
  campaignId:  z.string().min(1),
  amount:      z.number().positive(),
  phone:       z.string().optional(), // required for Kenya M-Pesa
  isAnonymous: z.boolean().optional().default(false),
  donorName:   z.string().optional(),
  donorEmail:  z.string().email().optional(),
  donorPhone:  z.string().optional(),
  notes:       z.string().optional(),
});

export async function createDonation(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const userEmail = req.user?.email;
  const traceId = `DON-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  console.log(`[${traceId}] ========== DONATION INITIATED ==========`);
  console.log(`[${traceId}] User ID: ${userId}`);

  const parsed = createDonationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { campaignId, amount, phone, isAnonymous, donorName, donorEmail, donorPhone, notes } = parsed.data;

  const campaign = await prisma.givingCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    res.status(404).json({ success: false, message: 'Campaign not found' });
    return;
  }

  if (campaign.status !== 'active') {
    res.status(400).json({ success: false, message: 'Campaign is not active' });
    return;
  }

  // Determine gateway using existing function
  const { getPaymentGateway, getCurrency, getGatewayCountry } = await import('../utils/gatewayRouter');
  const { calculatePaymentFees } = await import('../utils/feeCalculations');
  
  const gateway = await getPaymentGateway(userId!);
  const currency = getCurrency(gateway);
  const gatewayCountry = getGatewayCountry(gateway);
  
  console.log(`[${traceId}] Gateway: ${gateway}, Country: ${gatewayCountry}, Currency: ${currency}`);
  
  // Calculate fees
  const fees = calculatePaymentFees(amount, gatewayCountry);
  
  console.log(`[${traceId}] Amount: ${fees.baseAmount} ${currency}`);

  // Create pending transaction
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 30);

  const pendingTx = await prisma.pendingTransaction.create({
    data: {
      amount: fees.totalAmount,
      currency,
      userId: userId!,
      churchId: campaign.churchId,
      type: 'donation',
      expiresAt,
      metadata: JSON.stringify({
        traceId,
        campaignId,
        campaignName: campaign.name,
        isAnonymous,
        donorName,
        donorPhone:   phone || donorPhone || null,
        notes,
        baseAmount:   fees.baseAmount,
        totalAmount:  fees.totalAmount,
        gateway,
      }),
    },
  });

  console.log(`[${traceId}] Pending transaction created: ${pendingTx.id}`);

  return await initiateMpesaDonation(pendingTx, fees, traceId, res);
}

async function initiateMpesaDonation(
  pendingTx: any,
  fees: any,
  traceId: string,
  res: Response
): Promise<void> {
  console.log(`[${traceId}] Routing to M-Pesa`);

  const { initiateStkPush, formatMpesaPhone } = await import('../utils/mpesa');
  const metadata = JSON.parse(pendingTx.metadata);

  // Phone must be in metadata (set by caller) or pendingTx
  const rawPhone = metadata.donorPhone || pendingTx.mpesaPhoneNumber;
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
    // Get church mpesaAccountRef
    const church = await prisma.church.findUnique({
      where: { id: pendingTx.churchId },
      select: { name: true, mpesaAccountRef: true },
    });

    await prisma.pendingTransaction.update({
      where: { id: pendingTx.id },
      data:  { mpesaPhoneNumber: formattedPhone },
    });

    const stk = await initiateStkPush(
      formattedPhone,
      fees.totalAmount,
      church?.mpesaAccountRef || church?.name.substring(0, 12) || 'DONATION',
      `Donation-${metadata.campaignName?.substring(0, 7) || 'Campaign'}`
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
        currency:          'KES',
      },
    });
  } catch (error: any) {
    await prisma.pendingTransaction.delete({ where: { id: pendingTx.id } }).catch(() => {});
    console.error(`[${traceId}] M-Pesa error:`, error.message);
    res.status(500).json({ success: false, message: error.message || 'Failed to initiate M-Pesa payment' });
  }
}


export async function getGuestDonationFees(req: Request, res: Response): Promise<void> {
  const { campaignId, amount } = req.query as { campaignId: string; amount: string };
  if (!campaignId || !amount) {
    res.status(400).json({ success: false, message: 'campaignId and amount required' });
    return;
  }
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    res.status(400).json({ success: false, message: 'Invalid amount' });
    return;
  }

  const campaign = await prisma.givingCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || !campaign.allowPublicDonations) {
    res.status(404).json({ success: false, message: 'Campaign not found' });
    return;
  }

  const { getPaymentGatewayByChurch, getCurrency, getGatewayCountry } = await import('../utils/gatewayRouter');
  const { calculatePaymentFees } = await import('../utils/feeCalculations');

  const gateway = await getPaymentGatewayByChurch(campaign.churchId);
  const currency = getCurrency(gateway);
  const gatewayCountry = getGatewayCountry(gateway);
  const fees = calculatePaymentFees(parsedAmount, gatewayCountry);

  res.json({
    success: true,
    data: {
      currency,
      baseAmount:  fees.baseAmount,
      totalAmount: fees.totalAmount,
    },
  });
}

export async function getPublicCampaign(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const campaign = await prisma.givingCampaign.findUnique({
    where: { id: String(id) },
    include: { church: { select: { name: true } } },
  });

  if (!campaign || !campaign.allowPublicDonations) {
    res.status(404).json({ success: false, message: 'Campaign not found or not publicly available' });
    return;
  }

  if (campaign.status !== 'active') {
    res.status(400).json({ success: false, message: 'This campaign is no longer active' });
    return;
  }

  const { targetAmount, ...publicFields } = campaign;

  res.json({ success: true, data: publicFields });
}

const guestDonationSchema = z.object({
  campaignId:  z.string().min(1),
  amount:      z.number().positive(),
  guestName:   z.string().min(1),
  guestEmail:  z.string().email(),
  guestPhone:  z.string().optional(), // required for Kenya M-Pesa
});

export async function createGuestDonation(req: Request, res: Response): Promise<void> {
  const traceId = `GDON-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[${traceId}] ========== GUEST DONATION INITIATED ==========`);

  const parsed = guestDonationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { campaignId, amount, guestName, guestEmail, guestPhone } = parsed.data;

  const campaign = await prisma.givingCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || !campaign.allowPublicDonations) {
    res.status(404).json({ success: false, message: 'Campaign not found or not publicly available' });
    return;
  }
  if (campaign.status !== 'active') {
    res.status(400).json({ success: false, message: 'Campaign is not active' });
    return;
  }

  const { getPaymentGatewayByChurch, getCurrency, getGatewayCountry } = await import('../utils/gatewayRouter');
  const { calculatePaymentFees } = await import('../utils/feeCalculations');

  const gateway = await getPaymentGatewayByChurch(campaign.churchId);
  const currency = getCurrency(gateway);
  const gatewayCountry = getGatewayCountry(gateway);
  const fees = calculatePaymentFees(amount, gatewayCountry);

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 30);

  const pendingTx = await prisma.pendingTransaction.create({
    data: {
      amount: fees.totalAmount,
      currency,
      userId: null,
      churchId: campaign.churchId,
      type: 'donation',
      expiresAt,
      metadata: JSON.stringify({
        traceId,
        campaignId,
        campaignName: campaign.name,
        isGuest:      true,
        guestName,
        guestEmail,
        guestPhone:   guestPhone || null,
        donorPhone:   guestPhone || null,
        isAnonymous:  false,
        baseAmount:   fees.baseAmount,
        totalAmount:  fees.totalAmount,
        gateway,
      }),
    },
  });

  console.log(`[${traceId}] Pending transaction created: ${pendingTx.id}`);

  return await initiateMpesaDonation(pendingTx, fees, traceId, res);
}

export async function getDonationTransaction(req: Request, res: Response): Promise<void> {
  const donationId = String(req.params.id);
  const userId = req.user?.userId;
  const roleName = req.user?.role ?? 'member';

  const donation = await prisma.donationTransaction.findUnique({
    where: { id: donationId },
    select: { userId: true, transactionId: true },
  });

  if (!donation) {
    res.status(404).json({ success: false, message: 'Donation not found' });
    return;
  }

  // Members can only see their own donation transactions
  if (roleName === 'member' && donation.userId !== userId) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return;
  }

  if (!donation.transactionId) {
    res.status(404).json({ success: false, message: 'No transaction found' });
    return;
  }

  // Fetch transaction with role-based fields
  if (roleName === 'member') {
    // Members see limited fields (no totalFees)
    const transaction = await prisma.transaction.findUnique({
      where: { id: donation.transactionId },
      select: {
        amount: true,
        currency: true,
        paymentMethod: true,
        status: true,
        reference: true,
        paidAt: true,
        baseAmount: true,
        totalAmount: true,
        gateway: true,
      },
    });
    res.json({ success: true, data: transaction });
  } else {
    // Admins see all fields including totalFees
    const transaction = await prisma.transaction.findUnique({
      where: { id: donation.transactionId },
      select: {
        amount: true,
        currency: true,
        paymentMethod: true,
        status: true,
        reference: true,
        paidAt: true,
        gatewayResponse: true,
        type: true,
        isManual: true,
        notes: true,
        createdAt: true,
        baseAmount: true,
        totalAmount: true,
        gateway: true,
      },
    });
    res.json({ success: true, data: transaction });
  }
}
