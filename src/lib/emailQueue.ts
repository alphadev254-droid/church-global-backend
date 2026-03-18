import prisma from './prisma';

export type EmailType = 
  | 'user_created'
  | 'registration'
  | 'password_reset'
  | 'password_changed'
  | 'ticket_purchase'
  | 'donation_receipt'
  | 'withdrawal_request_user'
  | 'withdrawal_request_admin'
  | 'package_subscription'
  | 'notification';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export async function queueEmail(
  to: string,
  subject: string,
  html: string,
  attachmentsOrType?: EmailAttachment[] | EmailType,
  emailType?: EmailType
): Promise<void> {
  // Handle overloaded parameters
  let attachments: EmailAttachment[] | undefined;
  let type: EmailType = 'notification';
  
  if (typeof attachmentsOrType === 'string') {
    // Called with (to, subject, html, emailType)
    attachments = undefined;
    type = attachmentsOrType;
  } else {
    // Called with (to, subject, html, attachments, emailType)
    attachments = attachmentsOrType;
    type = emailType || 'notification';
  }
  
  const attachmentsJson = attachments ? JSON.stringify(attachments.map(a => ({
    filename: a.filename,
    content: a.content.toString('base64')
  }))) : null;
  
  await prisma.$executeRaw`
    INSERT INTO email_queue (id, \`to\`, subject, html, attachments, \`type\`, status, attempts, createdAt)
    VALUES (${generateId()}, ${to}, ${subject}, ${html}, ${attachmentsJson}, ${type}, 'pending', 0, NOW())
  `;
}

function generateId(): string {
  return `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
