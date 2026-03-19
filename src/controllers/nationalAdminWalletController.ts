import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { debitNationalAdminBalance, refundNationalAdminWithdrawal } from '../utils/nationalAdminBalanceOperations';
import { calculateB2CFee, calculateB2BFee } from '../utils/feeCalculations';
import axios from 'axios';

const MPESA_BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

const MPESA_B2C_URL = `${MPESA_BASE_URL}/mpesa/b2c/v1/paymentrequest`;
const MPESA_B2B_URL = `${MPESA_BASE_URL}/mpesa/b2b/v1/paymentrequest`;

// ─── Get balance ──────────────────────────────────────────────────────────────

export async function getNationalAdminBalance(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const roleName = req.user?.role ?? 'member';

  if (!userId) { res.status(401).json({ success: false, message: 'Not authenticated' }); return; }
  if (roleName !== 'ministry_admin') { res.status(403).json({ success: false, message: 'Only national admins can access this' }); return; }

  const balance = await prisma.nationalAdminBalance.findUnique({
    where: { ministryAdminId: userId },
  });

  res.json({
    success: true,
    data: {
      balance: balance?.balance ?? 0,
      currency: balance?.currency ?? 'KES',
    },
  });
}

// ─── Get fee preview ─────────────────────────────────────────────────────────

export async function getWithdrawalFee(req: Request, res: Response): Promise<void> {
  const { type, amount } = req.query;

  if (!type || !amount) {
    res.status(400).json({ success: false, message: 'type and amount are required' });
    return;
  }

  const amt = parseFloat(String(amount));
  if (isNaN(amt) || amt <= 0) {
    res.status(400).json({ success: false, message: 'Invalid amount' });
    return;
  }

  const fee = type === 'b2c' ? calculateB2CFee(amt) : calculateB2BFee(amt);
  const grossAmount = parseFloat((amt + fee).toFixed(2));

  res.json({ success: true, data: { amount: amt, fee, grossAmount } });
}

// ─── Get withdrawals ──────────────────────────────────────────────────────────

export async function getNationalAdminWithdrawals(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const roleName = req.user?.role ?? 'member';
  const { page = 1, limit = 20, startDate, endDate } = req.query;

  if (!userId) { res.status(401).json({ success: false, message: 'Not authenticated' }); return; }
  if (roleName !== 'ministry_admin') { res.status(403).json({ success: false, message: 'Only national admins can access this' }); return; }

  const dateFilter: any = {};
  if (startDate) dateFilter.gte = new Date(String(startDate));
  if (endDate) {
    const end = new Date(String(endDate));
    end.setHours(23, 59, 59, 999);
    dateFilter.lte = end;
  }

  const where = {
    ministryAdminId: userId,
    ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
  };

  const skip = (Number(page) - 1) * Number(limit);

  const [withdrawals, total] = await Promise.all([
    prisma.nationalAdminWithdrawal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
    }),
    prisma.nationalAdminWithdrawal.count({ where }),
  ]);

  res.json({ success: true, data: withdrawals, total });
}

// ─── Request withdrawal ───────────────────────────────────────────────────────

const b2cSchema = z.object({
  type: z.literal('b2c'),
  amount: z.number().positive(),
  phoneNumber: z.string().min(1, 'Phone number required'),
  commandID: z.enum(['SalaryPayment', 'BusinessPayment', 'PromotionPayment']).default('BusinessPayment'),
  remarks: z.string().optional(),
  occasion: z.string().optional(),
});

const b2bSchema = z.object({
  type: z.literal('b2b'),
  amount: z.number().positive(),
  partyB: z.string().min(1, 'Recipient shortcode required'),
  accountReference: z.string().min(1, 'Account reference required'),
  commandID: z.enum(['BusinessPayBill', 'BusinessBuyGoods']).default('BusinessPayBill'),
  remarks: z.string().optional(),
});

const withdrawalSchema = z.discriminatedUnion('type', [b2cSchema, b2bSchema]);

