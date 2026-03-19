#!/usr/bin/env node
/**
 * register-mpesa-urls.js
 *
 * Registers the CallbackURL and ValidationURL/ConfirmationURL with Safaricom Daraja.
 *
 * Usage:
 *   node scripts/register-mpesa-urls.js
 *
 * Requires these env vars (loaded from .env automatically):
 *   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE,
 *   MPESA_CALLBACK_URL, MPESA_ENV, BACKEND_URL
 */

require('dotenv').config();
const https = require('https');

const {
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_SHORTCODE,
  MPESA_CALLBACK_URL,
  MPESA_ENV,
  BACKEND_URL,
} = process.env;

// ── Validate required env vars ────────────────────────────────────────────────
const missing = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_CALLBACK_URL', 'BACKEND_URL']
  .filter(k => !process.env[k]);

if (missing.length) {
  console.error('❌  Missing required env vars:', missing.join(', '));
  process.exit(1);
}

const BASE_URL = MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// ── Helpers ───────────────────────────────────────────────────────────────────
function request(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getToken() {
  const credentials = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await request('GET', '/oauth/v1/generate?grant_type=client_credentials', null, {
    Authorization: `Basic ${credentials}`,
  });
  if (!res.body.access_token) {
    throw new Error(`Token fetch failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.access_token;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔧  Environment : ${MPESA_ENV || 'sandbox'}`);
  console.log(`🔧  Base URL    : ${BASE_URL}`);
  console.log(`🔧  Shortcode   : ${MPESA_SHORTCODE}`);
  console.log(`🔧  Callback URL: ${MPESA_CALLBACK_URL}\n`);

  // 1. Get access token
  console.log('1️⃣   Fetching access token...');
  const token = await getToken();
  console.log('✅  Token obtained\n');

  // 2. Register C2B URLs (ValidationURL + ConfirmationURL)
  //    These are used for Paybill/Till confirmation flows.
  const confirmationUrl = `${BACKEND_URL}/api/webhooks/mpesa/callback`;
  const validationUrl   = `${BACKEND_URL}/api/webhooks/mpesa/callback`;

  console.log('2️⃣   Registering C2B URLs...');
  console.log(`    ConfirmationURL : ${confirmationUrl}`);
  console.log(`    ValidationURL   : ${validationUrl}`);

  const c2bRes = await request(
    'POST',
    '/mpesa/c2b/v1/registerurl',
    {
      ShortCode:       MPESA_SHORTCODE,
      ResponseType:    'Completed',       // Completed | Cancelled
      ConfirmationURL: confirmationUrl,
      ValidationURL:   validationUrl,
    },
    { Authorization: `Bearer ${token}` }
  );

  if (c2bRes.status === 200 && c2bRes.body.ResponseCode === '0') {
    console.log('✅  C2B URLs registered successfully');
    console.log('    Response:', JSON.stringify(c2bRes.body, null, 2));
  } else {
    console.warn('⚠️   C2B registration response (may be OK on sandbox):');
    console.warn('    Status :', c2bRes.status);
    console.warn('    Body   :', JSON.stringify(c2bRes.body, null, 2));
  }

  // 3. Verify STK Push callback URL is set (informational — it is passed per-request)
  console.log('\n3️⃣   STK Push callback URL (set per-request, no registration needed):');
  console.log(`    ${MPESA_CALLBACK_URL}`);
  console.log('✅  No action required — this is sent in each STK Push payload.\n');

  console.log('🎉  Done.\n');
}

main().catch(err => {
  console.error('❌  Fatal error:', err.message);
  process.exit(1);
});
