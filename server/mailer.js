'use strict';
/**
 * Sends order emails through Resend's REST API (https://resend.com).
 * If RESEND_API_KEY / MAIL_FROM are not set, nothing is sent and the attempt is logged as "skipped".
 * Emails are sent after the order is safely saved and never block or fail an order.
 */
const cfg = require('./config');
const orders = require('./orders');
const { db, now } = require('./db');
const { escapeHtml: esc, log } = require('./util');

const enabled = () => !!(cfg.resendApiKey && cfg.mailFrom);

function money(minor, currency, lang) {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat(lang === 'en' ? 'en-SE' : 'sv-SE', {
    style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  }).format(minor / 100);
}

async function send({ to, subject, html, text, orderId, template }) {
  const record = (status, error) => db.prepare(
    'INSERT INTO email_log (order_id, recipient, template, status, error, created_at) VALUES (?,?,?,?,?,?)')
    .run(orderId || null, to, template, status, error || '', now());

  if (!enabled()) { record('skipped', 'email provider not configured'); return; }
  try {
    const res = await fetch(`${cfg.resendApiBase}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.mailFrom, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`provider returned ${res.status}`);
    record('sent');
  } catch (err) {
    record('failed', String(err.message || err).slice(0, 200));
    log('error', 'email_failed', { template, order: orderId });
  }
}

/** Run in the background so a slow mail provider never delays the customer. */
const later = (fn) => setImmediate(() => { Promise.resolve().then(fn).catch((e) => log('error', 'mail_task_failed', { err: String(e.message || e) })); });

/* ---------------------------------------------------------------- template */

const T = {
  sv: {
    subject: (o) => `Orderbekräftelse ${o.order_number}`,
    hello: (o) => `Hej ${o.customer_first_name},`,
    thanks: 'Tack för din beställning hos ' + cfg.shopName + '!',
    number: 'Ordernummer', items: 'Din beställning', qty: 'Antal', shipping: 'Frakt', total: 'Totalt',
    address: 'Leveransadress', view: 'Se din order', free: 'Fri frakt',
    paid: 'Vi har tagit emot din betalning.',
    manual: cfg.manualPaymentInstructions.sv,
    shippedSubject: (o) => `Din order ${o.order_number} har skickats`,
    shippedBody: 'Din order är nu skickad.', tracking: 'Spårningsnummer',
    failedSubject: (o) => `Betalningen för order ${o.order_number} genomfördes inte`,
    failedBody: 'Din betalning genomfördes inte och ordern har avbrutits. Inget har dragits från ditt konto. Du är välkommen att göra en ny beställning.',
    footer: `${cfg.shopName}, ${cfg.shopAddress}`,
  },
  en: {
    subject: (o) => `Order confirmation ${o.order_number}`,
    hello: (o) => `Hi ${o.customer_first_name},`,
    thanks: 'Thank you for your order with ' + cfg.shopName + '!',
    number: 'Order number', items: 'Your order', qty: 'Qty', shipping: 'Shipping', total: 'Total',
    address: 'Delivery address', view: 'View your order', free: 'Free shipping',
    paid: 'We have received your payment.',
    manual: cfg.manualPaymentInstructions.en,
    shippedSubject: (o) => `Your order ${o.order_number} has shipped`,
    shippedBody: 'Your order is on its way.', tracking: 'Tracking number',
    failedSubject: (o) => `Payment for order ${o.order_number} did not go through`,
    failedBody: 'Your payment did not go through and the order has been cancelled. You have not been charged. You are welcome to place a new order.',
    footer: `${cfg.shopName}, ${cfg.shopAddress}`,
  },
};

function wrap(lang, bodyHtml) {
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f7f6f3;padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e1da;">
<tr><td style="background:#0b2545;color:#ffffff;padding:22px 32px;font-family:Georgia,serif;font-size:18px;letter-spacing:.04em;">${esc(cfg.shopName)}</td></tr>
<tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1c1e22;">${bodyHtml}</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid #e3e1da;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#55595f;">${esc(T[lang].footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

function orderBlock(o, items, lang) {
  const t = T[lang];
  const name = (i) => {
    const n = (lang === 'en' && i.product_name_en) || i.product_name;
    const v = (lang === 'en' && i.variant_label_en) || i.variant_label;
    return v ? `${n} (${v})` : n;
  };
  const rows = items.map((i) => `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #e3e1da;">${esc(name(i))}</td>
    <td style="padding:8px 8px;border-bottom:1px solid #e3e1da;text-align:center;">${i.quantity}</td>
    <td style="padding:8px 0;border-bottom:1px solid #e3e1da;text-align:right;">${esc(money(i.total_price, o.currency, lang))}</td></tr>`).join('');
  const ship = o.shipping_cost === 0 ? t.free : money(o.shipping_cost, o.currency, lang);
  const addr = [o.shipping_address, o.shipping_address2, `${o.shipping_postal_code} ${o.shipping_city}`, o.shipping_country].filter(Boolean).map(esc).join('<br>');
  return `<p style="margin:0 0 4px;color:#55595f;">${t.number}</p>
    <p style="margin:0 0 24px;font-family:Georgia,serif;font-size:22px;">${esc(o.order_number)}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;">
      <tr><th align="left" style="padding-bottom:6px;color:#55595f;font-weight:normal;">${t.items}</th><th style="color:#55595f;font-weight:normal;">${t.qty}</th><th></th></tr>
      ${rows}
      <tr><td colspan="2" style="padding:8px 0;">${t.shipping}</td><td style="padding:8px 0;text-align:right;">${esc(ship)}</td></tr>
      <tr><td colspan="2" style="padding:8px 0;font-weight:bold;">${t.total}</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${esc(money(o.total, o.currency, lang))}</td></tr>
    </table>
    <p style="margin:24px 0 4px;color:#55595f;">${t.address}</p>
    <p style="margin:0 0 24px;">${esc(o.customer_first_name)} ${esc(o.customer_last_name)}<br>${addr}</p>`;
}

function orderUrl(o) {
  return `${cfg.publicUrl}/bekraftelse.html?order=${encodeURIComponent(o.order_number)}&t=${encodeURIComponent(orders.orderToken(o.order_number))}`;
}

const button = (href, label) => `<p style="margin:24px 0 0;"><a href="${esc(href)}" style="background:#0b2545;color:#ffffff;text-decoration:none;padding:13px 26px;display:inline-block;">${esc(label)}</a></p>`;

/* ------------------------------------------------------------ public hooks */

/** Order is placed and payment is confirmed (or, in manual mode, placed and awaiting payment). */
function confirmation(order, { paid }) {
  const lang = order.language === 'en' ? 'en' : 'sv';
  const t = T[lang];
  const items = orders.loadItems(order.id);
  const note = paid ? t.paid : t.manual;
  const html = wrap(lang, `<p style="margin:0 0 12px;">${esc(t.hello(order))}</p><p style="margin:0 0 24px;">${esc(t.thanks)} ${esc(note)}</p>
    ${orderBlock(order, items, lang)}${button(orderUrl(order), t.view)}`);
  const text = `${t.hello(order)}\n\n${t.thanks} ${note}\n\n${t.number}: ${order.order_number}\n${t.total}: ${money(order.total, order.currency, lang)}\n\n${orderUrl(order)}\n`;
  return send({ to: order.customer_email, subject: t.subject(order), html, text, orderId: order.id, template: paid ? 'order_confirmation' : 'order_received_unpaid' });
}

function notifyOwner(order, { paid }) {
  if (!cfg.orderNotifyEmail) return;
  const items = orders.loadItems(order.id);
  const html = wrap('sv', `<p style="margin:0 0 16px;">${paid ? 'Ny betald order' : 'Ny order (väntar på betalning)'}.</p>${orderBlock(order, items, 'sv')}
    <p style="margin:0;">Kund: ${esc(order.customer_email)}, ${esc(order.customer_phone)}</p>${button(`${cfg.publicUrl}/admin/#/orders/${order.id}`, 'Öppna i admin')}`);
  return send({
    to: cfg.orderNotifyEmail, subject: `${paid ? 'Ny betald order' : 'Ny order'} ${order.order_number}`, html,
    text: `${order.order_number}: ${money(order.total, order.currency, 'sv')} (${paid ? 'betald' : 'ej betald'})\n${cfg.publicUrl}/admin/#/orders/${order.id}`,
    orderId: order.id, template: 'owner_notification',
  });
}

