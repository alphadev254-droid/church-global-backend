import puppeteer from 'puppeteer';

export async function generateReceiptPDF(receiptData: {
  receiptNumber: string;
  type: 'package_subscription' | 'donation' | 'event_ticket';
  customerName: string;
  customerEmail: string;
  amount: number;
  currency: string;
  paidAt: string;
  paymentMethod: string;
  description: string;
  itemDetails?: { label: string; value: string }[];
}): Promise<Buffer> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
    .receipt { background: white; max-width: 700px; margin: 0 auto; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 40px; text-align: center; }
    .header h1 { font-size: 32px; margin-bottom: 8px; }
    .header p { font-size: 16px; opacity: 0.9; }
    .receipt-badge { background: #10b981; color: white; display: inline-block; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 600; margin-top: 15px; }
    .content { padding: 40px; }
    .receipt-number { text-align: center; padding: 20px; background: #f9fafb; border-radius: 8px; margin-bottom: 30px; border: 2px dashed #d4a574; }
    .receipt-number h2 { color: #1e3a8a; font-size: 24px; letter-spacing: 1px; }
    .receipt-number p { color: #6b7280; font-size: 12px; margin-top: 5px; }
    .amount-section { text-align: center; padding: 30px; background: #f3f4f6; border-radius: 8px; margin: 20px 0; }
    .amount-section .label { color: #6b7280; font-size: 14px; margin-bottom: 8px; }
    .amount-section .amount { color: #1e3a8a; font-size: 42px; font-weight: bold; }
    .details { margin: 30px 0; }
    .detail-row { display: flex; justify-content: space-between; padding: 15px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-label { color: #6b7280; font-weight: 600; font-size: 14px; }
    .detail-value { color: #111827; font-weight: 500; text-align: right; max-width: 60%; }
    .footer { background: #f9fafb; padding: 30px; text-align: center; color: #6b7280; font-size: 12px; border-top: 2px solid #e5e7eb; }
    .footer p { margin: 5px 0; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>PAYMENT RECEIPT</h1>
      <p>ICIMS - Integrated Church Information Management System</p>
      <div class="receipt-badge">PAID</div>
    </div>
    
    <div class="content">
      <div class="receipt-number">
        <h2>${receiptData.receiptNumber}</h2>
        <p>Receipt Number</p>
      </div>
      
      <div class="amount-section">
        <div class="label">Amount Paid</div>
        <div class="amount">${receiptData.currency} ${receiptData.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </div>
      
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Customer Name</span>
          <span class="detail-value">${receiptData.customerName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Email</span>
          <span class="detail-value">${receiptData.customerEmail}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Payment Date</span>
          <span class="detail-value">${receiptData.paidAt}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Payment Method</span>
          <span class="detail-value">${receiptData.paymentMethod}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Description</span>
          <span class="detail-value">${receiptData.description}</span>
        </div>
        ${receiptData.itemDetails?.map(item => `
        <div class="detail-row">
          <span class="detail-label">${item.label}</span>
          <span class="detail-value">${item.value}</span>
        </div>
        `).join('') || ''}
      </div>
    </div>
    
    <div class="footer">
      <p><strong>Thank you for your payment!</strong></p>
      <p>This is an official receipt for your transaction</p>
      <p>For any queries, please contact support@icims.org</p>
      <p>&copy; ${new Date().getFullYear()} ICIMS. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html);
  const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  
  return Buffer.from(pdfBuffer);
}
