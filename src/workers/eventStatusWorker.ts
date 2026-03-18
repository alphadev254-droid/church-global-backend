import cron from 'node-cron';
import prisma from '../lib/prisma';

export async function updateEventStatuses() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Mark upcoming events as ongoing if date has arrived
  await prisma.event.updateMany({
    where: {
      status: 'upcoming',
      date: { lte: today },
    },
    data: { status: 'ongoing' },
  });

  // Mark ongoing events as completed if endDate has passed
  const ongoingEvents = await prisma.event.findMany({
    where: { status: 'ongoing' },
    select: { id: true, endDate: true },
  });

  const completedEventIds = ongoingEvents
    .filter(e => new Date(e.endDate) < today)
    .map(e => e.id);

  if (completedEventIds.length > 0) {
    await prisma.event.updateMany({
      where: { id: { in: completedEventIds } },
      data: { status: 'completed' },
    });
  }

  console.log(`[Event Worker] Updated event statuses at ${now.toISOString()}`);
}

// Run daily at midnight
export function startEventStatusWorker() {
  cron.schedule('0 0 * * *', async () => {
    try {
      await updateEventStatuses();
    } catch (error) {
      console.error('[Event Worker] Error updating event statuses:', error);
    }
  });
  console.log('[Event Worker] Started - runs daily at midnight');
}
