import { Request, Response } from 'express';
import { z } from 'zod';
import axios from 'axios';
import prisma from '../lib/prisma';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';

const createSubaccountSchema = z.object({
  churchId: z.string().min(1),
  businessName: z.string().min(1),
  settlementBank: z.string().min(1),
  accountNumber: z.string().min(1),
  percentageCharge: z.number().min(0).max(100).default(0),
  description: z.string().optional(),
});

const updateSubaccountSchema = z.object({
  businessName: z.string().optional(),
  settlementBank: z.string().optional(),
  accountNumber: z.string().optional(),
  percentageCharge: z.number().min(0).max(100).optional(),
  active: z.boolean().optional(),
});

export async function createSubaccount(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const roleName = req.user?.role ?? 'member';

  // Check if user's account country is Kenya
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCountry: true, ministryAdminId: true }
  });

  let accountCountry = user?.accountCountry;
  if (!accountCountry && user?.ministryAdminId) {
    const ministryAdmin = await prisma.user.findUnique({
      where: { id: user.ministryAdminId },
      select: { accountCountry: true }
    });
    accountCountry = ministryAdmin?.accountCountry;
  }

  if (accountCountry !== 'Kenya') {
    res.status(403).json({ success: false, message: 'Subaccounts are only available for Kenya accounts' });
    return;
  }

  const parsed = createSubaccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { churchId, businessName, settlementBank, accountNumber, percentageCharge, description } = parsed.data;

  // Use percentage charge from request or default from environment
  const finalPercentageCharge = percentageCharge ?? parseFloat(process.env.SUBACCOUNT_PERCENTAGE_CHARGE || '0');

  // Check if church exists
  const church = await prisma.church.findUnique({ where: { id: churchId } });
  if (!church) {
    res.status(404).json({ success: false, message: 'Church not found' });
    return;
  }

  // Check if subaccount already exists
  const existing = await prisma.subaccount.findUnique({ where: { churchId } });
  if (existing) {
    res.status(400).json({ success: false, message: 'Subaccount already exists for this church' });
    return;
  }

  // Get ministryAdminId from user or church
  let ministryAdminId = userId;
  if (roleName === 'district_admin' || roleName === 'branch_admin') {
    const userRecord = await prisma.user.findUnique({ where: { id: userId } });
    if (userRecord?.ministryAdminId) {
      ministryAdminId = userRecord.ministryAdminId;
    }
  }

  try {
    // Create subaccount on Paystack
    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/subaccount`,
      {
        business_name: businessName,
        settlement_bank: settlementBank,
        account_number: accountNumber,
        percentage_charge: finalPercentageCharge,
        description: description || `Subaccount for ${businessName}`,
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const { subaccount_code } = response.data.data;

    // Save to database
    const subaccount = await prisma.subaccount.create({
      data: {
        churchId,
        ministryAdminId,
        subaccountCode: subaccount_code,
        businessName,
        settlementBank,
        accountNumber,
        percentageCharge: finalPercentageCharge,
        description,
      },
    });

    res.status(201).json({ success: true, data: subaccount });
  } catch (error: any) {
    console.error('Paystack error:', error.response?.data);
    const errorMsg = error.response?.data?.message || 'Failed to create subaccount with Paystack. Please try again later.';
    res.status(500).json({ 
      success: false, 
      message: errorMsg
    });
  }
}

export async function updateSubaccount(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const subaccountId = String(req.params.id);
  
  // Check if user's account country is Kenya
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCountry: true, ministryAdminId: true }
  });

  let accountCountry = user?.accountCountry;
  if (!accountCountry && user?.ministryAdminId) {
    const ministryAdmin = await prisma.user.findUnique({
      where: { id: user.ministryAdminId },
      select: { accountCountry: true }
    });
    accountCountry = ministryAdmin?.accountCountry;
  }

  if (accountCountry !== 'Kenya') {
    res.status(403).json({ success: false, message: 'Subaccounts are only available for Kenya accounts' });
    return;
  }
  
  const parsed = updateSubaccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const subaccount = await prisma.subaccount.findUnique({ where: { id: subaccountId } });
  if (!subaccount) {
    res.status(404).json({ success: false, message: 'Subaccount not found' });
    return;
  }

  try {
    // Update on Paystack
    const paystackData: any = {};
    if (parsed.data.businessName) paystackData.business_name = parsed.data.businessName;
    if (parsed.data.settlementBank) paystackData.settlement_bank = parsed.data.settlementBank;
    if (parsed.data.accountNumber) paystackData.account_number = parsed.data.accountNumber;
    if (parsed.data.percentageCharge !== undefined) paystackData.percentage_charge = parsed.data.percentageCharge;
    if (parsed.data.active !== undefined) paystackData.active = parsed.data.active;

    await axios.put(
      `${PAYSTACK_BASE_URL}/subaccount/${subaccount.subaccountCode}`,
      paystackData,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Update in database
    const updated = await prisma.subaccount.update({
      where: { id: subaccountId },
      data: parsed.data,
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Paystack error:', error.response?.data);
    const errorMsg = error.response?.data?.message || 'Failed to update subaccount with Paystack. Please try again later.';
    res.status(500).json({ 
      success: false, 
      message: errorMsg
    });
  }
}

export async function getSubaccount(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const churchId = String(req.params.churchId);

  // Check if user's account country is Kenya
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCountry: true, ministryAdminId: true }
  });

  let accountCountry = user?.accountCountry;
  if (!accountCountry && user?.ministryAdminId) {
    const ministryAdmin = await prisma.user.findUnique({
      where: { id: user.ministryAdminId },
      select: { accountCountry: true }
    });
    accountCountry = ministryAdmin?.accountCountry;
  }

  if (accountCountry !== 'Kenya') {
    res.status(403).json({ success: false, message: 'Subaccounts are only available for Kenya accounts' });
    return;
  }

  const subaccount = await prisma.subaccount.findUnique({
    where: { churchId },
    include: { church: { select: { name: true } } },
  });

  if (!subaccount) {
    res.status(404).json({ success: false, message: 'Subaccount not found' });
    return;
  }

  res.json({ success: true, data: subaccount });
}

export async function getBanks(req: Request, res: Response): Promise<void> {
  try {
    const response = await axios.get(`${PAYSTACK_BASE_URL}/bank?country=kenya`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    });
    
    // Filter for KES currency and mobile money, remove duplicates by code
    const seen = new Set<string>();
    const banks = response.data.data
      .filter((bank: any) => 
        (bank.currency === 'KES' || bank.type === 'mobile_money' || bank.type === 'mobile_money_business') &&
        bank.active && 
        !bank.is_deleted
      )
      .map((bank: any) => ({
        name: bank.name,
        code: bank.code,
      }))
      .filter((bank: any) => {
        if (seen.has(bank.code)) return false;
        seen.add(bank.code);
        return true;
      });
    
    res.json({ success: true, data: banks });
  } catch (error: any) {
    console.error('Paystack banks error:', error.response?.data);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch banks from Paystack' 
    });
  }
}