const onPaid = (order) => later(async () => { await confirmation(order, { paid: true }); await notifyOwner(order, { paid: true }); });
const onManualMarkedPaid = (order) => later(() => confirmation(order, { paid: true }));
const onManualOrderPlaced = (order) => later(async () => { await confirmation(order, { paid: false }); await notifyOwner(order, { paid: false }); });

const onPaymentFailed = (order) => later(() => {
  const lang = order.language === 'en' ? 'en' : 'sv';
  const t = T[lang];
  return send({
    to: order.customer_email, subject: t.failedSubject(order),
    html: wrap(lang, `<p style="margin:0 0 12px;">${esc(t.hello(order))}</p><p style="margin:0;">${esc(t.failedBody)}</p>${button(`${cfg.publicUrl}/butik.html`, cfg.shopName)}`),
    text: `${t.hello(order)}\n\n${t.failedBody}\n`, orderId: order.id, template: 'payment_failed',
  });
});

const onShipped = (order) => later(() => {
  const lang = order.language === 'en' ? 'en' : 'sv';
  const t = T[lang];
  const tracking = order.tracking_number ? `<p style="margin:16px 0 0;"><strong>${t.tracking}:</strong> ${esc(order.tracking_number)}</p>` : '';
  return send({
    to: order.customer_email, subject: t.shippedSubject(order),
    html: wrap(lang, `<p style="margin:0 0 12px;">${esc(t.hello(order))}</p><p style="margin:0;">${esc(t.shippedBody)} (${esc(order.order_number)})</p>${tracking}${button(orderUrl(order), t.view)}`),
    text: `${t.hello(order)}\n\n${t.shippedBody} (${order.order_number})\n${order.tracking_number ? `${t.tracking}: ${order.tracking_number}\n` : ''}\n${orderUrl(order)}\n`,
    orderId: order.id, template: 'order_shipped',
  });
});

module.exports = { enabled, onPaid, onManualOrderPlaced, onManualMarkedPaid, onPaymentFailed, onShipped };
