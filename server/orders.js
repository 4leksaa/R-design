'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const { db, tx, now } = require('./db');
const { AppError, safeEqual } = require('./util');
const catalog = require('./catalog');

const ORDER_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];
const FULFILMENT = ['processing', 'shipped', 'delivered'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid misreading

/* ------------------------------------------------------------ identifiers */

function randomCode(n) {
  const bytes = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i += 1) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

/** Unique and not sequential, so order numbers do not reveal how many orders you get. */
function generateOrderNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `MWC-${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${randomCode(6)}`;
}

/** Access token for a guest to view their own order. Derived from a server secret, so it cannot be guessed. */
function orderToken(orderNumber) {
  return crypto.createHmac('sha256', cfg.secretKey).update(`order-access:${orderNumber}`).digest('base64url');
}
const tokenValid = (orderNumber, token) => typeof token === 'string' && token.length > 0 && safeEqual(orderToken(orderNumber), token);

/* --------------------------------------------------------------- pricing */

function shippingCost(country, subtotal) {
  const rate = cfg.shippingRates[country];
  if (rate === undefined) return null;
  if (cfg.freeShippingOver > 0 && subtotal >= cfg.freeShippingOver) return 0;
  return rate;
}

function normaliseItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
    throw new AppError(400, 'VALIDATION', 'Invalid cart', { fields: { items: 'invalid' } });
  }
  const merged = new Map();
  for (const it of raw) {
    const pid = Number(it && it.product_id);
    const qty = Number(it && it.quantity);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(qty) || qty < -1 || qty > 1000) {
      throw new AppError(400, 'VALIDATION', 'Invalid cart', { fields: { items: 'invalid' } });
    }
    const vid = it.variant_id ? String(it.variant_id).slice(0, 40) : null;
    const key = `${pid}:${vid || ''}`;
    const prev = merged.get(key);
    // Repeated lines for the same product/variant are merged, so splitting a line cannot bypass stock checks.
    if (prev) prev.quantity += qty;
    else merged.set(key, { product_id: pid, variant_id: vid, quantity: qty });
  }
  return [...merged.values()].sort((a, b) => a.product_id - b.product_id || String(a.variant_id).localeCompare(String(b.variant_id)));
}

/**
 * Prices a cart entirely from the database. Anything the browser sends besides
 * product id, variant id and quantity is ignored.
 */
