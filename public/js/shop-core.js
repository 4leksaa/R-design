/* ==========================================================================
  Rasch o Q Design — shop core (language strings, API client, cart store)
   The browser never decides prices or stock: it only sends product ids,
   variants and quantities. The server answers with the real numbers.
   ========================================================================== */
(function () {
  "use strict";

  var MWC = (window.MWC = window.MWC || {});
  var CART_KEY = "mwc-cart";

  /* ---------------------------------------------------------------- strings */
  var STR = {
    sv: {
      add_to_cart: "Lägg i varukorg", choose_variant: "Välj variant", sold_out: "Slutsåld",
      in_stock: "I lager", low_stock: "Endast {n} kvar", out_of_stock: "Slut i lager",
      added: "Lades i varukorgen", view_cart: "Visa varukorg", max_in_cart: "Du har redan max antal i varukorgen.",
      loading: "Laddar…", retry: "Försök igen",
      load_error: "Vi kunde inte hämta smyckena just nu.",
      shop_empty_h: "Inga smycken i butiken just nu", shop_empty_p: "Nya smycken läggs upp löpande. Hör av dig om du söker något särskilt.",
      contact_us: "Kontakta oss", back_to_shop: "Tillbaka till butiken", continue_shopping: "Fortsätt handla",
      not_found_h: "Smycket hittades inte", not_found_p: "Det kan ha sålts eller tagits bort.",
      variant: "Variant", quantity: "Antal", description: "Beskrivning", specs: "Specifikationer",
      cart_empty_h: "Din varukorg är tom", cart_empty_p: "Titta gärna på våra smycken.",
      remove: "Ta bort", each: "{price} per styck", subtotal: "Delsumma", shipping: "Frakt", total: "Totalt",
      free_shipping: "Fri frakt", ship_to: "Leverans till", checkout: "Till kassan", order_summary: "Orderöversikt",
      free_ship_hint: "Handla för {amount} till så blir frakten gratis.",
      shipping_incl: "Fraktkostnad beräknas för valt land.",
      removed_unavailable: "{name} har tagits bort eftersom den inte längre är tillgänglig.",
      reduced_qty: "Antalet för {name} har sänkts till {n} efter lagersaldo.",
      inc: "Öka antal", dec: "Minska antal",
      pay_note_stripe: "Du skickas till vår betalleverantör Stripe för att betala säkert. Kortuppgifter lämnas aldrig till oss.",
      pay_note_manual: "Efter beställningen får du betalningsinstruktioner via e-post. Beställningen reserveras åt dig.",
      place_order: "Lägg beställning", pay_now: "Fortsätt till betalning", processing: "Behandlar beställning…",
      err_required: "Fyll i det här fältet.", err_invalid: "Kontrollera uppgiften.", err_too_long: "Texten är för lång.",
      err_email: "Ange en giltig e-postadress, t.ex. namn@exempel.se.", err_phone: "Ange ett giltigt telefonnummer (minst 7 siffror).",
      err_postal: "Ange ett giltigt postnummer för valt land.", err_terms: "Du måste godkänna villkoren för att beställa.",
      err_unsupported: "Vi levererar tyvärr inte till det landet.",
      fix_fields: "Kontrollera de markerade fälten och försök igen.",
      e_NETWORK: "Ingen kontakt med servern. Kontrollera din uppkoppling och försök igen. Din beställning skickas inte två gånger.",
      e_SERVER_ERROR: "Något gick fel hos oss. Försök igen om en stund.",
      e_RATE_LIMITED: "För många försök. Vänta några minuter och försök igen.",
      e_PAYMENT_UNAVAILABLE: "Betalningen är tillfälligt otillgänglig. Ingen beställning har lagts. Försök igen om en stund.",
      e_SHIPPING_UNAVAILABLE: "Vi levererar tyvärr inte till det landet.",
      e_CART_INVALID: "Något i din varukorg har ändrats. Vi har uppdaterat den, kontrollera och försök igen.",
      e_RETRY: "Något ändrades under tiden. Tryck på Lägg beställning igen.",
      e_DEFAULT: "Beställningen kunde inte läggas. Försök igen.",
      payment_cancelled: "Betalningen avbröts och ingen beställning har lagts. Din varukorg är kvar.",
      order_not_found_h: "Beställningen hittades inte", order_not_found_p: "Länken verkar vara felaktig. Kontakta oss om du behöver hjälp.",
      order_expired_h: "Betalningen slutfördes inte", order_expired_p: "Sessionen har gått ut och ingen betalning har genomförts. Din varukorg är kvar om du vill försöka igen.",
      thanks: "Tack för din beställning!", thanks_p: "Vi har tagit emot din beställning. En bekräftelse skickas till {email}.",
      pending_h: "Vi bekräftar din betalning…", pending_p: "Det kan ta en liten stund. Sidan uppdateras automatiskt.",
      pending_long: "Betalningen är ännu inte bekräftad. Du får ett mejl så snart den är klar. Du kan lämna sidan.",
      cancelled_h: "Beställningen avbröts", cancelled_p: "Betalningen genomfördes inte och ingen kostnad har dragits.",
      order_number: "Ordernummer", items: "Varor", price: "Pris", qty: "Antal", sum: "Summa",
      delivery_address: "Leveransadress", status: "Status", tracking: "Spårningsnummer",
      payment_paid: "Betalningen är bekräftad.",
      s_pending: "Väntar på betalning", s_paid: "Betald", s_processing: "Behandlas", s_shipped: "Skickad", s_delivered: "Levererad", s_cancelled: "Avbruten",
      country: "Land",
    },
    en: {
      add_to_cart: "Add to cart", choose_variant: "Choose variant", sold_out: "Sold out",
      in_stock: "In stock", low_stock: "Only {n} left", out_of_stock: "Out of stock",
      added: "Added to your cart", view_cart: "View cart", max_in_cart: "You already have the maximum quantity in your cart.",
      loading: "Loading…", retry: "Try again",
      load_error: "We could not load the watches right now.",
      shop_empty_h: "No watches in the shop right now", shop_empty_p: "New watches are added regularly. Get in touch if you are looking for something specific.",
      contact_us: "Get in touch", back_to_shop: "Back to the shop", continue_shopping: "Continue shopping",
      not_found_h: "Watch not found", not_found_p: "It may have been sold or removed.",
      variant: "Variant", quantity: "Quantity", description: "Description", specs: "Specifications",
      cart_empty_h: "Your cart is empty", cart_empty_p: "Have a look at our watches.",
      remove: "Remove", each: "{price} each", subtotal: "Subtotal", shipping: "Shipping", total: "Total",
      free_shipping: "Free shipping", ship_to: "Ship to", checkout: "Proceed to checkout", order_summary: "Order summary",
      free_ship_hint: "Add {amount} more for free shipping.",
      shipping_incl: "Shipping is calculated for the selected country.",
      removed_unavailable: "{name} was removed because it is no longer available.",
      reduced_qty: "The quantity of {name} was reduced to {n} to match available stock.",
      inc: "Increase quantity", dec: "Decrease quantity",
      pay_note_stripe: "You will be sent to our payment provider Stripe to pay securely. We never receive your card details.",
      pay_note_manual: "After ordering you will receive payment instructions by email. Your order is reserved for you.",
      place_order: "Place order", pay_now: "Continue to payment", processing: "Processing your order…",
      err_required: "Please fill in this field.", err_invalid: "Please check this value.", err_too_long: "This text is too long.",
      err_email: "Enter a valid email address, e.g. name@example.com.", err_phone: "Enter a valid phone number (at least 7 digits).",
      err_postal: "Enter a valid postal code for the selected country.", err_terms: "You must accept the terms to place an order.",
      err_unsupported: "Sorry, we do not deliver to that country.",
      fix_fields: "Please check the highlighted fields and try again.",
      e_NETWORK: "Could not reach the server. Check your connection and try again. Your order will not be placed twice.",
      e_SERVER_ERROR: "Something went wrong on our side. Please try again in a moment.",
      e_RATE_LIMITED: "Too many attempts. Please wait a few minutes and try again.",
      e_PAYMENT_UNAVAILABLE: "Payment is temporarily unavailable. No order was placed. Please try again in a moment.",
      e_SHIPPING_UNAVAILABLE: "Sorry, we do not deliver to that country.",
      e_CART_INVALID: "Something in your cart changed. We have updated it, please review and try again.",
      e_RETRY: "Something changed in the meantime. Press Place order again.",
      e_DEFAULT: "The order could not be placed. Please try again.",
      payment_cancelled: "The payment was cancelled and no order was placed. Your cart is still here.",
      order_not_found_h: "Order not found", order_not_found_p: "The link seems to be wrong. Contact us if you need help.",
      order_expired_h: "The payment was not completed", order_expired_p: "The session expired and no payment was made. Your cart is still here if you want to try again.",
      thanks: "Thank you for your order!", thanks_p: "We have received your order. A confirmation is being sent to {email}.",
      pending_h: "Confirming your payment…", pending_p: "This can take a moment. The page updates automatically.",
      pending_long: "Your payment is not confirmed yet. You will get an email as soon as it is. You can leave this page.",
      cancelled_h: "The order was cancelled", cancelled_p: "The payment did not go through and you have not been charged.",
      order_number: "Order number", items: "Items", price: "Price", qty: "Qty", sum: "Total",
      delivery_address: "Delivery address", status: "Status", tracking: "Tracking number",
      payment_paid: "Your payment is confirmed.",
      s_pending: "Awaiting payment", s_paid: "Paid", s_processing: "Processing", s_shipped: "Shipped", s_delivered: "Delivered", s_cancelled: "Cancelled",
      country: "Country",
    },
  };

  MWC.lang = function () {
    return document.body.getAttribute("data-lang") === "en" ? "en" : "sv";
  };
  MWC.t = function (key, vars) {
    var s = (STR[MWC.lang()] && STR[MWC.lang()][key]) || STR.sv[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(vars[k]); });
    return s;
  };
  /** Field in the current language, falling back to Swedish when the English text is empty. */
  MWC.pick = function (obj, field) {
    if (!obj) return "";
    return (MWC.lang() === "en" && obj[field + "_en"]) || obj[field] || "";
  };
  MWC.money = function (minor, currency) {
    var whole = minor % 100 === 0;
    try {
      return new Intl.NumberFormat(MWC.lang() === "en" ? "en-SE" : "sv-SE", {
        style: "currency", currency: currency || "SEK",
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
      }).format(minor / 100);
    } catch (e) {
      return (minor / 100).toFixed(whole ? 0 : 2) + " " + (currency || "kr");
    }
  };

  /* -------------------------------------------------------------- DOM helper */
  MWC.h = function (tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      });
    }
    function add(c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) return c.forEach(add);
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  };
  MWC.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  /* --------------------------------------------------------------------- API */
  MWC.api = function (method, url, body) {
    var opts = { method: method, headers: { Accept: "application/json" } };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(
      function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.ok) return data;
          var e = (data && data.error) || {};
          throw { status: res.status, code: e.code || "SERVER_ERROR", fields: e.fields, issues: e.issues };
        });
      },
      function () { throw { status: 0, code: "NETWORK" }; }
    );
  };
  MWC.errorText = function (err) {
    var key = "e_" + (err && err.code);
    var s = STR[MWC.lang()][key];
    return s || MWC.t("e_DEFAULT");
  };

  var configPromise = null;
  MWC.config = function () {
    if (!configPromise) configPromise = MWC.api("GET", "/api/config").catch(function (e) { configPromise = null; throw e; });
    return configPromise;
  };

  /* -------------------------------------------------------------------- cart */
  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(v)) return [];
      return v.filter(function (i) { return i && Number.isInteger(i.p) && Number.isInteger(i.q) && i.q > 0; })
        .map(function (i) { return { p: i.p, v: i.v || null, q: i.q }; });
    } catch (e) { return []; }
  }
  function write(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) { /* storage unavailable */ }
    document.dispatchEvent(new CustomEvent("mwc:cart"));
  }
  function find(items, p, v) {
    for (var i = 0; i < items.length; i++) if (items[i].p === p && (items[i].v || null) === (v || null)) return items[i];
    return null;
  }
  MWC.cart = {
    get: read,
    count: function () { return read().reduce(function (n, i) { return n + i.q; }, 0); },
    qtyOf: function (p, v) { var i = find(read(), p, v); return i ? i.q : 0; },
    /** Adds up to `max` in total. Returns how many were added. */
    add: function (p, v, q, max) {
      var items = read();
      var line = find(items, p, v);
      var have = line ? line.q : 0;
      var allowed = Math.max(0, Math.min(q, (max === undefined ? 99 : max) - have));
      if (allowed > 0) {
        if (line) line.q += allowed; else items.push({ p: p, v: v || null, q: allowed });
        write(items);
      }
      return allowed;
    },
    setQty: function (p, v, q) {
      var items = read();
      var line = find(items, p, v);
      if (!line) return;
      if (q < 1) items = items.filter(function (i) { return i !== line; }); else line.q = q;
      write(items);
    },
    remove: function (p, v) { write(read().filter(function (i) { return !(i.p === p && (i.v || null) === (v || null)); })); },
    clear: function () { write([]); },
    /** Payload for the server: ids and quantities only. */
    payload: function () { return read().map(function (i) { return { product_id: i.p, variant_id: i.v, quantity: i.q }; }); },
  };

  MWC.getCountry = function (config) {
    var codes = config.countries.map(function (c) { return c.code; });
    var saved = null;
    try { saved = localStorage.getItem("mwc-country"); } catch (e) { /* ignore */ }
    return codes.indexOf(saved) >= 0 ? saved : codes[0];
  };
  MWC.setCountry = function (code) { try { localStorage.setItem("mwc-country", code); } catch (e) { /* ignore */ } };
  MWC.countryName = function (config, code) {
    for (var i = 0; i < config.countries.length; i++) if (config.countries[i].code === code) return MWC.pick(config.countries[i], "name");
    return code;
  };
  MWC.quote = function (country) {
    return MWC.api("POST", "/api/cart/quote", { items: MWC.cart.payload(), country: country });
  };

  /* ------------------------------------------------------------------- toast */
  var toastTimer = null;
  MWC.toast = function (message, linkText, linkHref) {
    var el = document.getElementById("mwc-toast");
    if (!el) {
      el = MWC.h("div", { id: "mwc-toast", class: "toast", role: "status", "aria-live": "polite" });
      document.body.appendChild(el);
    }
    MWC.clear(el);
    el.appendChild(MWC.h("span", { text: message }));
    if (linkText) el.appendChild(MWC.h("a", { href: linkHref, text: linkText }));
    void el.offsetWidth;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-visible"); }, 4500);
  };

  /* ---------------------------------------------------------------- stock UI */
  MWC.stockEl = function (item) {
    var cls = "stock";
    var key = "in_stock";
    var vars;
    if (item.stock_status === "out_of_stock") { cls += " is-out"; key = "out_of_stock"; }
    else if (item.stock_status === "low_stock") { cls += " is-low"; key = "low_stock"; vars = { n: item.stock_left }; }
    return MWC.h("span", { class: cls, text: MWC.t(key, vars) });
  };

  MWC.uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  };
})();
