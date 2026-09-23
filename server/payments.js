'use strict';
/**
 * Stripe Checkout integration using Stripe's REST API directly (no SDK, no card data ever touches this server).
 *
 * Flow:
 *   1. /api/checkout saves the order (unpaid) + reserves stock, then creates a Stripe Checkout Session
 *      whose line items are built from OUR database prices.
 *   2. The customer pays on Stripe's hosted page.
 *   3. Stripe calls /api/webhooks/stripe (signature verified). Only then is the order marked "paid".
 *      If the webhook is late, the confirmation page asks Stripe directly (server to server) for the session state.
 *
 * If STRIPE_SECRET_KEY is not set, payment.enabled() is false and the shop runs in "manual payment" mode:
 * orders are saved as unpaid and the owner confirms payment in the admin. Nothing else has to change
 * when Stripe is connected later.
 */
const crypto = require('crypto');
const cfg = require('./config');
const orders = require('./orders');
const mailer = require('./mailer');
const { db, now } = require('./db');
const { AppError, safeEqual, log } = require('./util');

const enabled = () => !!cfg.stripeSecretKey;

/** Stripe wants form-encoded bodies with bracket notation: a[b][0][c]=1 */
function encodeForm(obj, prefix, out) {
  out = out || [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? encodeForm(item, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`)));
    else if (typeof v === 'object') encodeForm(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

async function stripe(method, path, form, idempotencyKey) {
  const headers = { Authorization: `Bearer ${cfg.stripeSecretKey}` };
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encodeForm(form);
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let res;
  try {
    res = await fetch(cfg.stripeApiBase + path, { method, headers, body, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new AppError(502, 'PAYMENT_UNAVAILABLE', 'Could not reach the payment provider');
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* non-JSON error */ }
  if (!res.ok) {
    log('error', 'stripe_error', { path, status: res.status, type: data && data.error && data.error.type, code: data && data.error && data.error.code });
    const e = new AppError(502, 'PAYMENT_UNAVAILABLE', 'The payment provider rejected the request');
    e.stripeStatus = res.status;
    throw e;
  }
  return data;
}

/** Creates the hosted payment page. Amounts come from the saved order, which was priced on the server. */
async function createCheckoutSession(order) {
  const items = orders.loadItems(order.id);
  const en = order.language === 'en';
  const currency = order.currency.toLowerCase();

  const lineItems = items.map((i) => {
    const name = (en && i.product_name_en) || i.product_name;
    const variant = (en && i.variant_label_en) || i.variant_label;
    return {
      quantity: i.quantity,
      price_data: { currency, unit_amount: i.unit_price, product_data: { name: variant ? `${name} (${variant})` : name } },
    };
  });
  if (order.shipping_cost > 0) {
    lineItems.push({
      quantity: 1,
      price_data: { currency, unit_amount: order.shipping_cost, product_data: { name: en ? 'Shipping' : 'Frakt' } },
    });
  }

  const token = orders.orderToken(order.order_number);
  const session = await stripe('POST', '/v1/checkout/sessions', {
    mode: 'payment',
    line_items: lineItems,
    customer_email: order.customer_email,
    client_reference_id: order.order_number,
    locale: en ? 'en' : 'sv',
    expires_at: Math.floor(Date.now() / 1000) + cfg.stripeSessionMinutes * 60,
    success_url: `${cfg.publicUrl}/bekraftelse.html?order=${encodeURIComponent(order.order_number)}&t=${encodeURIComponent(token)}`,
    cancel_url: `${cfg.publicUrl}/kassa.html?cancelled=1`,
    metadata: { order_number: order.order_number, order_id: String(order.id) },
    payment_intent_data: { metadata: { order_number: order.order_number } },
  }, `mwc-order-${order.id}-${order.order_number}`);

  orders.attachPayment(order.id, { reference: session.id });
  return session;
}

const retrieveSession = (id) => stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);

/**
 * Closes the customer's payment page so they can no longer pay for an order we are about to release.
 * Returns 'expired' (safe to release), 'complete' (they already paid: do not release) or throws.
 */
async function closeSession(order) {
  if (!order.payment_reference) return 'expired';
  const s = await retrieveSession(order.payment_reference);
  if (s.status === 'complete') return 'complete';
  if (s.status === 'expired') return 'expired';
  try {
    await stripe('POST', `/v1/checkout/sessions/${encodeURIComponent(order.payment_reference)}/expire`, {});
    return 'expired';
  } catch (err) {
    // Lost a race with the customer paying? Look again before deciding.
    const again = await retrieveSession(order.payment_reference);
    if (again.status === 'complete') return 'complete';
    if (again.status === 'expired') return 'expired';
    throw err;
  }
}

/* ---------------------------------------------------------------- results */

function applyPaid(orderId, session, source) {
  const result = orders.markPaid(orderId, {
    amountTotal: session.amount_total,
    currency: session.currency,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
    source,
  });
  if (result.changed) mailer.onPaid(result.order);
  if (result.mismatch) log('error', 'payment_amount_mismatch', { order: result.order.order_number });
  return result;
}

/**
 * Asks Stripe directly what happened to an unpaid order. Used when the customer lands on the
 * confirmation page before the webhook arrived (or if a webhook was missed).
 * Returns the fresh order row, or null if the order was released.
 */
async function reconcile(order) {
  if (order.payment_provider !== 'stripe' || order.payment_status !== 'unpaid' || !order.payment_reference) return order;
  const s = await retrieveSession(order.payment_reference);
  if (s.payment_status === 'paid') {
    applyPaid(order.id, s, 'stripe');
  } else if (s.status === 'expired') {
    orders.voidUnpaid(order.id);
    return null;
  }
  return orders.getById(order.id);
}

/* ---------------------------------------------------------------- webhook */

function verifyWebhook(rawBody, header) {
  if (!cfg.stripeWebhookSecret) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook secret not configured');
  const parts = String(header || '').split(',').map((p) => p.trim().split('='));
  const t = (parts.find((p) => p[0] === 't') || [])[1];
  const sigs = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || sigs.length === 0) throw new AppError(400, 'BAD_SIGNATURE', 'Invalid signature');
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new AppError(400, 'BAD_SIGNATURE', 'Timestamp outside tolerance');
  const expected = crypto.createHmac('sha256', cfg.stripeWebhookSecret).update(`${t}.`).update(rawBody).digest('hex');
  if (!sigs.some((s) => safeEqual(s, expected))) throw new AppError(400, 'BAD_SIGNATURE', 'Invalid signature');
  try { return JSON.parse(rawBody.toString('utf8')); } catch (_) { throw new AppError(400, 'BAD_JSON', 'Invalid payload'); }
}

async function handleEvent(event) {
  if (db.prepare('SELECT 1 FROM webhook_events WHERE id = ?').get(event.id)) return; // already handled

  const obj = event.data && event.data.object;
  const order = obj && obj.id ? orders.getByPaymentReference(obj.id) : null;

  if (!order) {
    // e.g. an expired session for an order we already released. Nothing to do.
    log('info', 'webhook_no_order', { type: event.type });
  } else {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (obj.payment_status === 'paid') applyPaid(order.id, obj, 'stripe');
        // payment_status "unpaid" on completed = delayed payment method; wait for async_payment_succeeded/failed
        break;
      case 'checkout.session.async_payment_failed': {
        const r = orders.failPayment(order.id, 'stripe', 'Delayed payment failed');
        if (r.changed) mailer.onPaymentFailed(r.order);
        break;
      }
      case 'checkout.session.expired':
        if (order.payment_status === 'unpaid') orders.voidUnpaid(order.id);
        break;
      default:
        break;
    }
  }
  db.prepare('INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?,?,?)').run(event.id, event.type, now());
}

module.exports = { enabled, createCheckoutSession, retrieveSession, closeSession, reconcile, verifyWebhook, handleEvent };
