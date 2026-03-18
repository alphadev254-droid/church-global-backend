import prisma from '../lib/prisma';

export async function creditChurchWallet(
  churchId: string,
  amount: number,
  source: string,
  sourceId: string,
  description: string
) {
  let wallet = await prisma.wallet.findUnique({
    where: { churchId }
  });

  if (!wallet) {
    const church = await prisma.church.findUnique({
      where: { id: churchId },
      select: { ministryAdminId: true }
    });

    wallet = await prisma.wallet.create({
      data: {
        churchId,
        ministryAdminId: church!.ministryAdminId!,
        balance: 0,
        currency: 'MWK'
      }
    });
  }

  const balanceBefore = wallet.balance;
  const balanceAfter = balanceBefore + amount;

  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { balance: balanceAfter }
  });

  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: 'credit',
      amount,
      balanceBefore,
      balanceAfter,
      source,
      sourceId,
      description
    }
  });

  return { balanceBefore, balanceAfter };
}

export async function debitChurchWallet(
  walletId: string,
  amount: number,
  source: string,
  sourceId: string,
  description: string
) {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId }
  });

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  if (wallet.balance < amount) {
    throw new Error('Insufficient balance');
  }

  const balanceBefore = wallet.balance;
  const balanceAfter = balanceBefore - amount;

  await prisma.wallet.update({
    where: { id: walletId },
    data: { balance: balanceAfter }
  });

  await prisma.walletTransaction.create({
    data: {
      walletId,
      type: 'debit',
      amount,
      balanceBefore,
      balanceAfter,
      source,
      sourceId,
      description
    }
  });

  return { balanceBefore, balanceAfter };
}

export async function refundWithdrawal(withdrawalId: string) {
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
    include: { wallet: true }
  });

  if (!withdrawal) {
    throw new Error('Withdrawal not found');
  }

  await creditChurchWallet(
    withdrawal.wallet.churchId,
    withdrawal.amount,
    'refund',
    withdrawalId,
    `Refund for failed withdrawal - ${withdrawalId}`
  );
}
