'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const cfg = require('./config');
const { db, now } = require('./db');
const { AppError, parseCookies, safeEqual } = require('./util');

const scrypt = promisify(crypto.scrypt);
const COOKIE = cfg.secureCookies ? '__Host-mwc_admin' : 'mwc_admin';
const SESSION_HOURS = 12;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const hash = await scrypt(password, salt, 64, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

// Used so that "unknown email" takes as long as "wrong password".
let dummyHash = null;
async function burnTime(password) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}

async function login(email, password) {
  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user) { await burnTime(String(password || '')); return null; }
  if (!(await verifyPassword(String(password || ''), user.password_hash))) return null;
  db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').run(now(), user.id);
  return user;
}

function createSession(adminId) {
  const id = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  db.prepare('INSERT INTO admin_sessions (id_hash, admin_id, csrf_token, created_at, expires_at) VALUES (?,?,?,?,?)')
    .run(sha256(id), adminId, csrf, now(), expires);
  return { id, csrf };
}

function sessionCookie(id) {
  const parts = [`${COOKIE}=${encodeURIComponent(id)}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_HOURS * 3600}`];
  if (cfg.secureCookies) parts.push('Secure');
  return parts.join('; ');
}
function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cfg.secureCookies ? '; Secure' : ''}`;
}

/** Returns { admin: {id,email}, csrf, sessionId } or null. */
function getSession(req) {
  const id = parseCookies(req.headers.cookie)[COOKIE];
  if (!id) return null;
  const row = db.prepare(`SELECT s.csrf_token, s.expires_at, s.id_hash, u.id AS admin_id, u.email
    FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id WHERE s.id_hash = ?`).get(sha256(id));
  if (!row || row.expires_at <= now()) return null;
  return { admin: { id: row.admin_id, email: row.email }, csrf: row.csrf_token, sessionHash: row.id_hash };
}

function destroySession(req) {
  const id = parseCookies(req.headers.cookie)[COOKIE];
  if (id) db.prepare('DELETE FROM admin_sessions WHERE id_hash = ?').run(sha256(id));
}

function purgeExpiredSessions() {
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now());
}

/** Throws unless the request has a valid admin session (and, for writes, a valid CSRF token). */
function requireAdmin(req) {
  const session = getSession(req);
  if (!session) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  if (!['GET', 'HEAD'].includes(req.method)) {
    if (!safeEqual(req.headers['x-csrf-token'] || '', session.csrf)) throw new AppError(403, 'CSRF', 'Invalid request token');
  }
  return session;
}

async function createAdmin(email, password) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new Error('That does not look like an email address.');
  if (String(password || '').length < 12) throw new Error('Use a password with at least 12 characters.');
  const hash = await hashPassword(password);
  const existing = db.prepare('SELECT id FROM admin_users WHERE email = ?').get(e);
  if (existing) {
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(existing.id);
    return { email: e, updated: true };
  }
  db.prepare('INSERT INTO admin_users (email, password_hash, created_at) VALUES (?,?,?)').run(e, hash, now());
  return { email: e, updated: false };
}

module.exports = {
  login, createSession, sessionCookie, clearCookie, getSession, destroySession, purgeExpiredSessions,
  requireAdmin, createAdmin, hashPassword, verifyPassword,
};
