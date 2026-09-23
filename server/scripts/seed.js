'use strict';
/**
 * Adds a few clearly-labelled SAMPLE products so you can try the shop.
 *   npm run seed
 * Replace or delete them in the admin (/admin/) before going live.
 * Refuses to run in production unless you pass --force.
 */
const cfg = require('../config');
const catalog = require('../catalog');
const { db } = require('../db');

if (cfg.isProd && !process.argv.includes('--force')) {
  console.error('Refusing to add sample products when NODE_ENV=production (use --force if you really want to).');
  process.exit(1);
}
if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0 && !process.argv.includes('--force')) {
  console.log('Products already exist, nothing added. (Use --force to add the samples anyway.)');
  process.exit(0);
}

const img = (n) => `/assets/images/shop/${n}.svg`;
const kr = (n) => n * 100;

const samples = [
  {
    name: 'Solitaire ring i guld (exempel)', name_en: 'Gold solitaire ring (sample)',
    short_description: 'En ren siluett med handgjord känsla och mjuk gyllene lyster.',
    short_description_en: 'A clean silhouette with a handcrafted feel and warm golden allure.',
    description: 'En tidlös ring med en mjuk, skulptural form och en ljus sten som fångar varje rörelse.\n\nEtt smycke att bära varje dag och spara länge.',
    description_en: 'A timeless ring with a soft sculptural form and a luminous stone that catches every movement.\n\nA piece to wear every day and keep for years.',
    price: kr(12900), sort_order: 1,
    images: [img('ring-gold')],
    variants: [
      { label: 'Storlek 16', label_en: 'Size 16', stock_quantity: 3 },
      { label: 'Storlek 18', label_en: 'Size 18', stock_quantity: 2 },
    ],
    specs: [
      { label: 'Material', label_en: 'Material', value: '18k guld', value_en: '18k gold' },
      { label: 'Sten', label_en: 'Stone', value: 'Lab-grown diamant', value_en: 'Lab-grown diamond' },
    ],
  },
  {
    name: 'Örhängen Sol i guld (exempel)', name_en: 'Gold Sun earrings (sample)',
    short_description: 'Lätta vardagsörhängen med en diskret solglans.',
    short_description_en: 'Light everyday earrings with a quiet sunlit shine.',
    description: 'Ett par eleganta örhängen som ger en mjuk glimt utan att ta över.\n\nDesignade för att följa med från morgon till kväll.',
    description_en: 'A pair of elegant earrings that add a soft glint without taking over.\n\nDesigned to follow you from morning to evening.',
    price: kr(18500), sort_order: 2,
    images: [img('earrings-gold')],
    stock_quantity: 1,
    specs: [
      { label: 'Material', label_en: 'Material', value: 'Förgyllt silver', value_en: 'Gold-plated silver' },
      { label: 'Stängning', label_en: 'Closure', value: 'Stift', value_en: 'Post fastening' },
    ],
  },
  {
    name: 'Halsband Lumen (exempel)', name_en: 'Lumen necklace (sample)',
    short_description: 'Ett nätt hänge som lyser upp en enkel siluett.',
    short_description_en: 'A delicate pendant that brightens a simple silhouette.',
    description: 'Lumen är ett vardagssmycke med en mjuk geometrisk form och en kedja som faller vackert mot huden.',
    description_en: 'Lumen is an everyday piece with a soft geometric form and a chain that falls beautifully against the skin.',
    price: kr(24900), sort_order: 3,
    images: [img('necklace-gold')],
    variants: [
      { label: 'Stålgrå urtavla', label_en: 'Steel dial', stock_quantity: 4 },
      { label: 'Svart urtavla', label_en: 'Black dial', stock_quantity: 0 },
    ],
    specs: [
      { label: 'Material', label_en: 'Material', value: '18k guld', value_en: '18k gold' },
      { label: 'Kedja', label_en: 'Chain', value: '45 cm', value_en: '45 cm' },
    ],
  },
  {
    name: 'Armband Aura (exempel)', name_en: 'Aura bracelet (sample)',
    short_description: 'Ett mjukt, lättburet armband med modern gulddetalj.',
    short_description_en: 'A soft, easy-to-wear bracelet with a modern gold detail.',
    description: 'Aura kombinerar en ren linje med en liten central detalj. Ett personligt lager på handleden, även när det bärs ensamt.',
    description_en: 'Aura combines a clean line with a small central detail. A personal layer on the wrist, even when worn alone.',
    price: kr(9800), sort_order: 4,
    images: [img('bracelet-gold')],
    stock_quantity: 0,
    specs: [
      { label: 'Material', label_en: 'Material', value: 'Förgyllt silver', value_en: 'Gold-plated silver' },
      { label: 'Längd', label_en: 'Length', value: '18 cm', value_en: '18 cm' },
    ],
  },
].map((p) => ({ ...p, active: true }));

for (const s of samples) {
  const p = catalog.createProduct(s);
  console.log(`+ ${p.name}  (${p.slug})`);
}
console.log('Sample products added. Manage them at /admin/');