function priceCart(rawItems, country) {
  const items = normaliseItems(rawItems);
  const ids = [...new Set(items.map((i) => i.product_id))];
  const rows = db.prepare(`SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(catalog.hydrate);
  const byId = new Map(rows.map((p) => [p.id, p]));

  const lines = [];
  const issues = [];
  let subtotal = 0;

  for (const it of items) {
    const p = byId.get(it.product_id);
    const line = {
      product_id: it.product_id, variant_id: it.variant_id, quantity: it.quantity,
      slug: null, name: null, name_en: null, image: null, variant_label: '', variant_label_en: '',
      unit_price: 0, line_total: 0, max_qty: 0, issue: null,
    };

    if (!p || !p.active || p.currency !== cfg.currency) {
      line.issue = 'PRODUCT_UNAVAILABLE';
      if (p) { line.slug = p.slug; line.name = p.name; line.name_en = p.name_en; line.image = p.images[0] || null; }
    } else {
      line.slug = p.slug; line.name = p.name; line.name_en = p.name_en; line.image = p.images[0] || null;
      line.unit_price = p.price;
      const st = catalog.stockOf(p, it.variant_id);
      if (!st.validVariant) {
        line.issue = 'INVALID_VARIANT';
      } else {
        if (st.variant) { line.variant_label = st.variant.label; line.variant_label_en = st.variant.label_en; }
        line.max_qty = Math.min(st.available, cfg.maxQtyPerLine);
        if (it.quantity < 1) line.issue = 'INVALID_QUANTITY';
        else if (st.available <= 0) line.issue = 'OUT_OF_STOCK';
        else if (it.quantity > st.available || it.quantity > cfg.maxQtyPerLine) line.issue = 'INSUFFICIENT_STOCK';
      }
    }

    if (line.issue) {
      issues.push({ product_id: line.product_id, variant_id: line.variant_id, code: line.issue, max_qty: line.max_qty });
    } else {
      line.line_total = line.unit_price * line.quantity;
      subtotal += line.line_total;
    }
    lines.push(line);
  }

  const shipping = shippingCost(country, subtotal);
  return {
    currency: cfg.currency, country, lines, issues, subtotal,
    shipping, total: subtotal + (shipping || 0),
    ok: issues.length === 0 && lines.length > 0 && shipping !== null,
  };
}

/* ------------------------------------------------------------------ stock */

/** Adds delta (+/-) to a product's or variant's stock. Must run inside tx(). Returns false if it would go negative. */
function adjustStock(productId, variantId, delta) {
  const p = catalog.getById(productId);
  if (!p) return false;
  if (p.variants.length > 0) {
    const v = p.variants.find((x) => x.id === variantId);
    if (!v || v.stock_quantity + delta < 0) return false;
    v.stock_quantity += delta;
    db.prepare('UPDATE products SET variants = ?, stock_quantity = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(p.variants), catalog.sumVariantStock(p.variants), now(), productId);
    return true;
  }
  if (p.stock_quantity + delta < 0) return false;
  db.prepare('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?').run(delta, now(), productId);
  return true;
}

function releaseStock(order) {
  if (order.stock_released) return;
  for (const it of loadItems(order.id)) {
    if (it.product_id) adjustStock(it.product_id, it.variant_id, it.quantity);
  }
  db.prepare('UPDATE orders SET stock_released = 1 WHERE id = ?').run(order.id);
}

/* ----------------------------------------------------------------- reading */

const getById = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id) || null;
const getByNumber = (n) => db.prepare('SELECT * FROM orders WHERE order_number = ?').get(String(n)) || null;
const getByPaymentReference = (ref) => db.prepare('SELECT * FROM orders WHERE payment_reference = ?').get(String(ref)) || null;
const loadItems = (orderId) => db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);

function addEvent(orderId, actor, event, detail) {
  db.prepare('INSERT INTO order_events (order_id, at, actor, event, detail) VALUES (?,?,?,?,?)')
    .run(orderId, now(), actor, event, detail || '');
}

/** What the customer may see on the confirmation page. */
function publicOrder(o) {
  const items = loadItems(o.id);
  const awaitingManualPayment = o.payment_provider === 'manual' && o.payment_status === 'unpaid' && o.order_status !== 'cancelled';
  return {
    order_number: o.order_number,
    order_status: o.order_status,
    payment_status: o.payment_status,
    payment_provider: o.payment_provider,
    currency: o.currency,
    created_at: o.created_at,
    paid_at: o.paid_at,
    language: o.language,
    tracking_number: o.tracking_number,
    customer: { first_name: o.customer_first_name, last_name: o.customer_last_name, email: o.customer_email },
    shipping: {
      address: o.shipping_address, address2: o.shipping_address2, city: o.shipping_city,
      postal_code: o.shipping_postal_code, country: o.shipping_country,
    },
    items: items.map((i) => ({
      name: i.product_name, name_en: i.product_name_en,
      variant_label: i.variant_label, variant_label_en: i.variant_label_en,
      quantity: i.quantity, unit_price: i.unit_price, total_price: i.total_price,
    })),
    subtotal: o.subtotal, shipping_cost: o.shipping_cost, total: o.total,
    payment_instructions: awaitingManualPayment ? cfg.manualPaymentInstructions : null,
  };
}

function adminOrder(o) {
  return {
    ...o,
    items: loadItems(o.id),
    events: db.prepare('SELECT at, actor, event, detail FROM order_events WHERE order_id = ? ORDER BY id').all(o.id),
    emails: db.prepare('SELECT recipient, template, status, created_at FROM email_log WHERE order_id = ? ORDER BY id').all(o.id),
    can_mark_paid: o.payment_provider === 'manual' && o.payment_status === 'unpaid' && o.order_status !== 'cancelled',
    refund_required: o.payment_status === 'paid' && o.order_status === 'cancelled',
  };
}

/* ---------------------------------------------------------------- creating */

/**
 * Creates the order and reserves stock in ONE transaction: either everything is saved
 * or nothing is. The idempotency key makes a repeated submit (double click, retry after a
 * network error) return the order that already exists instead of creating a second one.
 */
function createOrder({ customer, items, idempotencyKey, language, provider }) {
  const normalised = normaliseItems(items);
  const requestHash = crypto.createHash('sha256')
    .update(JSON.stringify({ c: customer, i: normalised, l: language }))
    .digest('hex');

  return tx(() => {
    const existing = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new AppError(409, 'IDEMPOTENCY_MISMATCH', 'This checkout attempt was already used with different details');
      }
      return { order: existing, duplicate: true };
    }

    const priced = priceCart(normalised, customer.country);
    if (priced.shipping === null) throw new AppError(422, 'SHIPPING_UNAVAILABLE', 'We do not ship to that country');
    if (!priced.ok) throw new AppError(409, 'CART_INVALID', 'Some items are no longer available', { issues: priced.issues });

    for (const l of priced.lines) {
      if (!adjustStock(l.product_id, l.variant_id, -l.quantity)) {
        throw new AppError(409, 'CART_INVALID', 'Some items are no longer available', {
          issues: [{ product_id: l.product_id, variant_id: l.variant_id, code: 'INSUFFICIENT_STOCK', max_qty: 0 }],
        });
      }
    }

    let orderNumber = generateOrderNumber();
    while (getByNumber(orderNumber)) orderNumber = generateOrderNumber();

    const t = now();
    const res = db.prepare(`INSERT INTO orders (
      order_number, idempotency_key, request_hash,
      customer_first_name, customer_last_name, customer_email, customer_phone,
      shipping_address, shipping_address2, shipping_city, shipping_postal_code, shipping_country,
      currency, subtotal, shipping_cost, total, payment_status, order_status, payment_provider,
      language, terms_accepted_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'unpaid','pending',?,?,?,?,?)`).run(
      orderNumber, idempotencyKey, requestHash,
      customer.first_name, customer.last_name, customer.email, customer.phone,
      customer.address, customer.address2, customer.city, customer.postal_code, customer.country,
      priced.currency, priced.subtotal, priced.shipping, priced.total, provider,
      language, t, t, t);
    const orderId = Number(res.lastInsertRowid);

    const insertItem = db.prepare(`INSERT INTO order_items
      (order_id, product_id, variant_id, product_name, product_name_en, variant_label, variant_label_en, quantity, unit_price, total_price)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const l of priced.lines) {
      insertItem.run(orderId, l.product_id, l.variant_id, l.name, l.name_en, l.variant_label, l.variant_label_en,
        l.quantity, l.unit_price, l.line_total);
    }
    addEvent(orderId, 'customer', 'order_created', `Payment: ${provider}`);
    return { order: getById(orderId), duplicate: false };
  });
}

