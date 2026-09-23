'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const catalog = require('./catalog');
const orders = require('./orders');
const payments = require('./payments');
const mailer = require('./mailer');
const auth = require('./auth');
const { validateCustomer, countryList } = require('./validation');
const {
  AppError, sendJson, readBody, parseJson, clientIp, rateLimit, rateLimitPeek, rateLimitReset, log,
} = require('./util');

const routes = [];
const route = (method, pattern, opts, handler) => {
  const names = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
  routes.push({ method, re, names, opts: opts || {}, handler });
};

const SAFE = ['GET', 'HEAD', 'OPTIONS'];

/** Reject cross-site browser requests that try to change data. */
function checkOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) throw new AppError(403, 'CROSS_SITE', 'Cross-site request blocked');
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch (_) { throw new AppError(403, 'CROSS_SITE', 'Cross-site request blocked'); }
    if (host !== req.headers.host && host !== new URL(cfg.publicUrl).host) throw new AppError(403, 'CROSS_SITE', 'Cross-site request blocked');
  }
}

async function dispatch(req, res, url) {
  const pathname = url.pathname;
  let pathMatched = false;
  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== req.method) continue;

    const ctx = {
      req, res, url, ip: clientIp(req),
      query: Object.fromEntries(url.searchParams),
      params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])),
    };
    const writes = !SAFE.includes(req.method);
    if (writes && !r.opts.webhook) checkOrigin(req);
    if (r.opts.admin) ctx.session = auth.requireAdmin(req);
    if (r.opts.raw) ctx.raw = await readBody(req, r.opts.limit || 1_000_000);
    else if (writes) ctx.body = parseJson(await readBody(req, r.opts.limit || 100_000));

    const out = await r.handler(ctx);
    if (Array.isArray(out)) sendJson(res, out[0], out[1], out[2]);
    else sendJson(res, 200, out === undefined ? { ok: true } : out);
    return true;
  }
  if (pathMatched) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  throw new AppError(404, 'NOT_FOUND', 'Not found');
}

const intParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(404, 'NOT_FOUND', 'Not found');
  return n;
};

/* ============================================================ public shop */

route('GET', '/api/config', {}, () => ({
  shop_name: cfg.shopName,
  currency: cfg.currency,
  countries: countryList(),
  free_shipping_over: cfg.freeShippingOver,
  max_qty_per_line: cfg.maxQtyPerLine,
  payment_mode: payments.enabled() ? 'stripe' : 'manual',
  manual_payment_instructions: cfg.manualPaymentInstructions,
}));

route('GET', '/api/products', {}, () => ({ products: catalog.listActive().map(catalog.toPublic) }));

route('GET', '/api/products/:slug', {}, ({ params }) => {
  const p = /^\d+$/.test(params.slug) ? catalog.getById(Number(params.slug)) : catalog.getBySlug(params.slug);
  if (!p || !p.active) throw new AppError(404, 'NOT_FOUND', 'Product not found');
  return { product: catalog.toPublic(p) };
});

/** Prices the cart from the database (the browser's numbers are never used). */
route('POST', '/api/cart/quote', {}, ({ body, ip }) => {
  const rl = rateLimit(`quote:${ip}`, 120, 60_000);
  if (rl.limited) throw new AppError(429, 'RATE_LIMITED', 'Too many requests');
  const country = String(body.country || Object.keys(cfg.shippingRates)[0] || '').toUpperCase();
  if (Array.isArray(body.items) && body.items.length === 0) {
    return { currency: cfg.currency, country, lines: [], issues: [], subtotal: 0, shipping: orders.shippingCost(country, 0), total: 0, ok: false };
  }
  return orders.priceCart(body.items, country);
});

const inflight = new Map(); // idempotency key -> Promise, so simultaneous duplicates share one result

