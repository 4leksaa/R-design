'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { db } = require('./db');
const { dispatch } = require('./routes');
const orders = require('./orders');
const payments = require('./payments');
const auth = require('./auth');
const { AppError, sendJson, log } = require('./util');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "connect-src 'self' https://formspree.io",
  'frame-src https://www.google.com https://maps.google.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://formspree.io",
  "object-src 'none'",
].join('; ');

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (cfg.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/* ------------------------------------------------------------ static files */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function serveFile(req, res, file, { immutable = false, sandbox = false, status = 200 } = {}) {
  let st;
  try { st = fs.statSync(file); } catch (_) { return false; }
  if (!st.isFile()) return false;

  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': type,
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    'Accept-Ranges': 'bytes',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable'
      : ['.html', '.css', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=86400',
  };
  if (sandbox) headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

  if (status === 200 && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }

  let start = 0;
  let end = st.size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && status === 200 && (range[1] || range[2])) {
    if (range[1]) { start = parseInt(range[1], 10); if (range[2]) end = Math.min(end, parseInt(range[2], 10)); }
    else { start = Math.max(0, st.size - parseInt(range[2], 10)); }
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      res.end();
      return true;
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    status = 206;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || st.size === 0) { res.end(); return true; }
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  return true;
}

function within(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

function resolveUnder(root, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (_) { return null; }
  if (p.includes('\0')) return null;
  const abs = path.join(root, path.normalize(p));
  if (!within(root, abs)) return null;
  if (path.relative(root, abs).split(path.sep).some((seg) => seg.startsWith('.'))) return null; // no dotfiles
  return abs;
}

function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  const pathname = url.pathname;

  if (pathname.startsWith('/uploads/')) {
    const file = resolveUnder(cfg.uploadDir, pathname.slice('/uploads'.length));
    if (file && serveFile(req, res, file, { immutable: true, sandbox: true })) return;
    return notFound(req, res);
  }

  if (pathname.startsWith('/admin')) res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  let file = resolveUnder(cfg.publicDir, pathname);
  if (!file) return notFound(req, res);
  let st = null;
  try { st = fs.statSync(file); } catch (_) { /* maybe clean URL */ }
  if (st && st.isDirectory()) {
    if (!pathname.endsWith('/')) { res.writeHead(301, { Location: `${pathname}/${url.search}` }); return res.end(); }
    file = path.join(file, 'index.html');
  } else if (!st && !path.extname(file)) {
    file += '.html';
  }
  if (!serveFile(req, res, file)) return notFound(req, res);
}

function notFound(req, res) {
  const page = path.join(cfg.publicDir, '404.html');
  if (!serveFile(req, res, page, { status: 404 })) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

/* ------------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      db.prepare('SELECT 1').get();
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) await dispatch(req, res, url);
    else serveStatic(req, res, url);
  } catch (err) {
    if (res.headersSent) return res.end();
    if (err instanceof AppError) {
      const body = { error: { code: err.code, message: err.message, ...(err.extra || {}) } };
      const headers = err.status === 429 ? { 'Retry-After': '60' } : undefined;
      if (req.url.startsWith('/api/') || req.headers.accept === 'application/json') return sendJson(res, err.status, body, headers);
      if (err.status === 404) return notFound(req, res);
      res.writeHead(err.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(err.message);
    }
    // Unexpected: log the detail on the server, show the customer nothing technical.
    log('error', 'unhandled_error', { path: req.url.split('?')[0], err: String(err && err.stack || err) });
    return sendJson(res, 500, { error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } });
  }
});
server.requestTimeout = 60_000;

/* ------------------------------------------------------------- cleanup job */

let sweeping = false;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    auth.purgeExpiredSessions();
    // Release stock held by online-payment orders that were never paid (customer closed the tab, etc.).
    const cutoff = new Date(Date.now() - cfg.unpaidOrderTtlMinutes * 60_000).toISOString();
    for (const o of orders.staleUnpaidOnlineOrders(cutoff)) {
      try {
        if (!o.payment_reference || !payments.enabled()) { orders.voidUnpaid(o.id); continue; }
        if ((await payments.closeSession(o)) === 'complete') await payments.reconcile(o);
        else orders.voidUnpaid(o.id);
      } catch (err) {
        log('error', 'sweep_order_failed', { order: o.order_number, code: err.code });
      }
    }
  } catch (err) {
    log('error', 'sweep_failed', { err: String(err && err.message || err) });
  } finally {
    sweeping = false;
  }
}

function start() {
  server.listen(cfg.port, () => {
    log('info', 'listening', { url: cfg.publicUrl, port: cfg.port, payments: payments.enabled() ? 'stripe' : 'manual', email: !!(cfg.resendApiKey && cfg.mailFrom) });
    const warn = (msg) => log('warn', msg);
    if (!db.prepare('SELECT 1 FROM admin_users LIMIT 1').get()) warn('No admin user yet. Run: npm run create-admin');
    if (payments.enabled() && !cfg.stripeWebhookSecret) warn('STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing: paid orders can only be confirmed when the customer returns to the site.');
    if (!payments.enabled()) warn('Stripe is not configured: orders are saved as unpaid and payment is confirmed manually in the admin.');
    if (cfg.isProd && !cfg.secretFromEnv) warn('SECRET_KEY is not set in the environment.');
    if (cfg.isProd && !cfg.publicUrl.startsWith('https://')) warn('PUBLIC_URL is not https. Use HTTPS in production.');
  });
  setTimeout(sweep, 5000).unref();
  setInterval(sweep, cfg.sweepIntervalSeconds * 1000).unref();
}

function shutdown() {
  server.close(() => { try { db.close(); } catch (_) { /* ignore */ } process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (require.main === module) start();
module.exports = { server, start, sweep };
