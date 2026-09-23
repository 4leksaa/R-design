'use strict';
/**
 * All configuration comes from environment variables (or a local .env file).
 * Secrets (Stripe, email, session secret) are only ever read here, on the server.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;
const toBool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const toInt = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const toNum = (v, d) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

const PORT = toInt(env.PORT, 3000);
const PUBLIC_URL = (env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const DATA_DIR = path.resolve(ROOT, env.DATA_DIR || 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true, mode: 0o700 });

function resolveSecret() {
  if (env.SECRET_KEY && env.SECRET_KEY.length >= 24) return env.SECRET_KEY;
  // Fallback for local development: generate once and keep it next to the database.
  const file = path.join(DATA_DIR, '.secret_key');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 24) return existing;
  } catch (_) { /* generate below */ }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

/** "SE:99,DK:149" (major units) -> { SE: 9900, DK: 14900 } (minor units) */
function parseRates(str) {
  const out = {};
  for (const part of String(str || '').split(',')) {
    const [code, value] = part.split(':').map((s) => s.trim());
    if (!code || value === undefined) continue;
    const n = parseFloat(value);
    if (Number.isFinite(n) && n >= 0) out[code.toUpperCase()] = Math.round(n * 100);
  }
  return out;
}

const currency = (env.STORE_CURRENCY || 'SEK').toUpperCase();

module.exports = {
  ROOT,
  publicDir: path.join(ROOT, 'public'),
  dataDir: DATA_DIR,
  uploadDir: path.join(DATA_DIR, 'uploads'),
  dbFile: path.join(DATA_DIR, 'shop.sqlite'),

  port: PORT,
  publicUrl: PUBLIC_URL,
  isProd: env.NODE_ENV === 'production',
  trustProxy: toBool(env.TRUST_PROXY, false),
  secureCookies: toBool(env.COOKIE_SECURE, PUBLIC_URL.startsWith('https://')),
  secretKey: resolveSecret(),
  secretFromEnv: !!(env.SECRET_KEY && env.SECRET_KEY.length >= 24),

  shopName: env.SHOP_NAME || 'Rasch & Q Design',
  shopAddress: env.SHOP_ADDRESS || 'Föreningsgatan 5, 211 44 Malmö',
  currency,
  shippingRates: parseRates(env.SHIPPING_RATES || 'SE:99,DK:149,NO:199,FI:149,DE:199'),
  freeShippingOver: Math.round(toNum(env.FREE_SHIPPING_OVER, 0) * 100),
  maxQtyPerLine: Math.max(1, toInt(env.MAX_QTY_PER_LINE, 10)),
  lowStockThreshold: toInt(env.LOW_STOCK_THRESHOLD, 2),
  checkoutRateLimit: toInt(env.CHECKOUT_RATE_LIMIT, 30), // checkout attempts per IP per 10 minutes

  stripeSecretKey: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  stripeApiBase: (env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, ''),
  stripeSessionMinutes: Math.max(30, toInt(env.STRIPE_SESSION_MINUTES, 31)),

  resendApiKey: env.RESEND_API_KEY || '',
  resendApiBase: (env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, ''),
  mailFrom: env.MAIL_FROM || '',
  orderNotifyEmail: env.ORDER_NOTIFY_EMAIL || '',

  manualPaymentInstructions: {
    sv: env.MANUAL_PAYMENT_INSTRUCTIONS_SV ||
      'Vi återkommer via e-post med betalningsinstruktioner. Beställningen är reserverad åt dig under tiden.',
    en: env.MANUAL_PAYMENT_INSTRUCTIONS_EN ||
      'We will email you payment instructions. Your order is reserved for you in the meantime.',
  },

  unpaidOrderTtlMinutes: toNum(env.UNPAID_ORDER_TTL_MINUTES, 45),
  sweepIntervalSeconds: toInt(env.SWEEP_INTERVAL_SECONDS, 60),
};