async function processCheckout({ customer, items, key, language }) {
  const provider = payments.enabled() ? 'stripe' : 'manual';
  const { order, duplicate } = orders.createOrder({ customer, items, idempotencyKey: key, language, provider });
  const token = orders.orderToken(order.order_number);
  const placed = { order_number: order.order_number, token, status: 'placed' };

  if (order.payment_provider !== 'stripe') {
    if (!duplicate) mailer.onManualOrderPlaced(order);
    return placed;
  }
  if (order.payment_status === 'paid') return placed;
  if (order.order_status === 'cancelled') throw new AppError(409, 'ORDER_CLOSED', 'This checkout is no longer active');

  if (order.payment_reference) {
    // Same attempt submitted again: hand back the existing payment page instead of creating another.
    const s = await payments.retrieveSession(order.payment_reference);
    if (s.status === 'open' && s.url) return { ...placed, status: 'redirect', redirect_url: s.url };
    if (s.payment_status === 'paid') { await payments.reconcile(order); return placed; }
    throw new AppError(409, 'SESSION_EXPIRED', 'The payment page has expired');
  }

  try {
    const session = await payments.createCheckoutSession(order);
    return { ...placed, status: 'redirect', redirect_url: session.url };
  } catch (err) {
    // Payment page could not be created: remove the order and give the stock back. No partial order remains.
    orders.voidUnpaid(order.id);
    log('error', 'checkout_session_failed', { code: err.code });
    throw err instanceof AppError ? err : new AppError(502, 'PAYMENT_UNAVAILABLE', 'Payment is temporarily unavailable');
  }
}

route('POST', '/api/checkout', {}, async ({ body, ip }) => {
  const rl = rateLimit(`checkout:${ip}`, cfg.checkoutRateLimit, 10 * 60_000);
  if (rl.limited) throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes.');

  const { values, errors } = validateCustomer({ ...(body.customer || {}), ...(body.shipping || {}) });
  if (body.accept_terms !== true) errors.accept_terms = 'required';
  const key = String(body.idempotency_key || '');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) errors.idempotency_key = 'invalid';
  if (Object.keys(errors).length) throw new AppError(400, 'VALIDATION', 'Please check the highlighted fields', { fields: errors });
  const language = body.language === 'en' ? 'en' : 'sv';

  let promise = inflight.get(key);
  if (!promise) {
    promise = processCheckout({ customer: values, items: body.items, key, language });
    inflight.set(key, promise);
    promise.then(() => inflight.delete(key), () => inflight.delete(key));
  }
  return await promise;
});

function ownOrder(number, token) {
  if (!orders.tokenValid(number, token)) throw new AppError(404, 'NOT_FOUND', 'Order not found');
  return orders.getByNumber(number);
}

route('GET', '/api/orders/:number', {}, async ({ params, query, ip }) => {
  if (rateLimit(`order:${ip}`, 90, 60_000).limited) throw new AppError(429, 'RATE_LIMITED', 'Too many requests');
  let order = ownOrder(params.number, query.token);
  if (!order) throw new AppError(410, 'ORDER_EXPIRED', 'This checkout has expired');
  if (order.payment_provider === 'stripe' && order.payment_status === 'unpaid') {
    try {
      order = await payments.reconcile(order);
    } catch (err) {
      log('error', 'reconcile_failed', { code: err.code }); // keep showing "processing"; the webhook will catch up
    }
    if (!order) throw new AppError(410, 'ORDER_EXPIRED', 'This checkout has expired');
  }
  return { order: orders.publicOrder(order) };
});

/** Customer came back from the payment page without paying (Back button / "cancel"): release the reserved stock. */
route('POST', '/api/orders/:number/abandon', {}, async ({ params, body }) => {
  const order = ownOrder(params.number, body.token);
  if (!order) return { status: 'abandoned' };
  if (order.payment_provider !== 'stripe' || order.payment_status !== 'unpaid' || order.order_status !== 'pending') {
    return { status: order.payment_status === 'paid' ? 'paid' : 'unchanged' };
  }
  const state = await payments.closeSession(order);
  if (state === 'complete') {
    await payments.reconcile(order);
    return { status: 'paid' };
  }
  orders.voidUnpaid(order.id);
  return { status: 'abandoned' };
});

route('POST', '/api/webhooks/stripe', { webhook: true, raw: true }, async ({ req, raw }) => {
  if (!payments.enabled()) throw new AppError(404, 'NOT_FOUND', 'Not found');
  const event = payments.verifyWebhook(raw, req.headers['stripe-signature']);
  await payments.handleEvent(event);
  return { received: true };
});

/* ================================================================== admin */

route('POST', '/api/admin/login', {}, async ({ body, ip }) => {
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  const ipKey = `login:ip:${ip}`;
  const emailKey = `login:email:${email}`;
  if (rateLimitPeek(ipKey, 10) || rateLimitPeek(emailKey, 5)) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many failed attempts. Try again in 15 minutes.');
  }
  const user = await auth.login(email, body.password);
  if (!user) {
    rateLimit(ipKey, 10, 15 * 60_000);
    rateLimit(emailKey, 5, 15 * 60_000);
    throw new AppError(401, 'INVALID_LOGIN', 'Wrong email or password');
  }
  rateLimitReset(emailKey);
  const s = auth.createSession(user.id);
  return [200, { email: user.email, csrf: s.csrf }, { 'Set-Cookie': auth.sessionCookie(s.id) }];
});

