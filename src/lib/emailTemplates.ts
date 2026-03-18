const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
const SYSTEM_NAME = process.env.SYSTEM || 'ICIMS';

const getBaseStyle = () => `
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; background-color: #f9fafb; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .church-header { background: white; color: #1e3a8a; padding: 20px 24px; text-align: center; border-bottom: 4px solid #d4a574; }
    .church-header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
    .header { background: #d4a574; color: white; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .header p { margin: 8px 0 0 0; opacity: 0.9; font-size: 14px; }
    .content { padding: 32px 24px; }
    .content h2 { margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #111827; }
    .content p { margin: 0 0 16px 0; color: #4b5563; }
    .button { display: inline-block; background: #d4a574; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0; font-weight: 500; }
    .button:hover { background: #c89563; }
    .info-box { background: #f3f4f6; padding: 20px; border-radius: 6px; border-left: 4px solid #d4a574; margin: 20px 0; }
    .info-box h3 { margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: #111827; }
    .info-box p { margin: 8px 0; color: #4b5563; font-size: 14px; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
    .footer p { margin: 4px 0; }
    ol { padding-left: 20px; }
    ol li { margin: 8px 0; color: #4b5563; }
  </style>
`;

const getChurchHeader = (churchName?: string) => churchName ? `
  <div class="church-header">
    <h1>${churchName}</h1>
  </div>
` : '';

export const userCreatedTemplate = (data: { firstName: string; lastName: string; email: string; password: string; churchName?: string; roleName?: string }) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    ${getChurchHeader(data.churchName)}
    <div class="header">
      <h1>${SYSTEM_NAME}</h1>
      <p>Welcome to the Church Management System</p>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName} ${data.lastName},</h2>
      <p>Your account has been created successfully${data.churchName ? ` for ${data.churchName}` : ''}.</p>
      
      <div class="info-box">
        <h3>Your Login Credentials</h3>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Temporary Password:</strong> ${data.password}</p>
        ${data.roleName ? `<p><strong>Role:</strong> ${data.roleName}</p>` : ''}
      </div>
      
      <p><strong>Important:</strong> Please change your password after your first login for security purposes.</p>
      
      <a href="${FRONTEND_URL}/login" class="button">Login to Your Account</a>
      
      <p>If you have any questions, please contact your church administrator.</p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName || SYSTEM_NAME}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

export const registrationTemplate = (data: { firstName: string; lastName: string; email: string; roleName?: string; churchName?: string }) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    ${getChurchHeader(data.churchName)}
    <div class="header">
      <h1>Welcome to ${SYSTEM_NAME}!</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName} ${data.lastName},</h2>
      <p>Thank you for registering with ${SYSTEM_NAME}. Your account has been created successfully!</p>
      
      <div class="info-box">
        <h3>Account Information</h3>
        <p><strong>Email:</strong> ${data.email}</p>
        ${data.roleName ? `<p><strong>Role:</strong> ${data.roleName}</p>` : ''}
      </div>
      
      <h3>Next Steps:</h3>
      <ol>
        <li><strong>Choose a Package:</strong> Select a subscription package that fits your church's needs</li>
        <li><strong>Set Up Your Church:</strong> Add your church information and customize your profile</li>
        <li><strong>Invite Members:</strong> Start adding your church members to the system</li>
      </ol>
      
      <a href="${FRONTEND_URL}/dashboard" class="button">Get Started</a>
      
      <p>Need help? Contact our support team or visit our documentation.</p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName || SYSTEM_NAME}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

export const passwordResetTemplate = (data: { firstName: string; resetToken: string; churchName?: string }) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    ${getChurchHeader(data.churchName)}
    <div class="header">
      <h1>Password Reset Request</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName},</h2>
      <p>We received a request to reset your password. Click the button below to create a new password:</p>
      
      <a href="${FRONTEND_URL}/reset-password?token=${data.resetToken}" class="button">Reset Password</a>
      
      <p>This link will expire in 1 hour for security reasons.</p>
      
      <p><strong>If you didn't request this,</strong> please ignore this email and your password will remain unchanged.</p>
      
      <p style="color: #6b7280; font-size: 14px;">For security, never share this link with anyone.</p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName || SYSTEM_NAME}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

export const passwordChangedTemplate = (data: { firstName: string; email: string; churchName?: string }) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    ${getChurchHeader(data.churchName)}
    <div class="header">
      <h1>Password Changed Successfully</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName},</h2>
      <p>Your password has been changed successfully.</p>
      
      <div class="info-box">
        <p><strong>Account:</strong> ${data.email}</p>
        <p><strong>Changed:</strong> ${new Date().toLocaleString()}</p>
      </div>
      
      <p><strong>If you didn't make this change,</strong> please contact your administrator immediately.</p>
      
      <a href="${FRONTEND_URL}/login" class="button">Login to Your Account</a>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName || SYSTEM_NAME}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

