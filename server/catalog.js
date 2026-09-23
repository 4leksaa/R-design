'use strict';
const cfg = require('./config');
const { db, now } = require('./db');
const { AppError } = require('./util');
const { clean } = require('./validation');

const CATEGORIES = ['all', 'rings', 'earrings', 'necklaces', 'bracelets', 'sale'];

/* ----------------------------------------------------------------- helpers */

function hydrate(row) {
  if (!row) return null;
  const parse = (s) => { try { return JSON.parse(s || '[]'); } catch (_) { return []; } };
  return { ...row, images: parse(row.images), variants: parse(row.variants), specs: parse(row.specs), active: !!row.active };
}

const getById = (id) => hydrate(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
const getBySlug = (slug) => hydrate(db.prepare('SELECT * FROM products WHERE slug = ?').get(slug));
const listAll = () => db.prepare('SELECT * FROM products ORDER BY sort_order ASC, id DESC').all().map(hydrate);
const listActive = () => db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort_order ASC, id DESC').all().map(hydrate);

function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'produkt';
}

function uniqueSlug(base, ignoreId) {
  let slug = base;
  let n = 1;
  for (;;) {
    const row = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
    if (!row || row.id === ignoreId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

/**
 * Stock lookup for one cart line. Products with variants track stock per variant
 * (a variant is required); products without variants use the product's own stock.
 */
function stockOf(p, variantId) {
  if (p.variants.length > 0) {
    const v = variantId ? p.variants.find((x) => x.id === variantId) : null;
    if (!v) return { validVariant: false, available: 0, variant: null };
    return { validVariant: true, available: v.stock_quantity, variant: v };
  }
  if (variantId) return { validVariant: false, available: 0, variant: null };
  return { validVariant: true, available: p.stock_quantity, variant: null };
}

const sumVariantStock = (variants) => variants.reduce((n, v) => n + v.stock_quantity, 0);

function stockStatus(n) {
  if (n <= 0) return 'out_of_stock';
  if (n <= cfg.lowStockThreshold) return 'low_stock';
  return 'in_stock';
}

/** What any visitor may see. Exact stock is only revealed when it is low. */
function toPublic(p) {
  const pubStock = (n) => ({
    stock_status: stockStatus(n),
    stock_left: n > 0 && n <= cfg.lowStockThreshold ? n : null,
    max_qty: Math.min(Math.max(n, 0), cfg.maxQtyPerLine),
  });
  return {
    id: p.id, slug: p.slug, category: p.category || 'all',
    name: p.name, name_en: p.name_en,
    short_description: p.short_description, short_description_en: p.short_description_en,
    description: p.description, description_en: p.description_en,
    price: p.price, currency: p.currency,
    images: p.images, specs: p.specs,
    variants: p.variants.map((v) => ({ id: v.id, label: v.label, label_en: v.label_en, ...pubStock(v.stock_quantity) })),
    ...pubStock(p.stock_quantity),
  };
}

const toAdmin = (p) => ({ ...p });

/* -------------------------------------------------------- admin validation */

const IMAGE_URL = /^\/(uploads|assets)\/[A-Za-z0-9._\/-]+$/;

function validateProductInput(body) {
  const src = body && typeof body === 'object' ? body : {};
  const errors = {};
  const v = {};

  const text = (field, max, required) => {
    const s = String(src[field] == null ? '' : src[field]).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    v[field] = s;
    if (required && !s) errors[field] = 'required';
    else if (s.length > max) errors[field] = 'too_long';
  };
  text('name', 120, true);
  text('name_en', 120, false);
  text('short_description', 240, false);
  text('short_description_en', 240, false);
  text('description', 8000, false);
  text('description_en', 8000, false);
  v.category = CATEGORIES.includes(src.category) ? src.category : 'all';

  const price = Number(src.price);
  if (!Number.isInteger(price) || price < 0 || price > 100_000_000) errors.price = 'invalid';
  else v.price = price;

  v.active = src.active === true || src.active === 1 || src.active === '1' ? 1 : 0;
  const sort = Number(src.sort_order);
  v.sort_order = Number.isInteger(sort) ? Math.max(-10000, Math.min(10000, sort)) : 0;

  // images
  const images = Array.isArray(src.images) ? src.images : [];
  if (images.length > 12) errors.images = 'too_many';
  v.images = images.map(String);
  if (v.images.some((u) => !IMAGE_URL.test(u) || u.includes('..'))) errors.images = 'invalid';

  // variants
  const rawVariants = Array.isArray(src.variants) ? src.variants : [];
  if (rawVariants.length > 20) errors.variants = 'too_many';
  const seen = new Set();
  v.variants = [];
  for (const rv of rawVariants.slice(0, 20)) {
    const label = clean(rv && rv.label);
    if (!label) { errors.variants = 'invalid'; break; }
    const stock = Number(rv.stock_quantity);
    if (!Number.isInteger(stock) || stock < 0 || stock > 100000) { errors.variants = 'invalid'; break; }
    let id = clean(rv.id).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) id = slugify(label).slice(0, 30);
    let unique = id;
    for (let i = 2; seen.has(unique); i += 1) unique = `${id}-${i}`;
    seen.add(unique);
    v.variants.push({ id: unique, label: label.slice(0, 60), label_en: clean(rv.label_en).slice(0, 60), stock_quantity: stock });
  }

  // specs
  const rawSpecs = Array.isArray(src.specs) ? src.specs : [];
  if (rawSpecs.length > 30) errors.specs = 'too_many';
  v.specs = rawSpecs.slice(0, 30)
    .map((s) => ({
      label: clean(s && s.label).slice(0, 60), value: clean(s && s.value).slice(0, 200),
      label_en: clean(s && s.label_en).slice(0, 60), value_en: clean(s && s.value_en).slice(0, 200),
    }))
    .filter((s) => s.label && s.value);

  // stock
  if (v.variants.length > 0) {
    v.stock_quantity = sumVariantStock(v.variants);
  } else {
    const stock = Number(src.stock_quantity);
    if (!Number.isInteger(stock) || stock < 0 || stock > 100000) errors.stock_quantity = 'invalid';
    else v.stock_quantity = stock;
  }

  v.slug = clean(src.slug).toLowerCase();
  if (v.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.slug)) errors.slug = 'invalid';

  return { values: v, errors, ok: Object.keys(errors).length === 0 };
}

function createProduct(input) {
  const { values: v, errors, ok } = validateProductInput(input);
  if (!ok) throw new AppError(400, 'VALIDATION', 'Invalid product', { fields: errors });
  const slug = uniqueSlug(v.slug || slugify(v.name));
  const t = now();
  const res = db.prepare(`INSERT INTO products
    (slug,category,name,name_en,short_description,short_description_en,description,description_en,price,currency,
     images,variants,specs,stock_quantity,active,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    slug, v.category, v.name, v.name_en, v.short_description, v.short_description_en, v.description, v.description_en,
    v.price, cfg.currency, JSON.stringify(v.images), JSON.stringify(v.variants), JSON.stringify(v.specs),
    v.stock_quantity, v.active, v.sort_order, t, t);
  return getById(Number(res.lastInsertRowid));
}

function updateProduct(id, input) {
  const existing = getById(id);
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Product not found');
  const { values: v, errors, ok } = validateProductInput(input);
  if (!ok) throw new AppError(400, 'VALIDATION', 'Invalid product', { fields: errors });
  const slug = uniqueSlug(v.slug || existing.slug, id);
  db.prepare(`UPDATE products SET slug=?,category=?,name=?,name_en=?,short_description=?,short_description_en=?,description=?,
    description_en=?,price=?,images=?,variants=?,specs=?,stock_quantity=?,active=?,sort_order=?,updated_at=? WHERE id=?`).run(
    slug, v.category, v.name, v.name_en, v.short_description, v.short_description_en, v.description, v.description_en,
    v.price, JSON.stringify(v.images), JSON.stringify(v.variants), JSON.stringify(v.specs),
    v.stock_quantity, v.active, v.sort_order, now(), id);
  return getById(id);
}

function deleteProduct(id) {
  const res = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (!res.changes) throw new AppError(404, 'NOT_FOUND', 'Product not found');
}

module.exports = {
  hydrate, getById, getBySlug, listAll, listActive, stockOf, stockStatus, sumVariantStock,
  toPublic, toAdmin, validateProductInput, createProduct, updateProduct, deleteProduct, slugify, CATEGORIES,
};