export async function requestNationalAdminWithdrawal(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const roleName = req.user?.role ?? 'member';

  if (!userId) { res.status(401).json({ success: false, message: 'Not authenticated' }); return; }
  if (roleName !== 'ministry_admin') { res.status(403).json({ success: false, message: 'Only national admins can request withdrawals' }); return; }

  const parsed = withdrawalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const data = parsed.data;

  // Calculate fee based on type and amount
  const fee      = data.type === 'b2c' ? calculateB2CFee(data.amount) : calculateB2BFee(data.amount);
  const grossAmount = parseFloat((data.amount + fee).toFixed(2)); // total deducted from balance

  // Check balance covers amount + fee
  const balanceRow = await prisma.nationalAdminBalance.findUnique({
    where: { ministryAdminId: userId },
  });
  if (!balanceRow || balanceRow.balance < grossAmount) {
    res.status(400).json({
      success: false,
      message: `Insufficient balance. Need KES ${grossAmount} (KES ${data.amount} + KES ${fee} fee). Available: KES ${balanceRow?.balance ?? 0}`,
    });
    return;
  }

  const initiatorName = process.env.MPESA_B2C_INITIATOR_NAME || '';

  // Create withdrawal record first so we have the id for the tx log
  const withdrawal = await prisma.nationalAdminWithdrawal.create({
    data: {
      balanceId:        balanceRow.id,
      ministryAdminId:  userId,
      initiatedBy:      userId,
      amount:           data.amount,
      fee:              fee,
      grossAmount:      grossAmount,
      currency:         'KES',
      commandID:        data.commandID,
      phoneNumber:      data.type === 'b2c' ? data.phoneNumber : null,
      partyB:           data.type === 'b2b' ? data.partyB : null,
      accountReference: data.type === 'b2b' ? data.accountReference : null,
      initiatorName,
      status:           'pending',
    },
  });

  // Debit gross amount (amount + fee) and log the tx entry
  try {
    await debitNationalAdminBalance(userId, grossAmount, withdrawal.id);
  } catch (err: any) {
    await prisma.nationalAdminWithdrawal.update({ where: { id: withdrawal.id }, data: { status: 'failed', failureReason: err.message } });
    res.status(400).json({ success: false, message: err.message });
    return;
  }

  // Dispatch to Daraja
  try {
    if (data.type === 'b2c') {
      await dispatchB2C(withdrawal, data, initiatorName);
    } else {
      await dispatchB2B(withdrawal, data, initiatorName);
    }

    const updated = await prisma.nationalAdminWithdrawal.findUnique({ where: { id: withdrawal.id } });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    // Refund on dispatch failure
    await refundNationalAdminWithdrawal(withdrawal.id).catch(() => {});
    await prisma.nationalAdminWithdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'failed', failureReason: err.message },
    });
    res.status(400).json({ success: false, message: err.message || 'Withdrawal dispatch failed' });
  }
}

// ─── Daraja B2C ───────────────────────────────────────────────────────────────

