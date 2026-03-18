import app from './app';
import prisma from './lib/prisma';
import './workers/emailWorker';
import './workers/reminderCacheWorker';
import { startSubscriptionCron, startKPICron } from './workers/subscriptionCron';
import { startEventStatusWorker } from './workers/eventStatusWorker';

const PORT = process.env.PORT || 5000;

async function main() {
  await prisma.$connect();
  console.log('✅ Database connected');
  console.log('📧 Email worker initialized');
  console.log('🔔 Reminder cache worker initialized');
  
  // Start cron jobs
  startSubscriptionCron();
  startKPICron();
  startEventStatusWorker();
  console.log('📅 Cron jobs initialized');

  app.listen(PORT, () => {
    console.log(`🚀 ICIMS API running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
    console.log(`   Auth:   http://localhost:${PORT}/api/auth`);
    console.log(`   Env:    ${process.env.NODE_ENV}`);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
