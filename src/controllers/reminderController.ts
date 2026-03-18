import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getAccessibleChurchIds } from '../lib/churchScope';

export async function getReminders(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role ?? 'member';

  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  const type = req.query.type as string | undefined;
  const days = parseInt(req.query.days as string) || 30;
  const filterChurchId = req.query.churchId as string | undefined;

  let whereClause: any = { daysUntil: { lte: days, gte: 0 } };

  // Apply type filter
  if (type) whereClause.type = type;

  // Apply church filter if provided
  if (filterChurchId) whereClause.churchId = filterChurchId;

  // Scope-based filtering (only if no specific church filter is applied)
  if (!filterChurchId) {
    if (roleName === 'member') {
      // Members see only their own reminders
      whereClause.userId = userId;
    } else if (roleName === 'ministry_admin') {
      // National admin sees reminders from their churches
      whereClause.ministryAdminId = userId;
    } else {
      // Other roles use churchScope
      const churchIds = await getAccessibleChurchIds(
        roleName,
        churchId,
        req.user?.districts,
        req.user?.traditionalAuthorities,
        req.user?.regions,
        userId
      );
      whereClause.churchId = { in: churchIds };
    }
  } else {
    // Verify user has access to the filtered church
    if (roleName === 'member') {
      // Members can only filter their own church
      if (filterChurchId !== churchId) {
        res.status(403).json({ success: false, message: 'Access denied to this church' });
        return;
      }
      whereClause.userId = userId;
    } else if (roleName === 'ministry_admin') {
      // Verify church belongs to this national admin
      const church = await prisma.church.findFirst({
        where: { id: filterChurchId, ministryAdminId: userId },
      });
      if (!church) {
        res.status(403).json({ success: false, message: 'Access denied to this church' });
        return;
      }
      whereClause.ministryAdminId = userId;
    } else {
      // Verify church is in accessible scope
      const churchIds = await getAccessibleChurchIds(
        roleName,
        churchId,
        req.user?.districts,
        req.user?.traditionalAuthorities,
        req.user?.regions,
        userId
      );
      if (!churchIds.includes(filterChurchId)) {
        res.status(403).json({ success: false, message: 'Access denied to this church' });
        return;
      }
    }
  }

  const reminders = await prisma.reminderCache.findMany({
    where: whereClause,
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          avatar: true,
        },
      },
      church: {
        select: {
          id: true,
          name: true,
        },
      },
      event: {
        select: {
          id: true,
          title: true,
          date: true,
          location: true,
          contactEmail: true,
          contactPhone: true,
        },
      },
    },
    orderBy: { daysUntil: 'asc' },
    take: 100,
  });

  // Group event reminders by eventId to avoid duplicates and format data
  const uniqueReminders: any[] = [];
  const seenEvents = new Set<string>();

  for (const reminder of reminders) {
    if (reminder.type === 'event' && reminder.eventId) {
      if (!seenEvents.has(reminder.eventId)) {
        seenEvents.add(reminder.eventId);
        // For event reminders, exclude user object and ministryAdminId
        const { user, ministryAdminId, ...eventReminderData } = reminder;
        uniqueReminders.push(eventReminderData);
      }
    } else {
      // For other reminders, only include if user is the person with the birthday/wedding/anniversary
      if (reminder.userId !== userId) {
        const { user, ministryAdminId, ...reminderData } = reminder;
        uniqueReminders.push(reminderData);
      } else {
        uniqueReminders.push(reminder);
      }
    }
  }

  // Calculate stats
  const stats = {
    total: uniqueReminders.length,
    birthdays: uniqueReminders.filter(r => r.type === 'birthday').length,
    weddings: uniqueReminders.filter(r => r.type === 'wedding').length,
    memberAnniversaries: uniqueReminders.filter(r => r.type === 'member_anniversary').length,
    churchFounded: uniqueReminders.filter(r => r.type === 'church_founded').length,
    events: uniqueReminders.filter(r => r.type === 'event').length,
  };

  res.json({ success: true, data: uniqueReminders, stats });
}

export async function getTodayReminders(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role ?? 'member';

  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  let whereClause: any = { daysUntil: 0 };

  // Scope-based filtering
  if (roleName === 'member') {
    whereClause.userId = userId;
  } else if (roleName === 'ministry_admin') {
    whereClause.ministryAdminId = userId;
  } else {
    const churchIds = await getAccessibleChurchIds(
      roleName,
      churchId,
      req.user?.districts,
      req.user?.traditionalAuthorities,
      req.user?.regions,
      userId
    );
    whereClause.churchId = { in: churchIds };
  }

  const reminders = await prisma.reminderCache.findMany({
    where: whereClause,
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      church: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { type: 'asc' },
  });

  res.json({ success: true, data: reminders });
}