async function dispatchB2C(withdrawal: any, data: any, initiatorName: string) {
  const traceId = `B2C-${withdrawal.id}`;
  console.log(`[${traceId}] Fetching M-Pesa token...`);
  const token = await getMpesaToken();
  console.log(`[${traceId}] Token acquired`);

  const shortCode = process.env.MPESA_B2C_SHORT_CODE!;
  const securityCredential = process.env.MPESA_B2C_SECURITY_CREDENTIAL!;
  const callbackUrl = `${process.env.BACKEND_URL}/api/webhooks/payments/b2c-result`;
  const timeoutUrl  = `${process.env.BACKEND_URL}/api/webhooks/payments/b2c-timeout`;

  const payload = {
    InitiatorName: initiatorName,
    SecurityCredential: securityCredential,
    CommandID: data.commandID,
    Amount: Math.round(data.amount),
    PartyA: shortCode,
    PartyB: data.phoneNumber,
    Remarks: data.remarks || 'Withdrawal',
    QueueTimeOutURL: timeoutUrl,
    ResultURL: callbackUrl,
    Occasion: data.occasion || '',
    OriginatorConversationID: withdrawal.id,
  };

  console.log(`[${traceId}] Dispatching B2C to ${MPESA_B2C_URL}`);
  console.log(`[${traceId}] Payload:`, JSON.stringify({ ...payload, SecurityCredential: '***' }));

  const response = await axios.post(MPESA_B2C_URL, payload, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch((err: any) => {
    console.error(`[${traceId}] Daraja error status:`, err.response?.status);
    console.error(`[${traceId}] Daraja error body:`, JSON.stringify(err.response?.data));
    throw new Error(err.response?.data?.errorMessage || err.response?.data?.ResponseDescription || err.message);
  });

  const result = response.data;
  console.log(`[${traceId}] Daraja response:`, JSON.stringify(result));

  if (result.ResponseCode !== '0') {
    throw new Error(result.ResponseDescription || 'Daraja rejected the B2C request');
  }

  await prisma.nationalAdminWithdrawal.update({
    where: { id: withdrawal.id },
    data: {
      status: 'processing',
      conversationID: result.ConversationID,
      originatorConversationID: result.OriginatorConversationID, // store Safaricom's returned value
      responseCode: result.ResponseCode,
      responseDescription: result.ResponseDescription,
    },
  });
  console.log(`[${traceId}] Status → processing. ConversationID: ${result.ConversationID}, Safaricom OriginatorConversationID: ${result.OriginatorConversationID}`);
}

// ─── Daraja B2B ───────────────────────────────────────────────────────────────

async function dispatchB2B(withdrawal: any, data: any, initiatorName: string) {
  const traceId = `B2B-${withdrawal.id}`;
  console.log(`[${traceId}] Fetching M-Pesa token...`);
  const token = await getMpesaToken();
  console.log(`[${traceId}] Token acquired`);

  const shortCode = process.env.MPESA_B2C_SHORT_CODE!;
  const securityCredential = process.env.MPESA_B2C_SECURITY_CREDENTIAL!;
  const callbackUrl = `${process.env.BACKEND_URL}/api/webhooks/payments/b2b-result`;
  const timeoutUrl  = `${process.env.BACKEND_URL}/api/webhooks/payments/b2b-timeout`;

  const payload = {
    Initiator: initiatorName,
    SecurityCredential: securityCredential,
    CommandID: data.commandID,
    SenderIdentifierType: '4',
    RecieverIdentifierType: '4',
    Amount: Math.round(data.amount),
    PartyA: shortCode,
    PartyB: data.partyB,
    AccountReference: data.accountReference,
    Remarks: data.remarks || 'Withdrawal',
    QueueTimeOutURL: timeoutUrl,
    ResultURL: callbackUrl,
  };

  console.log(`[${traceId}] Dispatching B2B to ${MPESA_B2B_URL}`);
  console.log(`[${traceId}] Payload:`, JSON.stringify({ ...payload, SecurityCredential: '***' }));

  const response = await axios.post(MPESA_B2B_URL, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const result = response.data;
  console.log(`[${traceId}] Daraja response:`, JSON.stringify(result));

  if (result.ResponseCode !== '0') {
    throw new Error(result.ResponseDescription || 'Daraja rejected the B2B request');
  }

  await prisma.nationalAdminWithdrawal.update({
    where: { id: withdrawal.id },
    data: {
      status: 'processing',
      conversationID: result.ConversationID,
      originatorConversationID: result.OriginatorConversationID,
      responseCode: result.ResponseCode,
      responseDescription: result.ResponseDescription,
    },
  });
  console.log(`[${traceId}] Status → processing. ConversationID: ${result.ConversationID}`);
}

// ─── Daraja result callbacks ──────────────────────────────────────────────────

export async function handleB2CResult(req: Request, res: Response): Promise<void> {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  const traceId = `B2C-RESULT-${Date.now()}`;
  console.log(`[${traceId}] Raw body:`, JSON.stringify(req.body));

  try {
    const result = req.body?.Result;
    if (!result) { console.error(`[${traceId}] Missing Result in body`); return; }

    console.log(`[${traceId}] OriginatorConversationID: ${result.OriginatorConversationID}`);
    console.log(`[${traceId}] ResultCode: ${result.ResultCode} — ${result.ResultDesc}`);

    const withdrawal = await prisma.nationalAdminWithdrawal.findFirst({
      where: { originatorConversationID: result.OriginatorConversationID },
    });
    if (!withdrawal) { console.error(`[${traceId}] No withdrawal found for OriginatorConversationID: ${result.OriginatorConversationID}`); return; }
    console.log(`[${traceId}] Matched withdrawal: ${withdrawal.id}`);

    if (result.ResultCode === 0) {
      const params: any[] = result.ResultParameters?.ResultParameter || [];
      const get = (key: string) => params.find((p: any) => p.Key === key)?.Value;

      const transactionID = get('TransactionReceipt') ? String(get('TransactionReceipt')) : (result.TransactionID ? String(result.TransactionID) : null);
      console.log(`[${traceId}] ✅ Success — TransactionID: ${transactionID}, Amount: ${get('TransactionAmount')}, Recipient: ${get('ReceiverPartyPublicName')}`);

      await prisma.nationalAdminWithdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: 'completed',
          resultCode: result.ResultCode,
          resultDesc: result.ResultDesc,
          transactionID,
          processedAt: new Date(),
        },
      });
    } else {
      console.error(`[${traceId}] ❌ Failed — ResultCode: ${result.ResultCode}, Desc: ${result.ResultDesc}`);
      await prisma.nationalAdminWithdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'failed', resultCode: result.ResultCode, resultDesc: result.ResultDesc, failureReason: result.ResultDesc },
      });
      await refundNationalAdminWithdrawal(withdrawal.id).catch(e => console.error(`[${traceId}] Refund error:`, e.message));
      console.log(`[${traceId}] Balance refunded`);
    }
  } catch (err: any) {
    console.error(`[${traceId}] ERROR:`, err.message);
  }
}

