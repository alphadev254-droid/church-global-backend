const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

const getBaseStyle = () => `
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; background-color: #f9fafb; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .church-header { background: white; color: #1e3a8a; padding: 20px 24px; text-align: center; border-bottom: 4px solid #d4a574; }
    .church-header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
    .header { background: #d4a574; color: white; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .content { padding: 32px 24px; }
    .content h2 { margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #111827; }
    .content p { margin: 0 0 16px 0; color: #4b5563; }
    .button { display: inline-block; background: #d4a574; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0; font-weight: 500; }
    .info-box { background: #f3f4f6; padding: 20px; border-radius: 6px; border-left: 4px solid #d4a574; margin: 20px 0; }
    .info-box h3 { margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: #111827; }
    .info-box p { margin: 8px 0; color: #4b5563; font-size: 14px; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
  </style>
`;

export const teamMemberAddedTemplate = (data: {
  firstName: string;
  teamName: string;
  churchName: string;
  addedBy: string;
}) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    <div class="church-header">
      <h1>${data.churchName}</h1>
    </div>
    <div class="header">
      <h1>Added to Team</h1>
    </div>
    <div class="content">
      <h2>Hello ${data.firstName},</h2>
      <p>You have been added to a team!</p>
      
      <div class="info-box">
        <h3>Team Details</h3>
        <p><strong>Team:</strong> ${data.teamName}</p>
        <p><strong>Added By:</strong> ${data.addedBy}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
      </div>
      
      <p>You can now view team communications and participate in team activities.</p>
      
      <a href="${FRONTEND_URL}/dashboard/communication" class="button">View Team</a>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName}</p>
    </div>
  </div>
</body>
</html>
`;

export const teamLeaderAppointedTemplate = (data: {
  firstName: string;
  teamName: string;
  churchName: string;
  appointedBy: string;
}) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    <div class="church-header">
      <h1>${data.churchName}</h1>
    </div>
    <div class="header">
      <h1>Team Leader Appointment</h1>
    </div>
    <div class="content">
      <h2>Congratulations ${data.firstName}!</h2>
      <p>You have been appointed as a leader of <strong>${data.teamName}</strong>.</p>
      
      <div class="info-box">
        <h3>Leadership Details</h3>
        <p><strong>Team:</strong> ${data.teamName}</p>
        <p><strong>Appointed By:</strong> ${data.appointedBy}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
      </div>
      
      <p>As a team leader, you can now:</p>
      <ul style="padding-left: 20px; color: #4b5563;">
        <li>Post communications to the team</li>
        <li>Manage team posts and content</li>
        <li>Lead and coordinate team activities</li>
      </ul>
      
      <a href="${FRONTEND_URL}/dashboard/communication" class="button">Go to Team</a>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName}</p>
    </div>
  </div>
</body>
</html>
`;

export const teamCommunicationNotificationTemplate = (data: {
  firstName: string;
  teamName: string;
  churchName: string;
  postTitle: string;
  postContent: string;
  authorName: string;
}) => `
<!DOCTYPE html>
<html>
<head>${getBaseStyle()}</head>
<body>
  <div class="container">
    <div class="church-header">
      <h1>${data.churchName}</h1>
    </div>
    <div class="header">
      <h1>New Team Communication</h1>
    </div>
    <div class="content">
      <h2>Hello Team,</h2>
      <p>A new communication has been posted to <strong>${data.teamName}</strong>.</p>
      
      <div class="info-box">
        <h3>${data.postTitle}</h3>
        <p style="white-space: pre-wrap;">${data.postContent.substring(0, 200)}${data.postContent.length > 200 ? '...' : ''}</p>
        <p style="margin-top: 12px;"><strong>Posted by:</strong> ${data.authorName}</p>
      </div>
      
      <p>Log in to view the full communication and any attachments.</p>
      
      <a href="${FRONTEND_URL}/dashboard/communication" class="button">View Communication</a>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${data.churchName}</p>
    </div>
  </div>
</body>
</html>
`;
