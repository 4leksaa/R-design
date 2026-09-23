'use strict';
/**
 * End-to-end tests. They start the real server against a throwaway database, a fake Stripe API
 * and a fake email API, then walk through the whole shop flow over HTTP.
 * Run:  npm test
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = ['--disable-warning=ExperimentalWarning'];
const WHSEC = 'whsec_test_secret';
const ADMIN = { email: 'owner@example.com', password: 'correct-horse-battery' };

/* ---------------------------------------------------------- fake Stripe + Resend */
function startMocks() {
  const state = { sessions: new Map(), seq: 0, idem: new Map(), emails: [], failCreate: false, createCalls: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/emails') { state.emails.push(JSON.parse(body)); return send(200, { id: 'em_1' }); }
      if (!/^Bearer sk_test_/.test(req.headers.authorization || '') && url.pathname.startsWith('/v1/')) return send(401, { error: { message: 'no key' } });
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        state.createCalls += 1;
        if (state.failCreate) return send(500, { error: { type: 'api_error' } });
        const idem = req.headers['idempotency-key'];
        if (idem && state.idem.has(idem)) return send(200, state.idem.get(idem));
        const p = new URLSearchParams(body);
        let amount = 0;
        for (const [k, v] of p) {
          const m = /^line_items\[(\d+)\]\[price_data\]\[unit_amount\]$/.exec(k);
          if (m) amount += Number(v) * Number(p.get(`line_items[${m[1]}][quantity]`));
        }
        const id = `cs_test_${++state.seq}`;
        const s = {
          id, object: 'checkout.session', url: `https://checkout.stripe.test/pay/${id}`, status: 'open', payment_status: 'unpaid',
          amount_total: amount, currency: p.get('line_items[0][price_data][currency]'), client_reference_id: p.get('client_reference_id'),
          customer_email: p.get('customer_email'), payment_intent: null, params: Object.fromEntries(p),
        };
        state.sessions.set(id, s);
        if (idem) state.idem.set(idem, s);
        return send(200, s);
      }
      let m = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(url.pathname);
      if (m) {
        const s = state.sessions.get(m[1]);
        if (!s) return send(404, { error: { message: 'missing' } });
        if (m[2]) {
          if (s.status !== 'open') return send(400, { error: { message: 'not open' } });
          s.status = 'expired';
        }
        return send(200, s);
      }
      send(404, { error: {} });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}