export const ticketPurchaseTemplate = (data: { 
  firstName: string; 
  eventTitle: string; 
  ticketNumber: string; 
  amount: number; 
  currency: string;
  eventDate: string;
  eventEndDate: string;
  eventLocation: string;
  churchName?: string;
  viewUrl?: string;
}) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    ${getChurchHeader(data.churchName)}
    <div class="header">
      <h1>Ticket Confirmation</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName},</h2>
      <p>Your ticket has been purchased successfully!</p>
      
      <div class="info-box">
        <h3>Event Details</h3>
        <p><strong>Event:</strong> ${data.eventTitle}</p>
        <p><strong>Date:</strong> ${data.eventDate} - ${data.eventEndDate}</p>
        <p><strong>Location:</strong> ${data.eventLocation}</p>
        <p><strong>Ticket Number:</strong> ${data.ticketNumber}</p>
        <p><strong>Amount Paid:</strong> ${data.currency} ${data.amount.toLocaleString()}</p>
      </div>
      
      <p>Please present this ticket number at the event entrance.</p>
      
      <p>Your ticket and payment receipt are attached to this email.</p>
      
      <a href="${data.viewUrl || `${FRONTEND_URL}/dashboard/my-tickets`}" class="button">View My Tickets</a>
      
      <p>We look forward to seeing you at the event!</p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName || SYSTEM_NAME}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

export const donationReceiptTemplate = (data: {
  firstName: string;
  amount: number;
  currency: string;
  campaignName: string;
  reference: string;
  isAnonymous: boolean;
  isGuest?: boolean;
  churchName?: string;
}) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    ${getChurchHeader(data.churchName)}
    <div class="header">
      <h1>Donation Receipt</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName},</h2>
      <p>Thank you for your generous donation!</p>
      
      <div class="info-box">
        <h3>Donation Details</h3>
        <p><strong>Campaign:</strong> ${data.campaignName}</p>
        <p><strong>Amount:</strong> ${data.currency} ${data.amount.toLocaleString()}</p>
        <p><strong>Reference:</strong> ${data.reference}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
        ${data.isAnonymous ? '<p><strong>Status:</strong> Anonymous Donation</p>' : ''}
      </div>
      
      <p>Your contribution makes a difference in our community. May God bless you abundantly!</p>
      
      ${!data.isGuest ? `<a href="${FRONTEND_URL}/dashboard/donations" class="button">View Donation History</a>` : ''}
      
      <p style="font-style: italic; color: #6b7280;">"Each of you should give what you have decided in your heart to give, not reluctantly or under compulsion, for God loves a cheerful giver." - 2 Corinthians 9:7</p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName || SYSTEM_NAME}. All rights reserved.</p>
      <p>This is an official receipt for your records.</p>
    </div>
  </div>
