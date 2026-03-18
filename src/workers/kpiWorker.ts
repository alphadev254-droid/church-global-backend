import prisma from '../lib/prisma';

function getNextPeriod(endDate: Date, period: string): { startDate: Date; endDate: Date } {
  const start = new Date(endDate);
  start.setDate(start.getDate() + 1);

  let end = new Date(start);

  if (period === 'monthly') {
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
  } else if (period === 'quarterly') {
    end.setMonth(end.getMonth() + 3);
    end.setDate(0);
  } else if (period === 'yearly') {
    end.setFullYear(end.getFullYear() + 1);
    end.setMonth(11);
    end.setDate(31);
  }

  return { startDate: start, endDate: end };
}

export async function processKPIRecurrence() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log('[KPI] Starting daily KPI processing...');

  try {
    // Mark expired KPIs as completed
    const expiredResult = await prisma.kPI.updateMany({
      where: {
        endDate: { lt: today },
        status: 'active',
      },
      data: {
        status: 'completed',
      },
    });

    console.log(`[KPI] Marked ${expiredResult.count} KPIs as completed`);

    // Create recurring KPIs
    const expiredRecurringKPIs = await prisma.kPI.findMany({
      where: {
        isRecurring: true,
        recurringActive: true,
        status: 'completed',
        endDate: { lt: today },
      },
    });

    console.log(`[KPI] Found ${expiredRecurringKPIs.length} recurring KPIs to process`);

    let created = 0;
    for (const kpi of expiredRecurringKPIs) {
      try {
        const nextPeriod = getNextPeriod(kpi.endDate, kpi.period);

        const exists = await prisma.kPI.findFirst({
          where: {
            parentKpiId: kpi.parentKpiId || kpi.id,
            startDate: nextPeriod.startDate,
          },
        });

        if (exists) continue;

        await prisma.kPI.create({
          data: {
            name: kpi.name,
            description: kpi.description,
            category: kpi.category,
            metricType: kpi.metricType,
            attendanceType: kpi.attendanceType,
            eventId: kpi.eventId,
            targetValue: kpi.targetValue,
            currentValue: 0,
            unit: kpi.unit,
            period: kpi.period,
            startDate: nextPeriod.startDate,
            endDate: nextPeriod.endDate,
            status: 'active',
            isRecurring: true,
            recurringActive: true,
            parentKpiId: kpi.parentKpiId || kpi.id,
            recurrenceCount: kpi.recurrenceCount + 1,
            ministryAdminId: kpi.ministryAdminId,
            churchId: kpi.churchId,
          },
        });

        await prisma.kPI.update({
          where: { id: kpi.id },
          data: { recurringActive: false },
        });

        created++;
      } catch (error) {
        console.error(`[KPI] Error processing KPI ${kpi.id}:`, error);
      }
    }

    console.log(`[KPI] Created ${created} recurring KPIs`);
  } catch (error) {
    console.error('[KPI] Error in processKPIRecurrence:', error);
  }
}