route('POST', '/api/admin/logout', {}, ({ req }) => {
  auth.destroySession(req);
  return [200, { ok: true }, { 'Set-Cookie': auth.clearCookie() }];
});

route('GET', '/api/admin/me', { admin: true }, ({ session }) => ({ email: session.admin.email, csrf: session.csrf, payment_mode: payments.enabled() ? 'stripe' : 'manual', email_enabled: mailer.enabled(), currency: cfg.currency }));

route('GET', '/api/admin/orders', { admin: true }, ({ query }) => orders.listAdmin({
  search: query.search, status: query.status, page: parseInt(query.page, 10) || 1, limit: parseInt(query.limit, 10) || 25,
}));

route('GET', '/api/admin/orders/:id', { admin: true }, ({ params }) => {
  const o = orders.getById(intParam(params.id));
  if (!o) throw new AppError(404, 'NOT_FOUND', 'Order not found');
  return { order: orders.adminOrder(o) };
});

route('PATCH', '/api/admin/orders/:id', { admin: true }, async ({ params, body, session }) => {
  const id = intParam(params.id);
  let cur = orders.getById(id);
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Order not found');
  const status = body.order_status || cur.order_status;

  // Cancelling an order that is still waiting for online payment: close the payment page first,
  // so the customer cannot pay for an order we are giving the stock back for.
  if (status === 'cancelled' && cur.payment_provider === 'stripe' && cur.payment_status === 'unpaid' && cur.payment_reference) {
    if ((await payments.closeSession(cur)) === 'complete') {
      await payments.reconcile(cur);
      cur = orders.getById(id);
    }
  }
  const result = orders.setStatus(id, { status, tracking: body.tracking_number }, `admin:${session.admin.email}`);
  if (result.order.order_status === 'shipped' && result.changedFrom !== 'shipped') mailer.onShipped(result.order);
  return { order: orders.adminOrder(result.order) };
});

route('POST', '/api/admin/orders/:id/mark-paid', { admin: true }, ({ params, session }) => {
  const o = orders.getById(intParam(params.id));
  if (!o) throw new AppError(404, 'NOT_FOUND', 'Order not found');
  if (o.payment_provider !== 'manual') throw new AppError(409, 'PAYMENT_PROVIDER_CONTROLS', 'Online payments are confirmed automatically by the payment provider.');
  if (o.order_status === 'cancelled') throw new AppError(409, 'ORDER_CANCELLED', 'This order is cancelled.');
  const r = orders.markPaid(o.id, { source: `admin:${session.admin.email}` });
  if (r.changed) mailer.onManualMarkedPaid(r.order);
  return { order: orders.adminOrder(orders.getById(o.id)) };
});

route('GET', '/api/admin/products', { admin: true }, () => ({ products: catalog.listAll().map(catalog.toAdmin) }));

route('GET', '/api/admin/products/:id', { admin: true }, ({ params }) => {
  const p = catalog.getById(intParam(params.id));
  if (!p) throw new AppError(404, 'NOT_FOUND', 'Product not found');
  return { product: catalog.toAdmin(p) };
});

route('POST', '/api/admin/products', { admin: true }, ({ body }) => [201, { product: catalog.toAdmin(catalog.createProduct(body)) }]);

route('PUT', '/api/admin/products/:id', { admin: true }, ({ params, body }) => ({
  product: catalog.toAdmin(catalog.updateProduct(intParam(params.id), body)),
}));

route('DELETE', '/api/admin/products/:id', { admin: true }, ({ params }) => {
  catalog.deleteProduct(intParam(params.id));
  return { ok: true };
});

const IMAGE_TYPES = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};

route('POST', '/api/admin/uploads', { admin: true, raw: true, limit: 8 * 1024 * 1024 }, ({ req, raw }) => {
  const type = IMAGE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()];
  if (!type || !raw.length || !type.magic(raw)) throw new AppError(400, 'INVALID_IMAGE', 'Upload a JPEG, PNG or WebP image (max 8 MB).');
  const name = `${crypto.randomBytes(12).toString('hex')}.${type.ext}`;
  fs.writeFileSync(path.join(cfg.uploadDir, name), raw, { mode: 0o644 });
  return [201, { url: `/uploads/${name}` }];
});

module.exports = { dispatch };
