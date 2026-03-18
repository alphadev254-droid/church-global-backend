import cron from 'node-cron';
import prisma from '../lib/prisma';

// Runs daily at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('[ReminderCache] Starting daily refresh...');
  await refreshReminderCache();
});

export async function refreshReminderCache() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  // Clear old cache (past reminders)
  await prisma.reminderCache.deleteMany({
    where: { upcomingDate: { lt: today } }
  });

  // Get all active users with date fields
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { dateOfBirth: { not: null } },
        { weddingDate: { not: null } },
        { anniversary: { not: null } },
      ],
      status: 'active',
      churchId: { not: null },
    },
    select: {
      id: true,
      dateOfBirth: true,
      weddingDate: true,
      anniversary: true,
      createdAt: true,
      churchId: true,
      maritalStatus: true,
      role: { select: { name: true } },
      church: { select: { ministryAdminId: true } },
    },
  });

  const reminders = [];

  for (const user of users) {
    const ministryAdminId = user.church?.ministryAdminId || null;

    // Birthday
    if (user.dateOfBirth) {
      const next = getNextOccurrence(user.dateOfBirth, today);
      const daysUntil = Math.floor((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil <= 30) {
        reminders.push({
          userId: user.id,
          type: 'birthday',
          originalDate: user.dateOfBirth,
          upcomingDate: next,
          daysUntil,
          age: next.getFullYear() - user.dateOfBirth.getFullYear(),
          churchId: user.churchId!,
          ministryAdminId,
        });
      }
    }

    // Wedding Anniversary
    if (user.weddingDate && user.maritalStatus === 'Married') {
      const next = getNextOccurrence(user.weddingDate, today);
      const daysUntil = Math.floor((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil <= 30) {
        reminders.push({
          userId: user.id,
          type: 'wedding',
          originalDate: user.weddingDate,
          upcomingDate: next,
          daysUntil,
          years: next.getFullYear() - user.weddingDate.getFullYear(),
          churchId: user.churchId!,
          ministryAdminId,
        });
      }
    }

    // Member Anniversary (skip first year)
    const memberNext = getNextOccurrence(user.createdAt, today);
    const memberYears = memberNext.getFullYear() - user.createdAt.getFullYear();
    const daysUntilMember = Math.floor((memberNext.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilMember <= 30 && memberYears > 0) {
      reminders.push({
        userId: user.id,
        type: 'member_anniversary',
        originalDate: user.createdAt,
        upcomingDate: memberNext,
        daysUntil: daysUntilMember,
        years: memberYears,
        churchId: user.churchId!,
        ministryAdminId,
      });
    }

    // Church Founded (National Admin only)
    if (user.anniversary && user.role?.name === 'ministry_admin') {
      const next = getNextOccurrence(user.anniversary, today);
      const daysUntil = Math.floor((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil <= 30) {
        reminders.push({
          userId: user.id,
          type: 'church_founded',
          originalDate: user.anniversary,
          upcomingDate: next,
          daysUntil,
          years: next.getFullYear() - user.anniversary.getFullYear(),
          churchId: user.churchId!,
          ministryAdminId,
        });
      }
    }
  }

  // Get upcoming events with church members in one query
  const upcomingEvents = await prisma.event.findMany({
    where: {
      date: { gte: today, lte: thirtyDaysFromNow },
      status: { in: ['upcoming', 'ongoing'] },
    },
    select: {
      id: true,
      title: true,
      date: true,
      churchId: true,
      isFree: true,
      requiresTicket: true,
      tickets: { select: { userId: true, user: { select: { churchId: true } } }, where: { isGuest: false } },
      church: { select: { ministryAdminId: true } },
    },
  });

  // Get all church IDs for free events
  const freeEventChurchIds = upcomingEvents
    .filter(e => e.isFree && !e.requiresTicket)
    .map(e => e.churchId);

  // Fetch all members for free event churches in one query
  const churchMembersMap = new Map<string, Array<{ id: string; churchId: string }>>();
  if (freeEventChurchIds.length > 0) {
    const allChurchMembers = await prisma.user.findMany({
      where: {
        churchId: { in: freeEventChurchIds },
        status: 'active',
        role: { name: 'member' },
      },
      select: { id: true, churchId: true },
    });

    // Group members by churchId
    for (const member of allChurchMembers) {
      if (member.churchId) {
        if (!churchMembersMap.has(member.churchId)) {
          churchMembersMap.set(member.churchId, []);
        }
        churchMembersMap.get(member.churchId)!.push({ id: member.id, churchId: member.churchId });
      }
    }
  }

  // Create event reminders
  for (const event of upcomingEvents) {
    const eventDate = new Date(event.date);
    eventDate.setHours(0, 0, 0, 0);
    const daysUntil = Math.floor((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const ministryAdminId = event.church?.ministryAdminId || null;

    if (event.isFree && !event.requiresTicket) {
      // Use pre-fetched church members
      const churchMembers = churchMembersMap.get(event.churchId) || [];
      for (const member of churchMembers) {
        if (member.churchId) {
          reminders.push({
            userId: member.id,
            type: 'event',
            originalDate: event.date,
            upcomingDate: eventDate,
            daysUntil,
            churchId: member.churchId,
            ministryAdminId,
            eventId: event.id,
            eventTitle: event.title,
          });
        }
      }
    } else if (event.requiresTicket) {
      // Use tickets data already loaded
      const uniqueTickets = new Map<string, string>();
      for (const ticket of event.tickets) {
        if (ticket.userId && ticket.user?.churchId) {
          uniqueTickets.set(ticket.userId, ticket.user.churchId);
        }
      }

      for (const [userId, churchId] of uniqueTickets) {
        reminders.push({
          userId,
          type: 'event',
          originalDate: event.date,
          upcomingDate: eventDate,
          daysUntil,
          churchId,
          ministryAdminId,
          eventId: event.id,
          eventTitle: event.title,
        });
      }
    }
  }

  // Batch upsert reminders
  const batchSize = 100;
  for (let i = 0; i < reminders.length; i += batchSize) {
    const batch = reminders.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (reminder) => {
        const uniqueKey = {
          userId: reminder.userId,
          type: reminder.type,
          upcomingDate: reminder.upcomingDate,
          eventId: reminder.eventId || null,
        };

        return prisma.reminderCache.upsert({
          where: { userId_type_upcomingDate_eventId: uniqueKey as any },
          update: {
            daysUntil: reminder.daysUntil,
            age: reminder.age,
            years: reminder.years,
            eventTitle: reminder.eventTitle,
          },
          create: reminder,
        });
      })
    );
  }

  console.log(`[ReminderCache] Refreshed ${reminders.length} reminders`);
}

function getNextOccurrence(date: Date, from: Date): Date {
  const thisYear = new Date(from.getFullYear(), date.getMonth(), date.getDate());
  thisYear.setHours(0, 0, 0, 0);
  
  if (thisYear >= from) {
    return thisYear;
  }
  
  const nextYear = new Date(thisYear);
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  return nextYear;
}
