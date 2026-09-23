'use strict';
/**
 * SQLite via Node's built-in node:sqlite (Node 22.13+). No native modules to compile.
 *
 * Money is stored as INTEGER minor units (öre for SEK): 12 900 kr = 1290000.
 * Never floats, so totals can never drift by a rounding error.
 */
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

const db = new DatabaseSync(cfg.dbFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
try {
  fs.chmodSync(cfg.dbFile, 0o600);
} catch (_) { /* best effort (e.g. Windows) */ }

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                  TEXT    NOT NULL UNIQUE,
  category              TEXT    NOT NULL DEFAULT 'all',
  name                  TEXT    NOT NULL,
  name_en               TEXT    NOT NULL DEFAULT '',
  short_description     TEXT    NOT NULL DEFAULT '',
  short_description_en  TEXT    NOT NULL DEFAULT '',
  description           TEXT    NOT NULL DEFAULT '',
  description_en        TEXT    NOT NULL DEFAULT '',
  price                 INTEGER NOT NULL CHECK (price >= 0),          -- minor units (öre)
  currency              TEXT    NOT NULL,
  images                TEXT    NOT NULL DEFAULT '[]',                -- JSON array of URLs
  variants              TEXT    NOT NULL DEFAULT '[]',                -- JSON [{id,label,label_en,stock_quantity}]
  specs                 TEXT    NOT NULL DEFAULT '[]',                -- JSON [{label,value,label_en,value_en}]
  stock_quantity        INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0), -- sum of variants when variants exist
  active                INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL,
  updated_at            TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number           TEXT    NOT NULL UNIQUE,
  idempotency_key        TEXT    NOT NULL UNIQUE,
  request_hash           TEXT    NOT NULL,
  customer_first_name    TEXT    NOT NULL,
  customer_last_name     TEXT    NOT NULL,
  customer_email         TEXT    NOT NULL,
  customer_phone         TEXT    NOT NULL,
  shipping_address       TEXT    NOT NULL,
  shipping_address2      TEXT    NOT NULL DEFAULT '',
  shipping_city          TEXT    NOT NULL,
  shipping_postal_code   TEXT    NOT NULL,
  shipping_country       TEXT    NOT NULL,
  currency               TEXT    NOT NULL,
  subtotal               INTEGER NOT NULL,
  shipping_cost          INTEGER NOT NULL,
  total                  INTEGER NOT NULL,
  payment_status         TEXT    NOT NULL DEFAULT 'unpaid'
                         CHECK (payment_status IN ('unpaid','paid','failed')),
  order_status           TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (order_status IN ('pending','paid','processing','shipped','delivered','cancelled')),
  payment_provider       TEXT    NOT NULL DEFAULT 'manual',           -- 'stripe' | 'manual'
  payment_reference      TEXT,                                        -- Stripe Checkout Session id
  payment_intent_id      TEXT,
  paid_at                TEXT,
  tracking_number        TEXT    NOT NULL DEFAULT '',
  language               TEXT    NOT NULL DEFAULT 'sv',
  terms_accepted_at      TEXT,
  stock_released         INTEGER NOT NULL DEFAULT 0,                  -- 1 once reserved stock was returned
  created_at             TEXT    NOT NULL,
  updated_at             TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_email    ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_payref   ON orders(payment_reference);

-- Product name and price are copied here at purchase time, so old orders stay accurate
-- even if the product is later renamed, repriced or deleted.
CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       INTEGER REFERENCES products(id) ON DELETE SET NULL,
  variant_id       TEXT,
  product_name     TEXT    NOT NULL,
  product_name_en  TEXT    NOT NULL DEFAULT '',
  variant_label    TEXT    NOT NULL DEFAULT '',
  variant_label_en TEXT    NOT NULL DEFAULT '',
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price       INTEGER NOT NULL,
  total_price      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at        TEXT NOT NULL,
  actor     TEXT NOT NULL,
  event     TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);

CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id_hash    TEXT PRIMARY KEY,                 -- sha256 of the cookie value
  admin_id   INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,                -- provider event id, guarantees exactly-once handling
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER,
  recipient  TEXT NOT NULL,
  template   TEXT NOT NULL,
  status     TEXT NOT NULL,                    -- sent | failed | skipped
  error      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`);

try { db.exec("ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'all'"); } catch (_) { /* already migrated */ }

const now = () => new Date().toISOString();

/** Run fn inside a write transaction. fn must be synchronous. */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw err;
  }
}

module.exports = { db, tx, now };
