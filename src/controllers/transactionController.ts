import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getAccessibleChurchIds } from '../lib/churchScope';

export async function getTransactions(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role ?? 'member';
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Pagination params
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.max(100, parseInt(req.query.limit as string) || 100);
  const skip = (page - 1) * limit;

  // Search and filter params
  const search = (req.query.search as string)?.trim() || '';
  const type = req.query.type as string | undefined;
  const status = req.query.status as string | undefined;
  const paymentMethod = req.query.paymentMethod as string | undefined;
  const filterChurchId = req.query.churchId as string | undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;

  let churchIds: string[] = [];

  if (roleName === 'ministry_admin') {
    const churches = await prisma.church.findMany({
      where: { ministryAdminId: userId },
      select: { id: true }
    });
    churchIds = churches.map(c => c.id);
  } else if (roleName === 'member') {
    // Members see only their own transactions
    const whereClause: any = { userId };
    if (type) whereClause.type = type;
    if (status) whereClause.status = status;
    if (paymentMethod) whereClause.paymentMethod = paymentMethod;
    if (search) {
      whereClause.OR = [
        { user: { firstName: { contains: search, mode: 'insensitive' } } },
        { user: { lastName: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt.gte = new Date(startDate);
      if (endDate) whereClause.createdAt.lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: whereClause,
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          type: true,
          paymentMethod: true,
          isManual: true,
          subaccountName: true,
          cardLast4: true,
          cardBank: true,
          baseAmount: true,
          convenienceFee: true,
          systemFeeAmount: true,
          totalAmount: true,
          gateway: true,
          isGuest: true,
          guestName: true,
          guestEmail: true,
          createdAt: true,
          church: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where: whereClause }),
    ]);
    res.json({ success: true, data: transactions, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    return;
  } else {
    if (!churchId) {
      res.status(400).json({ success: false, message: 'churchId required' });
      return;
    }
    churchIds = await getAccessibleChurchIds(roleName, churchId, req.user?.districts, req.user?.traditionalAuthorities, req.user?.regions, userId);
  }

  // Build where clause for admins
  const whereClause: any = { churchId: { in: churchIds } };
  if (filterChurchId && churchIds.includes(filterChurchId)) whereClause.churchId = filterChurchId;
  if (type) whereClause.type = type;
  if (status) whereClause.status = status;
  if (paymentMethod) whereClause.paymentMethod = paymentMethod;
  if (search) {
    whereClause.OR = [
      { user: { firstName: { contains: search, mode: 'insensitive' } } },
      { user: { lastName: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
    ];
  }
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate);
    if (endDate) whereClause.createdAt.lte = new Date(endDate);
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: whereClause,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        type: true,
        paymentMethod: true,
        isManual: true,
        subaccountName: true,
        cardLast4: true,
        cardBank: true,
        baseAmount: true,
        convenienceFee: true,
        systemFeeAmount: true,
        totalAmount: true,
        gateway: true,
        isGuest: true,
        guestName: true,
        guestEmail: true,
        createdAt: true,
        user: { select: { firstName: true, lastName: true, email: true } },
        church: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where: whereClause }),
  ]);
  res.json({ success: true, data: transactions, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

export async function getTransaction(req: Request, res: Response): Promise<void> {
  const transaction = await prisma.transaction.findUnique({ 
    where: { id: String(req.params.id) },
    include: { 
      user: { select: { firstName: true, lastName: true, email: true } },
      church: { select: { name: true } },
      tickets: { include: { event: true } }
    }
  });
  if (!transaction) { res.status(404).json({ success: false, message: 'Transaction not found' }); return; }
  res.json({ success: true, data: transaction });
}

export async function updateTransactionStatus(req: Request, res: Response): Promise<void> {
  const { status } = req.body;
  if (!['pending', 'completed', 'failed', 'refunded'].includes(status)) {
    res.status(400).json({ success: false, message: 'Invalid status' });
    return;
  }

  const transaction = await prisma.transaction.update({
    where: { id: String(req.params.id) },
    data: { status },
  });
  res.json({ success: true, data: transaction });
}
