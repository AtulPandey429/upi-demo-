require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');

// --- config ---
const PORT = Number(process.env.PORT) || 5000;
const publicBaseUrl = (
  process.env.PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  `http://localhost:${PORT}`
).replace(/\/$/, '');

const phonepe = {
  merchantId: process.env.PHONEPE_MERCHANT_ID || '',
  saltKey: process.env.PHONEPE_SALT_KEY || '',
  saltIndex: process.env.PHONEPE_SALT_INDEX || '1',
  defaultMobile: process.env.PHONEPE_DEFAULT_MOBILE || '9999999999',
  isProduction: process.env.PHONEPE_ENV === 'production',
  webhookUrl: `${publicBaseUrl}/api/webhooks/phonepe`,
  redirectUrl: `${publicBaseUrl}/api/phonepe/redirect`,
  apiBase: process.env.PHONEPE_ENV === 'production'
    ? 'https://api.phonepe.com/apis/hermes'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox',
};
phonepe.isConfigured = Boolean(phonepe.merchantId && phonepe.saltKey);

const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);

// --- in-memory store ---
const payments = new Map();
const payId = () => `txn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

// --- helpers ---
const log = (e, d) => process.env.PHONEPE_LOG !== 'false' && console.log(`[PhonePe] ${e}`, d ?? '');
const mapStatus = (c) => {
  const x = String(c || '').toUpperCase();
  if (x === 'PAYMENT_SUCCESS' || x === 'COMPLETED') return 'paid';
  if (x === 'PAYMENT_PENDING' || x === 'PENDING') return 'pending';
  return 'failed';
};
const isSuccess = (c) => ['PAYMENT_SUCCESS', 'COMPLETED'].includes(String(c || '').toUpperCase());
const appendQuery = (url, p) => {
  const u = new URL(url);
  Object.entries(p).forEach(([k, v]) => v != null && u.searchParams.set(k, String(v)));
  return u.toString();
};
const parseAmount = (body) => {
  if (body?.amountPaise >= 100) return Math.round(Number(body.amountPaise));
  if (body?.amount >= 1) return Math.round(Number(body.amount) * 100);
  return null;
};
const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;
const isValidUpi = (id) => UPI_RE.test(String(id || '').trim());
const phoneFromUpi = (upi) => {
  const user = String(upi || '').split('@')[0];
  return /^\d{10}$/.test(user) ? user : null;
};
const deviceOS = (platform, ua = '') => {
  const p = String(platform).toLowerCase(), u = ua.toLowerCase();
  if (p === 'ios' || /iphone|ipad/.test(u)) return 'IOS';
  if (p === 'android' || /android/.test(u)) return 'ANDROID';
  return null;
};

async function phonepePay(txnId, amountPaise, mobile, os) {
  const payload = {
    merchantId: phonepe.merchantId,
    merchantTransactionId: txnId,
    merchantUserId: `u_${Date.now()}`,
    amount: amountPaise,
    redirectUrl: phonepe.redirectUrl,
    redirectMode: 'POST',
    callbackUrl: phonepe.webhookUrl,
    mobileNumber: mobile,
    paymentInstrument: { type: 'PAY_PAGE' },
  };
  if (os) payload.deviceContext = { deviceOS: os };

  const req = Buffer.from(JSON.stringify(payload)).toString('base64');
  const ep = '/pg/v1/pay';
  const sig = crypto.createHash('sha256').update(req + ep + phonepe.saltKey).digest('hex') + '###' + phonepe.saltIndex;

  log('pay.request', payload);
  const { data } = await axios.post(phonepe.apiBase + ep, { request: req }, {
    headers: { 'Content-Type': 'application/json', 'X-VERIFY': sig },
  });
  log('pay.response', data);

  const url = data?.data?.instrumentResponse?.redirectInfo?.url;
  if (!url) throw Object.assign(new Error('No payment URL from PhonePe'), { phonepe: data });
  return url;
}

// --- express app ---
const app = express();
const isVercel = Boolean(process.env.VERCEL);
const dist = path.join(__dirname, isVercel ? 'public' : 'frontend/dist');

app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
if (!isVercel) app.use(express.static(dist));

app.post('/api/payments/initiate', async (req, res) => {
  try {
    if (!phonepe.isConfigured) {
      return res.status(503).json({ success: false, message: 'PhonePe keys missing in .env' });
    }
    const amountPaise = parseAmount(req.body);
    const { successUrl, failureUrl, customerPhone, customerName, upiId, description, platform } = req.body;
    if (!amountPaise) return res.status(400).json({ success: false, message: 'Invalid amount (min ₹1)' });
    if (!successUrl?.startsWith('http')) return res.status(400).json({ success: false, message: 'Valid successUrl required' });
    const name = String(customerName || '').trim();
    const upi = String(upiId || '').trim().toLowerCase();
    if (!name || name.length < 2) return res.status(400).json({ success: false, message: 'Valid name required' });
    if (!isValidUpi(upi)) return res.status(400).json({ success: false, message: 'Valid UPI ID required (e.g. name@paytm)' });

    const txnId = payId();
    payments.set(txnId, {
      transactionId: txnId,
      amountPaise,
      customerName: name,
      upiId: upi,
      successUrl,
      failureUrl: failureUrl || successUrl,
      status: 'created',
      provider: 'phonepe',
      providerOrderId: txnId,
      providerPaymentId: null,
      updatedAt: new Date().toISOString(),
    });

    const mobile = String(customerPhone || phoneFromUpi(upi) || phonepe.defaultMobile).replace(/\D/g, '').slice(-10);
    const payUrl = await phonepePay(txnId, amountPaise, mobile, deviceOS(platform, req.headers['user-agent']));

    const p = payments.get(txnId);
    p.status = 'pending';
    payments.set(txnId, p);

    res.json({
      success: true,
      transactionId: txnId,
      redirectUrl: payUrl,
      paymentLink: payUrl,
      amount: amountPaise,
      amountRupee: amountPaise / 100,
      customerName: name,
      upiId: upi,
      currency: 'INR',
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.response?.data?.message || e.message });
  }
});

app.get('/api/payments/status/:id', (req, res) => {
  const p = payments.get(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({
    success: true,
    ...p,
    amountRupee: p.amountPaise / 100,
  });
});

function webhook(req, res) {
  try {
    const sig = req.headers['x-verify'];
    const b64 = req.body?.response;
    if (!b64 || !sig) return res.status(400).json({ success: false });

    const hash = crypto.createHash('sha256').update(b64 + phonepe.saltKey).digest('hex') + '###' + phonepe.saltIndex;
    if (sig !== hash) return res.status(400).json({ success: false, message: 'Invalid signature' });

    const decoded = JSON.parse(Buffer.from(b64, 'base64').toString());
    const code = decoded.code || decoded.data?.state;
    const mtxn = decoded.data?.merchantTransactionId || decoded.merchantTransactionId;
    log('webhook', decoded);

    if (mtxn) {
      const p = [...payments.values()].find((x) => x.providerOrderId === mtxn);
      if (p && p.status !== 'paid') {
        p.status = mapStatus(code);
        p.providerPaymentId = decoded.data?.transactionId || decoded.transactionId;
        payments.set(p.transactionId, p);
      }
    }
    res.json({ success: true });
  } catch (e) {
    log('webhook.error', e.message);
    res.status(500).json({ success: false });
  }
}

function redirectQueryParams(p, payload, ok) {
  return {
    status: ok ? 'success' : 'failed',
    transactionId: p.transactionId,
    code: payload.code,
    amount: (p.amountPaise / 100).toFixed(2),
    name: p.customerName,
    upi: p.upiId,
  };
}

function redirect(req, res) {
  const payload = { ...req.query, ...req.body };
  log('redirect', payload);
  const mtxn = payload.merchantTransactionId || payload.transactionId;
  const p = mtxn ? payments.get(mtxn) || [...payments.values()].find((x) => x.providerOrderId === mtxn) : null;

  if (!p) {
    return res.redirect(appendQuery(`${publicBaseUrl}/`, {
      status: isSuccess(payload.code) ? 'success' : 'failed',
      code: payload.code,
      ...(mtxn && { transactionId: mtxn }),
    }));
  }

  const st = mapStatus(payload.code);
  if (p.status !== 'paid') { p.status = st; payments.set(p.transactionId, p); }
  const ok = st === 'paid' || isSuccess(payload.code);
  res.redirect(appendQuery(ok ? p.successUrl : p.failureUrl, redirectQueryParams(p, payload, ok)));
}

app.post('/api/webhooks/phonepe', webhook);
app.post('/api/phonepe-callback', webhook);
app.post('/api/phonepe/redirect', redirect);
app.get('/api/phonepe/redirect', redirect);

app.get('/health', (_req, res) => {
  res.json({ ok: true, configured: phonepe.isConfigured, webhook: phonepe.webhookUrl, redirect: phonepe.redirectUrl });
});

if (!isVercel) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server: ${publicBaseUrl}`);
    console.log(`Webhook: ${phonepe.webhookUrl}`);
    if (!phonepe.isConfigured) console.warn('Set PHONEPE_MERCHANT_ID and PHONEPE_SALT_KEY in .env');
  });
}

module.exports = app;