function attachPayment(orderId, { reference }) {
  db.prepare('UPDATE orders SET payment_reference = ?, updated_at = ? WHERE id = ?').run(reference, now(), orderId);
}

/* ------------------------------------------------- payment state changes */

/**
 * Marks an order paid. Only ever called after the payment provider confirmed the payment
 * (Stripe webhook / server-to-server lookup) or an admin confirmed a manual payment.
 * If the provider reports an amount different from what we calculated, the order is NOT marked paid.
 */
function markPaid(orderId, { amountTotal, currency, paymentIntentId, source }) {
  return tx(() => {
    const o = getById(orderId);
    if (!o) return { changed: false, missing: true };
    if (o.payment_status === 'paid') return { changed: false, order: o };
    if (amountTotal !== undefined && amountTotal !== null &&
        (Number(amountTotal) !== o.total || String(currency || '').toUpperCase() !== o.currency.toUpperCase())) {
      addEvent(o.id, 'system', 'payment_amount_mismatch', `provider=${amountTotal} ${currency}, expected=${o.total} ${o.currency}`);
      return { changed: false, mismatch: true, order: o };
    }
    const nextStatus = o.order_status === 'pending' ? 'paid' : o.order_status;
    db.prepare(`UPDATE orders SET payment_status='paid', order_status=?, paid_at=?, payment_intent_id=COALESCE(?, payment_intent_id), updated_at=? WHERE id=?`)
      .run(nextStatus, now(), paymentIntentId || null, now(), o.id);
    addEvent(o.id, source || 'system', o.order_status === 'cancelled' ? 'payment_received_after_cancel' : 'payment_confirmed', '');
    return { changed: true, order: getById(o.id) };
  });
}

/** Payment was rejected or expired after the customer already submitted it: keep the record, release the stock. */
function failPayment(orderId, source, detail) {
  return tx(() => {
    const o = getById(orderId);
    if (!o || o.payment_status === 'paid') return { changed: false, order: o };
    releaseStock(o);
    db.prepare(`UPDATE orders SET payment_status='failed', order_status='cancelled', updated_at=? WHERE id=?`).run(now(), o.id);
    addEvent(o.id, source || 'system', 'payment_failed', detail || '');
    return { changed: true, order: getById(o.id) };
  });
}

function cancelOrder(orderId, actor, detail) {
  return tx(() => {
    const o = getById(orderId);
    if (!o) throw new AppError(404, 'NOT_FOUND', 'Order not found');
    if (o.order_status === 'cancelled') return { changed: false, order: o };
    releaseStock(o);
    db.prepare(`UPDATE orders SET order_status='cancelled', updated_at=? WHERE id=?`).run(now(), o.id);
    addEvent(o.id, actor, 'order_cancelled', detail || '');
    return { changed: true, order: getById(o.id) };
  });
}

