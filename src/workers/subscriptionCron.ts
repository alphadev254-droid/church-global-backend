import cron from 'node-cron';
import { runSubscriptionChecks } from './subscriptionWorker';
import { processKPIRecurrence } from './kpiWorker';

/**
 * Schedule subscription checks to run daily at 2 AM
 */
export function startSubscriptionCron() {
  // Run every day at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] Running daily subscription checks...');
    try {
      await runSubscriptionChecks();
    } catch (error) {
      console.error('[Cron] Subscription check failed:', error);
    }
  });

  console.log('[Cron] Subscription checker scheduled (daily at 2:00 AM)');
}

/**
 * Schedule KPI recurrence to run daily at 1 AM
 */
export function startKPICron() {
  cron.schedule('0 1 * * *', async () => {
    console.log('[Cron] Running daily KPI recurrence...');
    try {
      await processKPIRecurrence();
    } catch (error) {
      console.error('[Cron] KPI recurrence failed:', error);
    }
  });

  console.log('[Cron] KPI recurrence scheduled (daily at 1:00 AM)');
}
