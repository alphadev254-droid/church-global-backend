import prisma from '../lib/prisma';
import { sendEmail } from '../lib/email';

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY = 60000; // 1 minute

let isProcessing = false;

console.log('📧 Email worker starting...');

export async function processEmailQueue(): Promise<void> {
  if (isProcessing) {
    console.log('⏭️  Email worker already running, skipping...');
    return;
  }

  isProcessing = true;
  const runId = `EMAIL-RUN-${Date.now()}`;
  console.log(`[${runId}] ========== EMAIL WORKER TICK ==========`);

  try {
    const emails = await prisma.$queryRaw<any[]>`
      SELECT * FROM email_queue
      WHERE status = 'pending' AND attempts < ${MAX_ATTEMPTS}
      ORDER BY createdAt ASC
      LIMIT ${BATCH_SIZE}
    `;

    console.log(`[${runId}] Found ${emails.length} pending email(s)`);

    if (emails.length === 0) {
      console.log(`[${runId}] Nothing to process`);
      return;
    }

    for (const email of emails) {
      console.log(`[${runId}] Processing email id=${email.id} to=${email.to} subject="${email.subject}" attempts=${email.attempts}`);
      try {
        const recipients = email.to.split(',').map((e: string) => e.trim());
        const attachments = email.attachments
          ? JSON.parse(email.attachments).map((a: any) => ({
              filename: a.filename,
              content: Buffer.from(a.content, 'base64'),
            }))
          : undefined;

        console.log(`[${runId}] Sending to ${recipients.join(', ')} — attachments: ${attachments?.length ?? 0}`);
        await sendEmail(recipients, email.subject, email.html, attachments);

        await prisma.$executeRaw`
          UPDATE email_queue
          SET status = 'sent', sentAt = NOW()
          WHERE id = ${email.id}
        `;
        console.log(`[${runId}] ✅ Sent id=${email.id}`);
      } catch (error: any) {
        const nextAttempts = email.attempts + 1;
        const nextStatus = nextAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        console.error(`[${runId}] ❌ Failed id=${email.id} attempt=${nextAttempts}/${MAX_ATTEMPTS} status=${nextStatus}`);
        console.error(`[${runId}] Error:`, error.message);
        if (error.response) console.error(`[${runId}] SMTP response:`, error.response);

        await prisma.$executeRaw`
          UPDATE email_queue
          SET attempts = attempts + 1, error = ${error.message}, status = ${nextStatus}
          WHERE id = ${email.id}
        `;
      }
    }
  } catch (error: any) {
    console.error(`[${runId}] Queue processing error:`, error.message);
  } finally {
    isProcessing = false;
    console.log(`[${runId}] ========== EMAIL WORKER DONE ==========`);
  }
}

setInterval(processEmailQueue, RETRY_DELAY);
processEmailQueue();