export async function handleB2BResult(req: Request, res: Response): Promise<void> {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  const traceId = `B2B-RESULT-${Date.now()}`;
  console.log(`[${traceId}] Raw body:`, JSON.stringify(req.body));

  try {
    const result = req.body?.Result;
    if (!result) { console.error(`[${traceId}] Missing Result in body`); return; }

    console.log(`[${traceId}] OriginatorConversationID: ${result.OriginatorConversationID}`);
    console.log(`[${traceId}] ResultCode: ${result.ResultCode} — ${result.ResultDesc}`);

    const withdrawal = await prisma.nationalAdminWithdrawal.findFirst({
      where: { originatorConversationID: result.OriginatorConversationID },
    });
    if (!withdrawal) { console.error(`[${traceId}] No withdrawal found for OriginatorConversationID: ${result.OriginatorConversationID}`); return; }
    console.log(`[${traceId}] Matched withdrawal: ${withdrawal.id}`);

    if (result.ResultCode === 0) {
      const params: any[] = result.ResultParameters?.ResultParameter || [];
      const get = (key: string) => params.find((p: any) => p.Key === key)?.Value;

      const transactionID = get('TransactionReceipt') ? String(get('TransactionReceipt')) : (result.TransactionID ? String(result.TransactionID) : null);
      console.log(`[${traceId}] ✅ Success — TransactionID: ${transactionID}, Amount: ${get('TransactionAmount')}, Recipient: ${get('ReceiverPartyPublicName')}`);

      await prisma.nationalAdminWithdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'completed', resultCode: result.ResultCode, resultDesc: result.ResultDesc, transactionID, processedAt: new Date() },
      });
    } else {
      console.error(`[${traceId}] ❌ Failed — ResultCode: ${result.ResultCode}, Desc: ${result.ResultDesc}`);
      await prisma.nationalAdminWithdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'failed', resultCode: result.ResultCode, resultDesc: result.ResultDesc, failureReason: result.ResultDesc },
      });
      await refundNationalAdminWithdrawal(withdrawal.id).catch(e => console.error(`[${traceId}] Refund error:`, e.message));
      console.log(`[${traceId}] Balance refunded`);
    }
  } catch (err: any) {
    console.error(`[${traceId}] ERROR:`, err.message);
  }
}

export async function handleB2CTimeout(req: Request, res: Response): Promise<void> {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  const traceId = `B2C-TIMEOUT-${Date.now()}`;
  console.warn(`[${traceId}] Timeout received:`, JSON.stringify(req.body));

  try {
    const originatorId = req.body?.Result?.OriginatorConversationID;
    if (!originatorId) return;
    const withdrawal = await prisma.nationalAdminWithdrawal.findFirst({ where: { originatorConversationID: originatorId } });
    if (!withdrawal) return;
    await prisma.nationalAdminWithdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'failed', failureReason: 'Request timed out — no response from Safaricom' },
    });
    await refundNationalAdminWithdrawal(withdrawal.id).catch(e => console.error(`[${traceId}] Refund error:`, e.message));
    console.log(`[${traceId}] Withdrawal ${withdrawal.id} marked failed (timeout), balance refunded`);
  } catch (err: any) {
    console.error(`[${traceId}] ERROR:`, err.message);
  }
}

export async function handleB2BTimeout(req: Request, res: Response): Promise<void> {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  const traceId = `B2B-TIMEOUT-${Date.now()}`;
  console.warn(`[${traceId}] Timeout received:`, JSON.stringify(req.body));

  try {
    const originatorId = req.body?.Result?.OriginatorConversationID;
    if (!originatorId) return;
    const withdrawal = await prisma.nationalAdminWithdrawal.findFirst({ where: { originatorConversationID: originatorId } });
    if (!withdrawal) return;
    await prisma.nationalAdminWithdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'failed', failureReason: 'Request timed out — no response from Safaricom' },
    });
    await refundNationalAdminWithdrawal(withdrawal.id).catch(e => console.error(`[${traceId}] Refund error:`, e.message));
    console.log(`[${traceId}] Withdrawal ${withdrawal.id} marked failed (timeout), balance refunded`);
  } catch (err: any) {
    console.error(`[${traceId}] ERROR:`, err.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getMpesaToken(): Promise<string> {
  const consumerKey    = process.env.MPESA_CONSUMER_KEY!;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET!;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const { data } = await axios.get(
    `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return data.access_token;
}