</body>
</html>
`;

export const withdrawalRequestUserTemplate = (data: {
  firstName: string;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  method: string;
  withdrawalId: string;
  churchName?: string;
}) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    ${getChurchHeader(data.churchName)}
    <div class="header">
      <h1>Withdrawal Request Received</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName},</h2>
      <p>Your withdrawal request has been submitted successfully and is being processed.</p>
      
      <div class="info-box">
        <h3>Withdrawal Details</h3>
        <p><strong>Request ID:</strong> ${data.withdrawalId}</p>
        <p><strong>Amount:</strong> ${data.currency} ${data.amount.toLocaleString()}</p>
        <p><strong>Processing Fee:</strong> ${data.currency} ${data.fee.toLocaleString()}</p>
        <p><strong>Net Amount:</strong> ${data.currency} ${data.netAmount.toLocaleString()}</p>
        <p><strong>Method:</strong> ${data.method === 'mobile_money' ? 'Mobile Money' : 'Bank Transfer'}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
      </div>
      
      <p>Your funds will be transferred to your account once the request is approved and processed.</p>
      
      <a href="${FRONTEND_URL}/withdrawals" class="button">View Withdrawal Status</a>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName || SYSTEM_NAME}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

export const withdrawalRequestAdminTemplate = (data: {
  userName: string;
  userEmail: string;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  method: string;
  withdrawalId: string;
  mobileOperator?: string;
  mobileNumber?: string;
  bankCode?: string;
  accountName?: string;
  accountNumber?: string;
  churchName?: string;
}) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    ${getChurchHeader(data.churchName)}
    <div class="header">
      <h1>New Withdrawal Request</h1>
    </div>
    <div class="content">
      <h2>Withdrawal Request Notification</h2>
      <p>A new withdrawal request has been submitted and requires your attention.</p>
      
      <div class="info-box">
        <h3>Request Details</h3>
        <p><strong>Request ID:</strong> ${data.withdrawalId}</p>
        <p><strong>Requested By:</strong> ${data.userName} (${data.userEmail})</p>
        <p><strong>Amount:</strong> ${data.currency} ${data.amount.toLocaleString()}</p>
        <p><strong>Processing Fee:</strong> ${data.currency} ${data.fee.toLocaleString()}</p>
        <p><strong>Net Amount:</strong> ${data.currency} ${data.netAmount.toLocaleString()}</p>
        <p><strong>Method:</strong> ${data.method === 'mobile_money' ? 'Mobile Money' : 'Bank Transfer'}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
      </div>
      
      ${data.method === 'mobile_money' ? `
      <div class="info-box">
        <h3>Mobile Money Details</h3>
        <p><strong>Operator:</strong> ${data.mobileOperator === 'airtel' ? 'Airtel Money' : 'TNM Mpamba'}</p>
        <p><strong>Mobile Number:</strong> ${data.mobileNumber}</p>
      </div>
      ` : `
      <div class="info-box">
        <h3>Bank Transfer Details</h3>
        <p><strong>Bank Code:</strong> ${data.bankCode}</p>
        <p><strong>Account Name:</strong> ${data.accountName}</p>
        <p><strong>Account Number:</strong> ${data.accountNumber}</p>
      </div>
      `}
      
      <a href="${FRONTEND_URL}/withdrawals" class="button">Review Request</a>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName || SYSTEM_NAME}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

export const packageSubscriptionTemplate = (data: {
  firstName: string;
  packageName: string;
  amount: number;
  currency: string;
  billingCycle: string;
  expiresAt: string;
  features: string[];
  churchName?: string;
}) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    ${getChurchHeader(data.churchName)}
    <div class="header">
      <h1>Subscription Confirmed</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName},</h2>
      <p>Thank you for subscribing! Your ${data.packageName} package is now active.</p>
      
      <div class="info-box">
        <h3>Subscription Details</h3>
        <p><strong>Package:</strong> ${data.packageName}</p>
        <p><strong>Amount Paid:</strong> ${data.currency} ${data.amount.toLocaleString()}</p>
        <p><strong>Billing Cycle:</strong> ${data.billingCycle}</p>
        <p><strong>Expires On:</strong> ${data.expiresAt}</p>
      </div>
      
      <div class="info-box">
        <h3>Your Package Includes</h3>
        <ul style="margin: 0; padding-left: 20px;">
          ${data.features.map(f => `<li style="margin: 8px 0; color: #4b5563;">${f}</li>`).join('')}
        </ul>
      </div>
      
      <p>You now have full access to all features included in your package.</p>
      
      <a href="${FRONTEND_URL}/dashboard" class="button">Go to Dashboard</a>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName || SYSTEM_NAME}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

export const subscriptionExpiringTemplate = (data: {
  firstName: string;
  packageName: string;
  daysLeft: number;
  expiresAt: string;
  renewUrl: string;
}) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    <div class="header" style="background: #f59e0b;">
      <h1>Subscription Expiring Soon</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName},</h2>
      <p>Your <strong>${data.packageName}</strong> subscription will expire in <strong>${data.daysLeft} days</strong>.</p>
      
      <div class="info-box" style="background: #fef3c7; border-left-color: #f59e0b;">
        <p><strong>Expiration Date:</strong> ${data.expiresAt}</p>
        <p><strong>Package:</strong> ${data.packageName}</p>
      </div>
      
      <p>To continue enjoying uninterrupted access to all features, please renew your subscription before it expires.</p>
      
      <a href="${data.renewUrl}" class="button" style="background: #f59e0b;">Renew Subscription</a>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${SYSTEM_NAME}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

export const subscriptionExpiredTemplate = (data: {
  firstName: string;
  packageName: string;
  expiredAt: string;
  daysSinceExpiry: number;
  renewUrl: string;
}) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    <div class="header" style="background: #dc2626;">
      <h1>Subscription Expired</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName},</h2>
      <p>Your <strong>${data.packageName}</strong> subscription has expired.</p>
      
      <div class="info-box" style="background: #fee2e2; border-left-color: #dc2626;">
        <p><strong>Expired On:</strong> ${data.expiredAt}</p>
        <p><strong>Days Since Expiry:</strong> ${data.daysSinceExpiry}</p>
        <p><strong>Package:</strong> ${data.packageName}</p>
      </div>
      
      <p>Your access to premium features has been suspended. Renew now to restore full functionality.</p>
      
      <a href="${data.renewUrl}" class="button" style="background: #dc2626;">Renew Now</a>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${SYSTEM_NAME}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

export const memberWelcomeTemplate = (data: { firstName: string; lastName: string; email: string; churchName: string }) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    ${getChurchHeader(data.churchName)}
    <div class="header">
      <h1>Welcome to ${data.churchName}!</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName} ${data.lastName},</h2>
      <p>Welcome! Your membership account has been created successfully.</p>
      
      <div class="info-box">
        <h3>Your Account</h3>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Church:</strong> ${data.churchName}</p>
      </div>
      
      <p>You can now access your member dashboard to:</p>
      <ul style="padding-left: 20px;">
        <li style="margin: 8px 0; color: #4b5563;">View upcoming events and church activities</li>
        <li style="margin: 8px 0; color: #4b5563;">Make donations and contributions</li>
        <li style="margin: 8px 0; color: #4b5563;">Access church resources and announcements</li>
        <li style="margin: 8px 0; color: #4b5563;">Stay connected with your church community</li>
      </ul>
      
      <a href="${FRONTEND_URL}/login" class="button">Access Your Dashboard</a>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;