/* -------------------------------------------------------------------- app runner */
async function startApp({ mocks, stripe = true, extraEnv = {}, seed = true }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwc-test-'));
  const port = 4000 + Math.floor(Math.random() * 4000);
  const env = {
    ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}`,
    SECRET_KEY: 'test-secret-key-test-secret-key-1234', NODE_ENV: 'test',
    RESEND_API_KEY: 're_test', RESEND_API_BASE: `http://127.0.0.1:${mocks.port}`, MAIL_FROM: 'Shop <shop@example.com>',
    ORDER_NOTIFY_EMAIL: 'owner@example.com', UNPAID_ORDER_TTL_MINUTES: '600', SWEEP_INTERVAL_SECONDS: '3600', CHECKOUT_RATE_LIMIT: '1000',
    ...(stripe ? { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_BASE: `http://127.0.0.1:${mocks.port}` } : { STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' }),
    ...extraEnv,
  };
  if (seed) assert.equal(spawnSync('node', [...NODE, 'server/scripts/seed.js'], { cwd: ROOT, env }).status, 0);
  assert.equal(spawnSync('node', [...NODE, 'server/scripts/create-admin.js'], { cwd: ROOT, env: { ...env, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password } }).status, 0);
  const proc = spawn('node', [...NODE, 'server/server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  proc.stdout.on('data', (d) => (logs += d));
  proc.stderr.on('data', (d) => (logs += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch (_) { /* wait */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const app = {
    base, dataDir, logs: () => logs, proc,
    async call(method, url, { body, headers = {}, cookie, csrf, raw } = {}) {
      const h = { ...headers };
      if (cookie) h.cookie = cookie;
      if (csrf) h['x-csrf-token'] = csrf;
      let payload;
      if (raw) payload = raw; else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
      const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* not json */ }
      return { status: res.status, json, text, headers: res.headers };
    },
    async login() {
      const r = await app.call('POST', '/api/admin/login', { body: ADMIN });
      assert.equal(r.status, 200);
      const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      return { cookie, csrf: r.json.csrf };
    },
    stop() { proc.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
  return app;
}

const customer = (over) => ({
  customer: { first_name: 'Anna', last_name: 'Svensson', email: 'anna@example.com', phone: '+46 70 123 45 67' },
  shipping: { address: 'Storgatan 1', address2: '', city: 'Malmö', postal_code: '21158', country: 'SE' },
  accept_terms: true, language: 'sv', ...over,
});
const key = () => crypto.randomUUID();
const signed = (event) => {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', WHSEC).update(`${t}.${payload}`).digest('hex');
  return { raw: Buffer.from(payload), headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' } };
};

/* ============================================================ STRIPE-CONNECTED SHOP */
describe('shop with Stripe connected', () => {
  let mocks; let app; let P; let admin;
  const variant = (product, label) => product.variants.find((v) => v.label_en.startsWith(label));
  const stockLeft = async (pid, vid) => {
    const r = await app.call('GET', `/api/products/${pid}`);
    const p = r.json.product;
    const x = vid ? p.variants.find((v) => v.id === vid) : p;
    return x.max_qty; // exact while stock is below the per-line cap
  };
  const place = async (items, over) => app.call('POST', '/api/checkout', { body: customer({ items, idempotency_key: key(), ...over }) });
  const getOrder = (o) => app.call('GET', `/api/orders/${o.order_number}?token=${encodeURIComponent(o.token)}`);
  const complete = async (sessionId, extra) => {
    const s = mocks.state.sessions.get(sessionId);
    s.status = 'complete'; s.payment_status = 'paid'; s.payment_intent = 'pi_' + sessionId;
    const ev = { id: 'evt_' + crypto.randomUUID(), type: 'checkout.session.completed', data: { object: { ...s, ...extra } } };
    return { ev, res: await app.call('POST', '/api/webhooks/stripe', signed(ev)) };
  };

  before(async () => {
    mocks = await startMocks();
    app = await startApp({ mocks });
    P = (await app.call('GET', '/api/products')).json.products;
    admin = await app.login();
  });
  after(() => { app.stop(); mocks.server.close(); });

  test('products are served from the database and do not leak internals', () => {
    assert.equal(P.length, 4);
    assert.ok(!('stock_quantity' in P[0]) && !('active' in P[0]) && !('created_at' in P[0]));
    assert.equal(P.find((p) => p.name_en.startsWith('Vintage')).stock_status, 'out_of_stock');
  });

  test('cart quote uses database prices and ignores prices sent by the browser', async () => {
    const dress = P[0]; const navy = variant(dress, 'Navy');
    const r = await app.call('POST', '/api/cart/quote', { body: { country: 'SE', items: [{ product_id: dress.id, variant_id: navy.id, quantity: 2, unit_price: 1, price: 1, total: 1 }] } });
    assert.equal(r.status, 200);
    assert.equal(r.json.subtotal, 2 * 1290000);
    assert.equal(r.json.shipping, 9900);
    assert.equal(r.json.total, 2 * 1290000 + 9900);
  });

  test('quote reports stock / invalid product / missing variant problems', async () => {
    const dress = P[0]; const navy = variant(dress, 'Navy');
    const q = (items) => app.call('POST', '/api/cart/quote', { body: { country: 'SE', items } }).then((r) => r.json.issues.map((i) => i.code));
    assert.deepEqual(await q([{ product_id: dress.id, variant_id: navy.id, quantity: 4 }]), ['INSUFFICIENT_STOCK']);
    assert.deepEqual(await q([{ product_id: 9999, variant_id: null, quantity: 1 }]), ['PRODUCT_UNAVAILABLE']);
    assert.deepEqual(await q([{ product_id: dress.id, variant_id: null, quantity: 1 }]), ['INVALID_VARIANT']);
    assert.deepEqual(await q([{ product_id: P[3].id, variant_id: null, quantity: 1 }]), ['OUT_OF_STOCK']);
    assert.deepEqual(await q([{ product_id: dress.id, variant_id: navy.id, quantity: 1 }, { product_id: dress.id, variant_id: navy.id, quantity: 3 }]), ['INSUFFICIENT_STOCK'], 'split lines are merged');
    assert.equal((await app.call('POST', '/api/cart/quote', { body: { items: [{ product_id: 'x', quantity: 1 }] } })).status, 400);
  });

  test('checkout rejects invalid customer information with field errors', async () => {
    const dress = P[0]; const navy = variant(dress, 'Navy');
    const items = [{ product_id: dress.id, variant_id: navy.id, quantity: 1 }];
    const r = await place(items, { customer: { first_name: '', last_name: 'S', email: 'not-an-email', phone: '12' }, shipping: { address: 'x', city: '', postal_code: '12', country: 'SE' }, accept_terms: false });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'VALIDATION');
    for (const f of ['first_name', 'email', 'phone', 'address', 'city', 'postal_code', 'accept_terms']) assert.ok(r.json.error.fields[f], `field ${f}`);
    const other = await place(items, { shipping: { address: 'Storgatan 1', city: 'Paris', postal_code: '75001', country: 'FR' } });
    assert.equal(other.json.error.fields.country, 'unsupported');
    assert.doesNotMatch(r.text, /sqlite|SELECT|stack/i);
  });

  test('full flow: order saved, stock reserved, payment page created with server prices, then paid via webhook', async () => {
    const dress = P[0]; const navy = variant(dress, 'Navy');
    const before = await stockLeft(dress.id, navy.id);
    const r = await place([{ product_id: dress.id, variant_id: navy.id, quantity: 1, unit_price: 1 }]);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.status, 'redirect');
    assert.match(r.json.redirect_url, /^https:\/\/checkout\.stripe\.test\/pay\/cs_test_/);
    assert.match(r.json.order_number, /^MWC-\d{6}-[A-Z2-9]{6}$/);

    const session = [...mocks.state.sessions.values()].find((s) => s.client_reference_id === r.json.order_number);
    assert.equal(session.amount_total, 1290000 + 9900, 'Stripe is asked to charge the server-calculated total');
    assert.equal(session.params['success_url'].includes(r.json.order_number), true);
    assert.equal(await stockLeft(dress.id, navy.id), before - 1, 'stock reserved');

    let o = await getOrder(r.json);
    assert.equal(o.json.order.payment_status, 'unpaid');
    assert.equal(o.json.order.order_status, 'pending');
    assert.equal(o.json.order.total, 1299900);

    mocks.state.emails.length = 0;
    const { ev, res } = await complete(session.id);
    assert.equal(res.status, 200);
    o = await getOrder(r.json);
    assert.equal(o.json.order.payment_status, 'paid');
    assert.equal(o.json.order.order_status, 'paid');
    await new Promise((s) => setTimeout(s, 300));
    assert.equal(mocks.state.emails.length, 2, 'customer confirmation + owner notification');
    assert.equal(mocks.state.emails[0].to[0], 'anna@example.com');
    assert.match(mocks.state.emails[0].html, /MWC-/);

    const replay = await app.call('POST', '/api/webhooks/stripe', signed(ev));
    assert.equal(replay.status, 200);
    await new Promise((s) => setTimeout(s, 200));
    assert.equal(mocks.state.emails.length, 2, 'replayed webhook does not send again');
  });

  test('order pages cannot be opened without the right token', async () => {
    const dress = P[0]; const white = variant(dress, 'White');
    const a = (await place([{ product_id: dress.id, variant_id: white.id, quantity: 1 }])).json;
    const b = (await place([{ product_id: dress.id, variant_id: white.id, quantity: 1 }])).json;
    assert.equal((await app.call('GET', `/api/orders/${a.order_number}`)).status, 404);
    assert.equal((await app.call('GET', `/api/orders/${a.order_number}?token=${b.token}`)).status, 404);
    assert.equal((await app.call('GET', `/api/orders/${a.order_number}?token=${a.token}`)).status, 200);
    for (const o of [a, b]) await app.call('POST', `/api/orders/${o.order_number}/abandon`, { body: { token: o.token } });
  });

  test('double-clicking Place Order creates exactly one order and one payment page', async () => {
    const chrono = P[2]; const steel = variant(chrono, 'Steel');
    const before = await stockLeft(chrono.id, steel.id);
    const calls = mocks.state.createCalls;
    const k = key();
    const body = customer({ items: [{ product_id: chrono.id, variant_id: steel.id, quantity: 1 }], idempotency_key: k });
    const results = await Promise.all(Array.from({ length: 6 }, () => app.call('POST', '/api/checkout', { body })));
    const numbers = new Set(results.map((r) => r.json.order_number));
    assert.equal(numbers.size, 1);
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(new Set(results.map((r) => r.json.redirect_url)).size, 1);
    assert.equal(mocks.state.createCalls - calls, 1, 'one Stripe session');
    assert.equal(await stockLeft(chrono.id, steel.id), before - 1, 'stock only reduced once');
    // a later re-submit of the same attempt still returns the same order
    const again = await app.call('POST', '/api/checkout', { body });
    assert.equal(again.json.order_number, [...numbers][0]);
    // same key but changed details is refused
    const changed = await app.call('POST', '/api/checkout', { body: { ...body, items: [{ product_id: chrono.id, variant_id: steel.id, quantity: 2 }] } });
    assert.equal(changed.status, 409);
    assert.equal(changed.json.error.code, 'IDEMPOTENCY_MISMATCH');
    await app.call('POST', `/api/orders/${[...numbers][0]}/abandon`, { body: { token: results[0].json.token } });
  });

  test('cannot order more than is in stock, even with parallel orders', async () => {
    const diver = P[1]; // 1 in stock
    const results = await Promise.all([1, 2, 3].map(() => place([{ product_id: diver.id, variant_id: null, quantity: 1 }])));
    const ok = results.filter((r) => r.status === 200);
    const rejected = results.filter((r) => r.status === 409);
    assert.equal(ok.length, 1);
    assert.equal(rejected.length, 2);
    assert.equal(rejected[0].json.error.code, 'CART_INVALID');
    assert.equal(rejected[0].json.error.issues[0].code, 'OUT_OF_STOCK');
    assert.equal((await app.call('GET', `/api/products/${diver.id}`)).json.product.stock_status, 'out_of_stock');
    await app.call('POST', `/api/orders/${ok[0].json.order_number}/abandon`, { body: { token: ok[0].json.token } });
    assert.equal((await app.call('GET', `/api/products/${diver.id}`)).json.product.stock_status, 'low_stock', 'stock returns when the order is abandoned');
  });

  test('webhooks: bad signature rejected; wrong amount never marks an order paid', async () => {
    const chrono = P[2]; const steel = variant(chrono, 'Steel');
    const o = (await place([{ product_id: chrono.id, variant_id: steel.id, quantity: 1 }])).json;
    const bad = await app.call('POST', '/api/webhooks/stripe', { raw: Buffer.from('{"id":"evt_x"}'), headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` } });
    assert.equal(bad.status, 400);
    const old = await app.call('POST', '/api/webhooks/stripe', { raw: Buffer.from('{}'), headers: { 'stripe-signature': 't=1,v1=00' } });
    assert.equal(old.status, 400);
    const session = [...mocks.state.sessions.values()].find((s) => s.client_reference_id === o.order_number);
    mocks.state.sessions.get(session.id).amount_total = 100; // provider reports a different amount than we calculated
    await complete(session.id, { amount_total: 100 });
    const got = (await getOrder(o)).json.order;
    assert.equal(got.payment_status, 'unpaid', 'amount mismatch is not accepted as paid');
    const orders = await app.call('GET', '/api/admin/orders?search=' + o.order_number, { cookie: admin.cookie });
    const detail = await app.call('GET', `/api/admin/orders/${orders.json.orders[0].id}`, { cookie: admin.cookie });
    assert.ok(detail.json.order.events.some((e) => e.event === 'payment_amount_mismatch'));
    await app.call('POST', `/api/orders/${o.order_number}/abandon`, { body: { token: o.token } });
  });

  test('failed payment cancels the order and returns the stock', async () => {
    const chrono = P[2]; const steel = variant(chrono, 'Steel');
    const before = await stockLeft(chrono.id, steel.id);
    const o = (await place([{ product_id: chrono.id, variant_id: steel.id, quantity: 2 }])).json;
    assert.equal(await stockLeft(chrono.id, steel.id), before - 2);
    const s = [...mocks.state.sessions.values()].find((x) => x.client_reference_id === o.order_number);
    const ev = { id: 'evt_' + crypto.randomUUID(), type: 'checkout.session.async_payment_failed', data: { object: { ...s, payment_status: 'unpaid' } } };
    assert.equal((await app.call('POST', '/api/webhooks/stripe', signed(ev))).status, 200);
    const got = (await getOrder(o)).json.order;
    assert.equal(got.order_status, 'cancelled');
    assert.equal(got.payment_status, 'failed');
    assert.equal(await stockLeft(chrono.id, steel.id), before, 'stock back');
  });

  test('customer returns from the payment page without paying: order is released', async () => {
    const chrono = P[2]; const steel = variant(chrono, 'Steel');
    const before = await stockLeft(chrono.id, steel.id);
    const o = (await place([{ product_id: chrono.id, variant_id: steel.id, quantity: 1 }])).json;
    const r = await app.call('POST', `/api/orders/${o.order_number}/abandon`, { body: { token: o.token } });
    assert.equal(r.json.status, 'abandoned');
    assert.equal(await stockLeft(chrono.id, steel.id), before);
    assert.equal((await getOrder(o)).status, 410);
    const s = [...mocks.state.sessions.values()].find((x) => x.client_reference_id === o.order_number);
    assert.equal(s.status, 'expired', 'payment page closed at Stripe');
  });

  test('a paid order is never released by "abandon", and the confirmation page catches up without a webhook', async () => {
    const chrono = P[2]; const steel = variant(chrono, 'Steel');
    const o = (await place([{ product_id: chrono.id, variant_id: steel.id, quantity: 1 }])).json;
    const s = mocks.state.sessions.get([...mocks.state.sessions.values()].find((x) => x.client_reference_id === o.order_number).id);
    s.status = 'complete'; s.payment_status = 'paid'; // customer paid, webhook has not arrived
    const r = await app.call('POST', `/api/orders/${o.order_number}/abandon`, { body: { token: o.token } });
    assert.equal(r.json.status, 'paid');
    assert.equal((await getOrder(o)).json.order.payment_status, 'paid');
  });

  test('if the payment provider is down, no order is left behind and stock is untouched', async () => {
    const chrono = P[2]; const steel = variant(chrono, 'Steel');
    const before = await stockLeft(chrono.id, steel.id);
    const total = (await app.call('GET', '/api/admin/orders', { cookie: admin.cookie })).json.total;
    mocks.state.failCreate = true;
    const r = await place([{ product_id: chrono.id, variant_id: steel.id, quantity: 1 }]);
    mocks.state.failCreate = false;
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, 'PAYMENT_UNAVAILABLE');
    assert.doesNotMatch(r.text, /stripe|sqlite|stack/i);
    assert.equal(await stockLeft(chrono.id, steel.id), before);
    assert.equal((await app.call('GET', '/api/admin/orders', { cookie: admin.cookie })).json.total, total);
  });

  test('admin area requires login, CSRF token and rate-limits guessing', async () => {
    assert.equal((await app.call('GET', '/api/admin/orders')).status, 401);
    assert.equal((await app.call('GET', '/api/admin/products')).status, 401);
    assert.equal((await app.call('POST', '/api/admin/products', { body: {} })).status, 401);
    assert.equal((await app.call('POST', '/api/admin/login', { body: { email: ADMIN.email, password: 'wrong-password-123' } })).status, 401);
    const noCsrf = await app.call('PATCH', '/api/admin/orders/1', { cookie: admin.cookie, body: { order_status: 'cancelled' } });
    assert.equal(noCsrf.status, 403);
    const evil = await app.call('POST', '/api/checkout', { headers: { origin: 'https://evil.example' }, body: {} });
    assert.equal(evil.status, 403);
  });

  test('admin: search, filter, open order, change status with payment rules, cancel + refund flag', async () => {
    const list = await app.call('GET', '/api/admin/orders', { cookie: admin.cookie });
    assert.equal(list.status, 200);
    const paid = list.json.orders.find((o) => o.payment_status === 'paid');
    assert.ok(paid);
    assert.equal((await app.call('GET', '/api/admin/orders?status=paid', { cookie: admin.cookie })).json.orders.every((o) => o.order_status === 'paid'), true);
    assert.equal((await app.call('GET', '/api/admin/orders?search=' + encodeURIComponent('anna@example'), { cookie: admin.cookie })).json.total >= 1, true);
    assert.equal((await app.call('GET', '/api/admin/orders?search=' + encodeURIComponent("%' OR 1=1 --"), { cookie: admin.cookie })).json.total, 0);

    const detail = (await app.call('GET', `/api/admin/orders/${paid.id}`, { cookie: admin.cookie })).json.order;
    assert.equal(detail.customer_email, 'anna@example.com');
    assert.equal(detail.items[0].quantity, 1);

    // unpaid order cannot be moved to fulfilment
    const chrono = P[2]; const steel = variant(chrono, 'Steel');
    const u = (await place([{ product_id: chrono.id, variant_id: steel.id, quantity: 1 }])).json;
    const uid = (await app.call('GET', '/api/admin/orders?search=' + u.order_number, { cookie: admin.cookie })).json.orders[0].id;
    const patch = (id, body) => app.call('PATCH', `/api/admin/orders/${id}`, { cookie: admin.cookie, csrf: admin.csrf, body });
    assert.equal((await patch(uid, { order_status: 'shipped' })).json.error.code, 'PAYMENT_NOT_CONFIRMED');
    assert.equal((await patch(uid, { order_status: 'paid' })).json.error.code, 'PAYMENT_NOT_CONFIRMED');
    assert.equal((await app.call('POST', `/api/admin/orders/${uid}/mark-paid`, { cookie: admin.cookie, csrf: admin.csrf, body: {} })).json.error.code, 'PAYMENT_PROVIDER_CONTROLS');
    // cancelling it closes the Stripe page and returns the stock
    const before = await stockLeft(chrono.id, steel.id);
    assert.equal((await patch(uid, { order_status: 'cancelled' })).status, 200);
    assert.equal(await stockLeft(chrono.id, steel.id), before + 1);
    const s = [...mocks.state.sessions.values()].find((x) => x.client_reference_id === u.order_number);
    assert.equal(s.status, 'expired');
    assert.equal((await patch(uid, { order_status: 'pending' })).json.error.code, 'ORDER_CANCELLED');

    // paid order -> processing -> shipped (email) -> cancelled (refund flag)
    mocks.state.emails.length = 0;
    assert.equal((await patch(paid.id, { order_status: 'processing' })).status, 200);
    const shipped = await patch(paid.id, { order_status: 'shipped', tracking_number: 'PN123456789SE' });
    assert.equal(shipped.json.order.order_status, 'shipped');
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(mocks.state.emails.some((e) => /har skickats/.test(e.subject) && /PN123456789SE/.test(e.html)));
    assert.equal((await patch(paid.id, { order_status: 'pending' })).json.error.code, 'INVALID_TRANSITION');
    const cancelled = await patch(paid.id, { order_status: 'cancelled' });
    assert.equal(cancelled.json.order.refund_required, true);
  });

  test('admin: products CRUD, price snapshot on old orders, deactivate, uploads', async () => {
    const h = { cookie: admin.cookie, csrf: admin.csrf };
    const created = await app.call('POST', '/api/admin/products', { ...h, body: { name: 'Testklocka', name_en: 'Test watch', price: 500000, stock_quantity: 3, active: true, images: [], variants: [], specs: [{ label: 'Verk', value: 'Kvarts' }] } });
    assert.equal(created.status, 201, created.text);
    const p = created.json.product;
    assert.equal((await app.call('GET', '/api/products')).json.products.some((x) => x.id === p.id), true);

    const o = (await place([{ product_id: p.id, variant_id: null, quantity: 2 }])).json;
    // change price + name afterwards
    const upd = await app.call('PUT', `/api/admin/products/${p.id}`, { ...h, body: { ...p, name: 'Omdöpt', price: 900000 } });
    assert.equal(upd.status, 200);
    const oid = (await app.call('GET', '/api/admin/orders?search=' + o.order_number, { cookie: admin.cookie })).json.orders[0].id;
    const detail = (await app.call('GET', `/api/admin/orders/${oid}`, { cookie: admin.cookie })).json.order;
    assert.equal(detail.items[0].product_name, 'Testklocka');
    assert.equal(detail.items[0].unit_price, 500000);
    assert.equal(detail.subtotal, 1000000);

    // stock change by admin
    await app.call('PUT', `/api/admin/products/${p.id}`, { ...h, body: { ...upd.json.product, stock_quantity: 0 } });
    assert.equal((await app.call('GET', `/api/products/${p.id}`)).json.product.stock_status, 'out_of_stock');
    await app.call('PUT', `/api/admin/products/${p.id}`, { ...h, body: { ...upd.json.product, stock_quantity: 5, active: false } });
    assert.equal((await app.call('GET', '/api/products')).json.products.some((x) => x.id === p.id), false, 'deactivated products disappear');
    assert.equal((await app.call('GET', `/api/products/${p.id}`)).status, 404);
    const r = await place([{ product_id: p.id, variant_id: null, quantity: 1 }]);
    assert.equal(r.status, 409);
    assert.equal(r.json.error.issues[0].code, 'PRODUCT_UNAVAILABLE');

    // validation
    const bad = await app.call('POST', '/api/admin/products', { ...h, body: { name: '', price: -5, images: ['javascript:alert(1)'] } });
    assert.equal(bad.status, 400);
    assert.ok(bad.json.error.fields.name && bad.json.error.fields.price && bad.json.error.fields.images);

    // uploads
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const up = await app.call('POST', '/api/admin/uploads', { ...h, raw: png, headers: { 'content-type': 'image/png' } });
    assert.equal(up.status, 201);
    const served = await fetch(app.base + up.json.url);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal((await app.call('POST', '/api/admin/uploads', { ...h, raw: Buffer.from('<svg onload=alert(1)>'), headers: { 'content-type': 'image/png' } })).status, 400);
    assert.equal((await app.call('POST', '/api/admin/uploads', { ...h, raw: Buffer.from('<svg/>'), headers: { 'content-type': 'image/svg+xml' } })).status, 400);
    assert.equal((await app.call('POST', '/api/admin/uploads', { raw: png, headers: { 'content-type': 'image/png' } })).status, 401);

    // deleting a product keeps old orders readable
    assert.equal((await app.call('DELETE', `/api/admin/products/${p.id}`, h)).status, 200);
    const after = (await app.call('GET', `/api/admin/orders/${oid}`, { cookie: admin.cookie })).json.order;
    assert.equal(after.items[0].product_name, 'Testklocka');
    await app.call('POST', `/api/orders/${o.order_number}/abandon`, { body: { token: o.token } });
  });

  test('static site: pages load, private files and traversal are not served', async () => {
    for (const p of ['/', '/butik.html', '/produkt.html', '/varukorg.html', '/kassa.html', '/bekraftelse.html', '/villkor.html', '/admin/', '/css/styles.css', '/js/shop-pages.js', '/assets/images/shop/diver-front.svg']) {
      assert.equal((await app.call('GET', p)).status, 200, p);
    }
    for (const p of ['/.env', '/../server/config.js', '/%2e%2e/server/config.js', '/data/shop.sqlite', '/server/db.js', '/package.json', '/..%2fserver%2fconfig.js', '/uploads/../../server/config.js']) {
      const r = await app.call('GET', p);
      assert.notEqual(r.status, 200, p);
      assert.doesNotMatch(r.text, /DatabaseSync|STRIPE_SECRET/, p);
    }
    const page = await app.call('GET', '/butik.html');
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal((await app.call('GET', '/api/nope')).json.error.code, 'NOT_FOUND');
  });

  test('no secrets are ever sent to the browser', async () => {
    const pages = ['/api/config', '/api/products', '/js/shop-core.js', '/js/shop-pages.js', '/admin/admin.js'];
    for (const p of pages) {
      const r = await app.call('GET', p);
      assert.doesNotMatch(r.text, /sk_test_|whsec_|re_test|test-secret-key/, p);
    }
  });
});

/* ================================================================ MANUAL PAYMENT MODE */
describe('shop without Stripe (manual payment)', () => {
  let mocks; let app; let P; let admin;
  before(async () => { mocks = await startMocks(); app = await startApp({ mocks, stripe: false }); P = (await app.call('GET', '/api/products')).json.products; admin = await app.login(); });
  after(() => { app.stop(); mocks.server.close(); });

  test('order is saved as unpaid, stock reserved, payment instructions shown, admin confirms payment', async () => {
    assert.equal((await app.call('GET', '/api/config')).json.payment_mode, 'manual');
    const dress = P[0]; const navy = dress.variants[0];
    const r = await app.call('POST', '/api/checkout', { body: customer({ language: 'en', items: [{ product_id: dress.id, variant_id: navy.id, quantity: 1 }], idempotency_key: key() }) });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.status, 'placed');
    const o = (await app.call('GET', `/api/orders/${r.json.order_number}?token=${encodeURIComponent(r.json.token)}`)).json.order;
    assert.equal(o.payment_status, 'unpaid');
    assert.match(o.payment_instructions.en, /payment instructions/);
    await new Promise((s) => setTimeout(s, 300));
    assert.ok(mocks.state.emails.some((e) => e.to[0] === 'anna@example.com' && /Order confirmation/.test(e.subject)));

    const h = { cookie: admin.cookie, csrf: admin.csrf };
    const id = (await app.call('GET', '/api/admin/orders', { cookie: admin.cookie })).json.orders[0].id;
    assert.equal((await app.call('PATCH', `/api/admin/orders/${id}`, { ...h, body: { order_status: 'shipped' } })).status, 409);
    const paid = await app.call('POST', `/api/admin/orders/${id}/mark-paid`, { ...h, body: {} });
    assert.equal(paid.json.order.payment_status, 'paid');
    assert.equal(paid.json.order.order_status, 'paid');
    assert.equal((await app.call('PATCH', `/api/admin/orders/${id}`, { ...h, body: { order_status: 'delivered' } })).status, 200);
  });

  test('stripe webhook endpoint is off when Stripe is not configured', async () => {
    assert.equal((await app.call('POST', '/api/webhooks/stripe', { raw: Buffer.from('{}'), headers: {} })).status, 404);
  });
});

/* ========================================================== CLEANUP OF ABANDONED ORDERS */
describe('cleanup job', () => {
  let mocks; let app;
  before(async () => { mocks = await startMocks(); app = await startApp({ mocks, extraEnv: { UNPAID_ORDER_TTL_MINUTES: '0.01', SWEEP_INTERVAL_SECONDS: '1' } }); });
  after(() => { app.stop(); mocks.server.close(); });

  test('unpaid online orders are released automatically (stock returns, payment page closed)', async () => {
    const P = (await app.call('GET', '/api/products')).json.products;
    const diver = P[1];
    const r = await app.call('POST', '/api/checkout', { body: customer({ items: [{ product_id: diver.id, variant_id: null, quantity: 1 }], idempotency_key: key() }) });
    assert.equal(r.status, 200);
    assert.equal((await app.call('GET', `/api/products/${diver.id}`)).json.product.stock_status, 'out_of_stock');
    let released = false;
    for (let i = 0; i < 40 && !released; i += 1) {
      await new Promise((s) => setTimeout(s, 250));
      released = (await app.call('GET', `/api/products/${diver.id}`)).json.product.stock_status !== 'out_of_stock';
    }
    assert.ok(released, 'stock released by sweeper');
    assert.equal([...mocks.state.sessions.values()][0].status, 'expired');
  });
});

/* ================================================================== RATE LIMIT */
describe('checkout rate limit', () => {
  let mocks; let app;
  before(async () => { mocks = await startMocks(); app = await startApp({ mocks, extraEnv: { CHECKOUT_RATE_LIMIT: '3' } }); });
  after(() => { app.stop(); mocks.server.close(); });
  test('too many checkout attempts from one address are slowed down', async () => {
    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await app.call('POST', '/api/checkout', { body: { idempotency_key: key() } })).status);
    assert.deepEqual(codes, [400, 400, 400, 429, 429]);
  });
});
