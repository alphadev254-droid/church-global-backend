import prisma from '../lib/prisma';
import { queueEmail } from '../lib/emailQueue';
import { subscriptionExpiringTemplate, subscriptionExpiredTemplate } from '../lib/emailTemplates';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

/**
 * Check for expired subscriptions and mark them as expired
 * Runs every 24 hours via cron job
 */
export async function checkExpiredSubscriptions() {
  console.log('[Subscription Worker] Starting expired subscription check...');
  
  try {
    const now = new Date();
    
    // Find all active subscriptions that have expired
    const expiredSubscriptions = await prisma.subscription.updateMany({
      where: {
        status: 'active',
        expiresAt: { lt: now },
      },
      data: {
        status: 'expired',
      },
    });

    console.log(`[Subscription Worker] Marked ${expiredSubscriptions.count} subscriptions as expired`);
  } catch (error) {
    console.error('[Subscription Worker] Fatal error:', error);
  }
}

/**
 * Check for subscriptions expiring soon and send reminder emails
 * Days -6, -4, -2: 3 emails before expiration
 * Days 1-6: 6 emails after expiration (1 per day)
 */
export async function checkExpiringSubscriptions() {
  console.log('[Subscription Worker] Checking for expiring subscriptions...');
  
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const subscriptions = await prisma.subscription.findMany({
      where: {
        OR: [
          { status: 'active' },
          { status: 'expired', expiresAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } }
        ]
      },
      include: {
        package: true,
      },
    });

    console.log(`[Subscription Worker] Found ${subscriptions.length} subscriptions to check`);

    for (const subscription of subscriptions) {
      try {
        const daysUntilExpiry = Math.ceil((subscription.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const daysAfterExpiry = Math.ceil((now.getTime() - subscription.expiresAt.getTime()) / (1000 * 60 * 60 * 24));
        
        // NEAR EXPIRATION: 6, 4, 2 days before (3 emails)
        if (daysUntilExpiry === 6 && subscription.lastEmailDay !== -6) {
          await sendExpiringEmail(subscription, 6);
        } else if (daysUntilExpiry === 4 && subscription.lastEmailDay !== -4) {
          await sendExpiringEmail(subscription, 4);
        } else if (daysUntilExpiry === 2 && subscription.lastEmailDay !== -2) {
          await sendExpiringEmail(subscription, 2);
        }
        
        // EXPIRED: Days 1-6 after expiration (6 emails)
        else if (daysAfterExpiry >= 1 && daysAfterExpiry <= 6 && subscription.lastEmailDay !== daysAfterExpiry) {
          await sendExpiredEmail(subscription, daysAfterExpiry);
        }
      } catch (error) {
        console.error(`[Subscription Worker] Error processing subscription ${subscription.id}:`, error);
      }
    }

    console.log('[Subscription Worker] Expiring subscriptions check completed.');
  } catch (error) {
    console.error('[Subscription Worker] Fatal error:', error);
  }
}

async function sendExpiringEmail(subscription: any, daysLeft: number) {
  const user = await prisma.user.findUnique({ 
    where: { id: subscription.ministryAdminId },
    select: { firstName: true, email: true }
  });
  const pkg = subscription.package;
  
  if (!user) return;
  
  console.log(`[EXPIRING] Sending ${daysLeft}-day warning to ${user.email}`);
  
  await queueEmail(
    user.email,
    `Subscription Expiring in ${daysLeft} Days`,
    subscriptionExpiringTemplate({
      firstName: user.firstName,
      packageName: pkg.displayName,
      daysLeft,
      expiresAt: subscription.expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      renewUrl: `${FRONTEND_URL}/dashboard/packages`
    })
  );
  
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { lastEmailDay: -daysLeft }
  });
}

async function sendExpiredEmail(subscription: any, daysSinceExpiry: number) {
  const user = await prisma.user.findUnique({ 
    where: { id: subscription.ministryAdminId },
    select: { firstName: true, email: true }
  });
  const pkg = subscription.package;
  
  if (!user) return;
  
  console.log(`[EXPIRED] Sending day ${daysSinceExpiry} reminder to ${user.email}`);
  
  await queueEmail(
    user.email,
    `Subscription Expired - Day ${daysSinceExpiry} Reminder`,
    subscriptionExpiredTemplate({
      firstName: user.firstName,
      packageName: pkg.displayName,
      expiredAt: subscription.expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      daysSinceExpiry,
      renewUrl: `${FRONTEND_URL}/dashboard/packages`
    })
  );
  
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { lastEmailDay: daysSinceExpiry }
  });
}

// Run both checks
export async function runSubscriptionChecks() {
  await checkExpiredSubscriptions();
  await checkExpiringSubscriptions();
}

// If running directly
if (require.main === module) {
  runSubscriptionChecks()
    .then(() => {
      console.log('[Subscription Worker] All checks completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Subscription Worker] Failed:', error);
      process.exit(1);
    });
}
