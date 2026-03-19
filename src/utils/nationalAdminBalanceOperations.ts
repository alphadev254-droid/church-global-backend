import prisma from '../lib/prisma';

/**
 * Credit the national admin balance when a ticket or donation is paid.
 * Resolves church → ministryAdminId, upserts the balance row, and logs a tx entry.
 */
export async function creditNationalAdminBalance(
  churchId: string,
  amount: number,
  source: string,   // 'event_ticket' | 'donation'
  sourceId: string, // transaction id
  description: string
): Promise<void> {
  const church = await prisma.church.findUnique({
    where: { id: churchId },
    select: { ministryAdminId: true },
  });

  const ministryAdminId = church?.ministryAdminId;
  if (!ministryAdminId) return; // no national admin linked — skip

  // Get current balance (0 if first time)
  const existing = await prisma.nationalAdminBalance.findUnique({
    where: { ministryAdminId },
    select: { id: true, balance: true },
  });

  const balanceBefore = existing?.balance ?? 0;
  const balanceAfter  = balanceBefore + amount;

  const balanceRow = await prisma.nationalAdminBalance.upsert({
    where:  { ministryAdminId },
    create: { ministryAdminId, balance: balanceAfter, currency: 'KES' },
    update: { balance: balanceAfter },
  });

  await prisma.nationalAdminBalanceTx.create({
    data: {
      balanceId:       balanceRow.id,
      ministryAdminId,
      churchId,
      type:            'credit',
      amount,
      balanceBefore,
      balanceAfter,
      source,
      sourceId,
      description,
    },
  });
}

/**
 * Debit the national admin balance for a withdrawal.
 * Throws if insufficient. Returns the balanceRow id.
 */
export async function debitNationalAdminBalance(
  ministryAdminId: string,
  amount: number,
  withdrawalId: string
): Promise<string> {
  const balanceRow = await prisma.nationalAdminBalance.findUnique({
    where: { ministryAdminId },
  });

  if (!balanceRow || balanceRow.balance < amount) {
    throw new Error(`Insufficient balance. Available: KES ${balanceRow?.balance ?? 0}`);
  }

  const balanceBefore = balanceRow.balance;
  const balanceAfter  = balanceBefore - amount;

  await prisma.nationalAdminBalance.update({
    where: { ministryAdminId },
    data:  { balance: balanceAfter },
  });

  // Use ministryAdminId as churchId placeholder for debit entries (withdrawal is admin-level)
  await prisma.nationalAdminBalanceTx.create({
    data: {
      balanceId:       balanceRow.id,
      ministryAdminId,
      churchId:        ministryAdminId, // no specific church for withdrawals
      type:            'debit',
      amount,
      balanceBefore,
      balanceAfter,
      source:          'withdrawal',
      sourceId:        withdrawalId,
      description:     `Withdrawal - ${withdrawalId}`,
    },
  });

  return balanceRow.id;
}

/**
 * Refund a failed withdrawal back to the national admin balance.
 */
export async function refundNationalAdminWithdrawal(withdrawalId: string): Promise<void> {
  const withdrawal = await prisma.nationalAdminWithdrawal.findUnique({
    where: { id: withdrawalId },
    select: { ministryAdminId: true, grossAmount: true },
  });
  if (!withdrawal) return;

  const balanceRow = await prisma.nationalAdminBalance.findUnique({
    where: { ministryAdminId: withdrawal.ministryAdminId },
  });
  if (!balanceRow) return;

  const balanceBefore = balanceRow.balance;
  const balanceAfter  = balanceBefore + withdrawal.grossAmount;

  await prisma.nationalAdminBalance.update({
    where: { ministryAdminId: withdrawal.ministryAdminId },
    data:  { balance: balanceAfter },
  });

  await prisma.nationalAdminBalanceTx.create({
    data: {
      balanceId:       balanceRow.id,
      ministryAdminId: withdrawal.ministryAdminId,
      churchId:        withdrawal.ministryAdminId,
      type:            'credit',
      amount:          withdrawal.grossAmount,
      balanceBefore,
      balanceAfter,
      source:          'refund',
      sourceId:        withdrawalId,
      description:     `Refund for failed withdrawal - ${withdrawalId}`,
    },
  });
}
