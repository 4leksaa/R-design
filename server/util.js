'use strict';
const crypto = require('crypto');
const cfg = require('./config');

/** An error that is safe to show to the customer (code + generic message). */
class AppError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

function sendJson(res, status, body, headers) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...(headers || {}),
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = parseInt(req.headers['content-length'] || '0', 10);
    if (declared > limit) {
      req.resume();
      return reject(new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large'));
    }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      if (tooBig) return;
      size += chunk.length;
      if (size > limit) {
        tooBig = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) reject(new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large'));
      else resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function parseJson(buf) {
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (v === null || typeof v !== 'object') throw new Error('not an object');
    return v;
  } catch (_) {
    throw new AppError(400, 'BAD_JSON', 'Invalid JSON body');
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* ignore */ }
  }
  return out;
}

function clientIp(req) {
  if (cfg.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || 'unknown';
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ---- tiny in-memory rate limiter (single-instance) ---- */
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= t) {
    b = { count: 0, resetAt: t + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return { limited: b.count > max, retryAfter: Math.ceil((b.resetAt - t) / 1000) };
}
function rateLimitPeek(key, max) {
  const b = buckets.get(key);
  return !!(b && b.resetAt > Date.now() && b.count >= max);
}
function rateLimitReset(key) { buckets.delete(key); }
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
}, 60_000).unref();

function log(level, msg, extra) {
  // Never log request bodies or customer details.
  const line = { t: new Date().toISOString(), level, msg };
  if (extra) Object.assign(line, extra);
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = {
  AppError, sendJson, readBody, parseJson, parseCookies, clientIp, safeEqual,
  rateLimit, rateLimitPeek, rateLimitReset, log, escapeHtml,
};
