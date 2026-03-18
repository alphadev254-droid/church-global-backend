import nodemailer from 'nodemailer';

console.log('[EMAIL] SMTP config — host:', process.env.SMTP_HOST, 'port:', process.env.SMTP_PORT, 'secure:', process.env.SMTP_SECURE, 'user:', process.env.SMTP_USER ? process.env.SMTP_USER : 'NOT SET');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(to: string | string[], subject: string, html: string, attachments?: Array<{ filename: string; content: Buffer }>) {
  const recipients = Array.isArray(to) ? to.join(', ') : to;
  console.log(`[EMAIL] Attempting to send "${subject}" to ${recipients} — attachments: ${attachments?.length ?? 0}`);
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.SYSTEM || 'ICIMS'}" <${process.env.SMTP_USER}>`,
      to: Array.isArray(to) ? to.join(',') : to,
      subject,
      html,
      attachments,
    });
    console.log(`[EMAIL] ✅ Sent to ${recipients} — messageId: ${info.messageId}`);
  } catch (error: any) {
    console.error(`[EMAIL] ❌ Failed to send to ${recipients} — subject: "${subject}"`);
    console.error(`[EMAIL] Error code: ${error.code} message: ${error.message}`);
    if (error.response) console.error(`[EMAIL] SMTP response: ${error.response}`);
    throw error;
  }
}
