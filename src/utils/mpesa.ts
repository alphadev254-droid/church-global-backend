import axios from 'axios';

const MPESA_CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY!;
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET!;
const MPESA_SHORTCODE       = process.env.MPESA_SHORTCODE!;
const MPESA_PASSKEY         = process.env.MPESA_PASSKEY!;
const MPESA_CALLBACK_URL    = process.env.MPESA_CALLBACK_URL!;
const MPESA_ENV             = process.env.MPESA_ENV || 'sandbox';

const BASE_URL = MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// ─── Token cache ──────────────────────────────────────────────────────────────
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function getMpesaToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const credentials = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
  let response: any;
  try {
    response = await axios.get(
      `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${credentials}` } }
    );
  } catch (err: any) {
    throw new Error(`M-Pesa token fetch failed: ${err.response?.data?.errorMessage || err.message}`);
  }

  cachedToken = response.data.access_token as string;
  if (!cachedToken) throw new Error('Failed to retrieve M-Pesa access token');
  // expires_in is in seconds, subtract 60s buffer
  tokenExpiresAt = Date.now() + (parseInt(response.data.expires_in) - 60) * 1000;
  return cachedToken;
}

// ─── Phone normalizer: 07xx / 2547xx / +2547xx → 2547xxxxxxxx ────────────────
export function formatMpesaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0'))   return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  throw new Error(`Invalid Kenyan phone number: ${phone}`);
}

// ─── STK Push query — verify transaction status with Daraja ─────────────────
export async function verifyMpesaTransaction(
  checkoutRequestId: string
): Promise<{ resultCode: string; resultDesc: string; isSuccess: boolean }> {
  const token     = await getMpesaToken();
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password  = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');

  let response: any;
  try {
    response = await axios.post(
      `${BASE_URL}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: MPESA_SHORTCODE,
        Password:          password,
        Timestamp:         timestamp,
        CheckoutRequestID: checkoutRequestId,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch (err: any) {
    throw new Error(`STK query failed: ${err.response?.data?.errorMessage || err.message}`);
  }

  const data = response.data;
  const resultCode = String(data.ResultCode ?? data.ResponseCode ?? '1');
  const resultDesc = data.ResultDesc || data.ResponseDescription || 'Unknown';
  return { resultCode, resultDesc, isSuccess: resultCode === '0' };
}

// ─── STK Push ─────────────────────────────────────────────────────────────────
export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
}

export async function initiateStkPush(
  phone: string,
  amount: number,
  accountRef: string,
  description: string
): Promise<StkPushResult> {
  if (amount <= 0) throw new Error('Amount must be greater than 0');
  const roundedAmount = Math.round(amount);

  const token     = await getMpesaToken();
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password  = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
  const formattedPhone = formatMpesaPhone(phone);

  const payload = {
    BusinessShortCode: MPESA_SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            roundedAmount,
    PartyA:            formattedPhone,
    PartyB:            MPESA_SHORTCODE,
    PhoneNumber:       formattedPhone,
    CallBackURL:       MPESA_CALLBACK_URL,
    AccountReference:  accountRef.substring(0, 12),
    TransactionDesc:   description.substring(0, 12),
  };

  let response: any;
  try {
    response = await axios.post(
      `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch (err: any) {
    throw new Error(`STK Push request failed: ${err.response?.data?.errorMessage || err.message}`);
  }

  const data = response.data;
  if (data.ResponseCode !== '0') {
    throw new Error(data.ResponseDescription || 'STK push failed');
  }

  return {
    checkoutRequestId:   data.CheckoutRequestID,
    merchantRequestId:   data.MerchantRequestID,
    responseCode:        data.ResponseCode,
    responseDescription: data.ResponseDescription,
    customerMessage:     data.CustomerMessage,
  };
}
