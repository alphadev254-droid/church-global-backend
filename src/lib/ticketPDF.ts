// Ticket PDF generation using Puppeteer
// Install: npm install puppeteer

import puppeteer from 'puppeteer';

export async function generateTicketPDF(ticketData: {
  ticketNumber: string;
  eventTitle: string;
  eventDate: string;
  eventEndDate: string;
  eventLocation: string;
  attendeeName: string;
  churchName: string;
  amount: number;
  currency: string;
}): Promise<Buffer> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
    .ticket { background: white; max-width: 600px; margin: 0 auto; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; border-bottom: 4px solid #d4a574; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header p { font-size: 16px; opacity: 0.9; }
    .content { padding: 40px; }
    .ticket-number { background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; border: 2px dashed #d4a574; }
    .ticket-number h2 { color: #1e3a8a; font-size: 32px; letter-spacing: 2px; }
    .ticket-number p { color: #6b7280; font-size: 14px; margin-top: 8px; }
    .details { margin: 30px 0; }
    .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-label { color: #6b7280; font-weight: 600; }
    .detail-value { color: #111827; font-weight: 500; }
    .qr-placeholder { text-align: center; padding: 20px; background: #f9fafb; border-radius: 8px; margin: 20px 0; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="header">
      <h1>${ticketData.churchName}</h1>
      <p>Event Ticket</p>
    </div>
    <div class="content">
      <h2 style="color: #111827; margin-bottom: 20px; text-align: center;">${ticketData.eventTitle}</h2>
      
      <div class="ticket-number">
        <h2>${ticketData.ticketNumber}</h2>
        <p>Ticket Number</p>
      </div>
      
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Attendee</span>
          <span class="detail-value">${ticketData.attendeeName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Event Date</span>
          <span class="detail-value">${ticketData.eventDate} - ${ticketData.eventEndDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Location</span>
          <span class="detail-value">${ticketData.eventLocation}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Amount Paid</span>
          <span class="detail-value">${ticketData.currency} ${ticketData.amount.toLocaleString()}</span>
        </div>
      </div>
      
      <div class="qr-placeholder">
        <p style="color: #6b7280;">Present this ticket at the event entrance</p>
      </div>
    </div>
    <div class="footer">
      <p>This is your official event ticket</p>
      <p>&copy; ${new Date().getFullYear()} ${ticketData.churchName}</p>
    </div>
  </div>
</body>
</html>
  `;

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html);
  const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  
  return Buffer.from(pdfBuffer);
}
