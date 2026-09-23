'use strict';
const cfg = require('./config');

const COUNTRY_NAMES = {
  SE: ['Sverige', 'Sweden'], NO: ['Norge', 'Norway'], DK: ['Danmark', 'Denmark'],
  FI: ['Finland', 'Finland'], DE: ['Tyskland', 'Germany'], NL: ['Nederländerna', 'Netherlands'],
  BE: ['Belgien', 'Belgium'], FR: ['Frankrike', 'France'], ES: ['Spanien', 'Spain'],
  IT: ['Italien', 'Italy'], AT: ['Österrike', 'Austria'], PL: ['Polen', 'Poland'],
  IE: ['Irland', 'Ireland'], GB: ['Storbritannien', 'United Kingdom'], CH: ['Schweiz', 'Switzerland'],
  EE: ['Estland', 'Estonia'], LV: ['Lettland', 'Latvia'], LT: ['Litauen', 'Lithuania'],
  PT: ['Portugal', 'Portugal'], LU: ['Luxemburg', 'Luxembourg'], CZ: ['Tjeckien', 'Czechia'],
  IS: ['Island', 'Iceland'], GR: ['Grekland', 'Greece'], HU: ['Ungern', 'Hungary'],
};

function countryList() {
  return Object.keys(cfg.shippingRates).map((code) => ({
    code,
    name: (COUNTRY_NAMES[code] || [code, code])[0], // Swedish; name_en is the English name
    name_en: (COUNTRY_NAMES[code] || [code, code])[1],
    shipping: cfg.shippingRates[code],
  }));
}

const POSTAL = {
  SE: /^\d{3}\s?\d{2}$/, NO: /^\d{4}$/, DK: /^\d{4}$/, FI: /^\d{5}$/, DE: /^\d{5}$/,
  NL: /^\d{4}\s?[A-Za-z]{2}$/, BE: /^\d{4}$/, AT: /^\d{4}$/, FR: /^\d{5}$/, ES: /^\d{5}$/,
  IT: /^\d{5}$/, PL: /^\d{2}-?\d{3}$/, CH: /^\d{4}$/,
};
const POSTAL_GENERIC = /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/;

// Strip control characters (also blocks header/log injection) and collapse whitespace.
const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Validates the checkout form. Returns { values, errors } where errors maps
 * field name -> error code ('required' | 'invalid' | 'too_long' | 'unsupported').
 * The browser shows friendly translated text for each code.
 */
function validateCustomer(input) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = {};
  const v = {};

  const text = (field, { max, min = 1, required = true }) => {
    const value = clean(src[field]);
    v[field] = value;
    if (!value) { if (required) errors[field] = 'required'; return; }
    if (value.length > max) errors[field] = 'too_long';
    else if (value.length < min) errors[field] = 'invalid';
  };

  text('first_name', { max: 60 });
  text('last_name', { max: 60 });
  text('address', { max: 120, min: 3 });
  text('address2', { max: 60, required: false });
  text('city', { max: 80, min: 2 });

  // email
  v.email = clean(src.email).toLowerCase().replace(/\s/g, '');
  if (!v.email) errors.email = 'required';
  else if (v.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) errors.email = 'invalid';

  // phone
  v.phone = clean(src.phone);
  if (!v.phone) errors.phone = 'required';
  else {
    const digits = v.phone.replace(/\D/g, '');
    if (!/^[+()\d][\d\s()+.-]{5,24}$/.test(v.phone) || digits.length < 7 || digits.length > 15) errors.phone = 'invalid';
  }

  // country + postal code
  v.country = clean(src.country).toUpperCase();
  if (!v.country) errors.country = 'required';
  else if (cfg.shippingRates[v.country] === undefined) errors.country = 'unsupported';

  v.postal_code = clean(src.postal_code);
  if (!v.postal_code) errors.postal_code = 'required';
  else {
    const pattern = POSTAL[v.country] || POSTAL_GENERIC;
    if (!pattern.test(v.postal_code)) errors.postal_code = 'invalid';
    else if (v.country === 'SE') v.postal_code = v.postal_code.replace(/^(\d{3})\s?(\d{2})$/, '$1 $2');
  }

  return { values: v, errors, ok: Object.keys(errors).length === 0 };
}

module.exports = { validateCustomer, countryList, COUNTRY_NAMES, clean };