/**
 * Removes an order the customer never paid for (checkout abandoned/expired, or the payment
 * provider could not be reached) and gives the reserved stock back. Nothing partial is left behind.
 */
function voidUnpaid(orderId) {
  return tx(() => {
    const o = getById(orderId);
    if (!o) return false;
    if (o.payment_status !== 'unpaid') return false;
    releaseStock(o);
    db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
    return true;
  });
}

/* ------------------------------------------------------------ admin actions */

function setStatus(orderId, { status, tracking }, actor) {
  if (!ORDER_STATUSES.includes(status)) throw new AppError(400, 'VALIDATION', 'Unknown status', { fields: { order_status: 'invalid' } });
  const track = tracking === undefined ? undefined : String(tracking).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);

  return tx(() => {
    const o = getById(orderId);
    if (!o) throw new AppError(404, 'NOT_FOUND', 'Order not found');
    if (o.order_status === 'cancelled' && status !== 'cancelled') {
      throw new AppError(409, 'ORDER_CANCELLED', 'Cancelled orders cannot be reopened. Create a new order instead.');
    }
    if ((status === 'paid' || FULFILMENT.includes(status)) && o.payment_status !== 'paid') {
      throw new AppError(409, 'PAYMENT_NOT_CONFIRMED',
        o.payment_provider === 'manual'
          ? 'Confirm the payment first (Mark payment received).'
          : 'The payment has not been confirmed by the payment provider yet.');
    }
    if (status === 'pending' && o.payment_status === 'paid') {
      throw new AppError(409, 'INVALID_TRANSITION', 'A paid order cannot go back to pending.');
    }

    const before = o.order_status;
    if (status === 'cancelled') {
      releaseStock(o);
    }
    db.prepare(`UPDATE orders SET order_status=?, tracking_number=COALESCE(?, tracking_number), updated_at=? WHERE id=?`)
      .run(status, track === undefined ? null : track, now(), o.id);
    if (before !== status) addEvent(o.id, actor, 'status_changed', `${before} -> ${status}`);
    else if (track !== undefined && track !== o.tracking_number) addEvent(o.id, actor, 'tracking_updated', track);
    return { order: getById(o.id), changedFrom: before };
  });
}

function listAdmin({ search, status, page, limit }) {
  const where = [];
  const params = [];
  if (status && ORDER_STATUSES.includes(status)) { where.push('order_status = ?'); params.push(status); }
  const searchWhere = [];
  const searchParams = [];
  const q = String(search || '').trim().slice(0, 80);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    searchWhere.push(`(order_number LIKE ? ESCAPE '\\' OR customer_email LIKE ? ESCAPE '\\'
      OR (customer_first_name || ' ' || customer_last_name) LIKE ? ESCAPE '\\' OR customer_phone LIKE ? ESCAPE '\\')`);
    searchParams.push(like, like, like, like);
  }
  const allWhere = [...where, ...searchWhere];
  const sql = allWhere.length ? `WHERE ${allWhere.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders ${sql}`).get(...params, ...searchParams).n;
  const pg = Math.max(1, page || 1);
  const lim = Math.min(100, Math.max(1, limit || 25));
  const rows = db.prepare(`SELECT o.id, o.order_number, o.customer_first_name, o.customer_last_name, o.customer_email,
      o.total, o.currency, o.payment_status, o.order_status, o.payment_provider, o.created_at,
      (SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o ${sql}
    ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`).all(...params, ...searchParams, lim, (pg - 1) * lim);

  const countSql = searchWhere.length ? `WHERE ${searchWhere.join(' AND ')}` : '';
  const counts = {};
  for (const r of db.prepare(`SELECT order_status AS s, COUNT(*) AS n FROM orders ${countSql} GROUP BY order_status`).all(...searchParams)) counts[r.s] = r.n;

  return { orders: rows, total, page: pg, pages: Math.max(1, Math.ceil(total / lim)), counts };
}

/** Unpaid online-payment orders older than the cutoff (used by the cleanup job). */
function staleUnpaidOnlineOrders(cutoffIso) {
  return db.prepare(`SELECT * FROM orders WHERE payment_provider = 'stripe' AND payment_status = 'unpaid'
    AND order_status = 'pending' AND created_at < ?`).all(cutoffIso);
}

module.exports = {
  ORDER_STATUSES, priceCart, shippingCost, createOrder, attachPayment,
  getById, getByNumber, getByPaymentReference, loadItems, publicOrder, adminOrder,
  orderToken, tokenValid, markPaid, failPayment, cancelOrder, voidUnpaid, setStatus, listAdmin,
  staleUnpaidOnlineOrders, addEvent,
};
