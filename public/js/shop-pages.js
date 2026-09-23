/* ==========================================================================
  Rasch o Q Design — shop page controllers
   ========================================================================== */
(function () {
  "use strict";

  var MWC = window.MWC;
  var h = MWC.h;
  var t = MWC.t;
  var page = document.body.getAttribute("data-page");
  var $ = function (sel) { return document.querySelector(sel); };

  function emptyState(title, text, actions) {
    var box = h("div", { class: "empty-state" }, h("h2", { text: title }), h("p", { text: text }));
    (actions || []).forEach(function (a) { box.appendChild(a); });
    return box;
  }
  function linkBtn(href, label, cls) { return h("a", { href: href, class: "btn " + (cls || "btn-primary"), text: label }); }
  function pending(root, on) { root.setAttribute("aria-busy", on ? "true" : "false"); }
  function retryBox(msg, onRetry) {
    return emptyState(msg, "", [h("button", { type: "button", class: "btn btn-outline", text: t("retry"), onclick: onRetry })]);
  }

  /* =========================================================== SHOP GRID */
  function initShop() {
    var grid = $("#product-grid");
    var status = $("#shop-status");
    var products = null;
    var category = "all";

    function card(p) {
      var soldOut = p.stock_status === "out_of_stock";
      var href = "produkt.html?p=" + encodeURIComponent(p.slug);
      var media = h("a", { href: href, class: "product-media", tabindex: "-1", "aria-hidden": "true" },
        p.images[0] ? h("img", { src: p.images[0], alt: "", loading: "lazy" }) : null);
      var chips = null;
      if (p.variants.length) {
        chips = h("div", { class: "chip-list" }, p.variants.map(function (v) {
          return h("span", { class: "chip" + (v.stock_status === "out_of_stock" ? " is-out" : ""), text: MWC.pick(v, "label") });
        }));
      }
      var action;
      if (soldOut) action = h("span", { class: "btn btn-outline", "aria-disabled": "true", text: t("sold_out") });
      else if (p.variants.length) action = h("a", { href: href, class: "btn btn-outline", text: t("choose_variant") });
      else {
        action = h("button", {
          type: "button", class: "btn btn-primary", text: t("add_to_cart"),
          onclick: function () {
            var added = MWC.cart.add(p.id, null, 1, p.max_qty);
            if (added) MWC.toast(MWC.pick(p, "name") + ": " + t("added"), t("view_cart"), "varukorg.html");
            else MWC.toast(t("max_in_cart"));
          },
        });
      }
      return h("article", { class: "product-card" + (soldOut ? " is-sold-out" : "") },
        media,
        h("div", { class: "product-body" },
          h("h3", { class: "product-name" }, h("a", { href: href, text: MWC.pick(p, "name") })),
          h("p", { class: "product-desc", text: MWC.pick(p, "short_description") }),
          chips,
          h("div", { class: "product-foot" }, h("span", { class: "price", text: MWC.money(p.price, p.currency) }), MWC.stockEl(p)),
          action));
    }

    function render() {
      MWC.clear(grid);
      MWC.clear(status);
      var visibleProducts = category === "all" ? products : products.filter(function (p) { return p.category === category; });
      if (!visibleProducts.length) {
        status.appendChild(emptyState(t("shop_empty_h"), t("shop_empty_p"), [linkBtn("kontakt.html", t("contact_us"))]));
      } else {
        visibleProducts.forEach(function (p) { grid.appendChild(card(p)); });
      }
      pending(grid, false);
    }

    document.querySelectorAll(".collection-nav a[data-category]").forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        category = link.getAttribute("data-category");
        document.querySelectorAll(".collection-nav a[data-category]").forEach(function (item) {
          item.toggleAttribute("aria-current", item === link);
        });
        if (products) render();
        grid.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    function load() {
      MWC.clear(status);
      MWC.api("GET", "/api/products").then(function (d) { products = d.products; render(); }).catch(function () {
        pending(grid, false);
        MWC.clear(status).appendChild(retryBox(t("load_error"), load));
      });
    }
    document.addEventListener("mwc:lang", function () { if (products) render(); });
    load();
  }

  /* ======================================================== PRODUCT PAGE */
  function initProduct() {
    var root = $("#product-detail");
    var slug = new URLSearchParams(location.search).get("p");
    var product = null;
    var state = { variant: null, qty: 1, image: 0 };

    function current() {
      if (product.variants.length) {
        var v = product.variants.filter(function (x) { return x.id === state.variant; })[0];
        return v || product.variants[0];
      }
      return product;
    }

    function render() {
      var p = product;
      var cur = current();
      var inCart = MWC.cart.qtyOf(p.id, p.variants.length ? cur.id : null);
      var room = Math.max(0, cur.max_qty - inCart);
      if (state.qty > Math.max(room, 1)) state.qty = Math.max(room, 1);
      var soldOut = cur.stock_status === "out_of_stock";
      var name = MWC.pick(p, "name");

      document.title = name + " — Rasch o Q Design";
      $("#crumb-name").textContent = name;

      var main = h("div", { class: "pd-gallery-main" },
        p.images.length ? h("img", { src: p.images[state.image] || p.images[0], alt: name }) : null);
      var thumbs = p.images.length > 1 ? h("div", { class: "pd-thumbs" }, p.images.map(function (src, i) {
        return h("button", {
          type: "button", class: "pd-thumb", "aria-label": name + " " + (i + 1), "aria-current": i === state.image ? "true" : "false",
          onclick: function () { state.image = i; render(); },
        }, h("img", { src: src, alt: "" }));
      })) : null;

      var options = null;
      if (p.variants.length) {
        var list = h("div", { class: "option-list", role: "radiogroup", "aria-label": t("variant") });
        p.variants.forEach(function (v) {
          list.appendChild(h("button", {
            type: "button", role: "radio", class: "option-btn" + (v.stock_status === "out_of_stock" ? " is-out" : ""),
            "aria-checked": v.id === cur.id ? "true" : "false", text: MWC.pick(v, "label"),
            onclick: function () { state.variant = v.id; state.qty = 1; render(); },
          }));
        });
        options = h("div", { class: "option-group" }, h("span", { class: "option-label", text: t("variant") }), list);
      }

      var dec = h("button", { type: "button", "aria-label": t("dec"), text: "−", disabled: state.qty <= 1, onclick: function () { state.qty -= 1; render(); } });
      var inc = h("button", { type: "button", "aria-label": t("inc"), text: "+", disabled: state.qty >= room, onclick: function () { state.qty += 1; render(); } });
      var addBtn = h("button", {
        type: "button", class: "btn btn-primary", disabled: soldOut || room < 1,
        text: soldOut ? t("sold_out") : t("add_to_cart"),
        onclick: function () {
          var added = MWC.cart.add(p.id, p.variants.length ? cur.id : null, state.qty, cur.max_qty);
          state.qty = 1;
          if (added) MWC.toast(name + ": " + t("added"), t("view_cart"), "varukorg.html");
          render();
        },
      });
      var note = h("p", { class: "buy-note", "aria-live": "polite", text: !soldOut && room < 1 ? t("max_in_cart") : "" });

      var desc = MWC.pick(p, "description");
      var descBlock = desc ? h("div", { class: "pd-section" }, h("h2", { text: t("description") }),
        desc.split(/\n\s*\n/).map(function (para) { return h("p", { text: para }); })) : null;
      var specBlock = null;
      if (p.specs.length) {
        var dl = h("dl", { class: "spec-list" });
        p.specs.forEach(function (s) { dl.appendChild(h("div", null, h("dt", { text: MWC.pick(s, "label") }), h("dd", { text: MWC.pick(s, "value") }))); });
        specBlock = h("div", { class: "pd-section" }, h("h2", { text: t("specs") }), dl);
      }

      MWC.clear(root).appendChild(h("div", { class: "product-detail" },
        h("div", { class: "pd-gallery" }, main, thumbs),
        h("div", { class: "pd-info" },
          h("h1", { text: name }),
          h("div", { class: "pd-price" }, h("span", { class: "price", text: MWC.money(p.price, p.currency) }), MWC.stockEl(cur)),
          MWC.pick(p, "short_description") ? h("p", { class: "pd-lead", text: MWC.pick(p, "short_description") }) : null,
          options,
          h("div", { class: "buy-row" },
            h("div", { class: "qty", role: "group", "aria-label": t("quantity") }, dec, h("output", { "aria-live": "polite", text: String(state.qty) }), inc),
            addBtn),
          note, descBlock, specBlock)));
      pending(root, false);
    }

    function notFound() {
      pending(root, false);
      $("#crumb-name").textContent = "";
      MWC.clear(root).appendChild(emptyState(t("not_found_h"), t("not_found_p"), [linkBtn("butik.html", t("back_to_shop"))]));
    }

    if (!slug) return notFound();
    function load() {
      MWC.api("GET", "/api/products/" + encodeURIComponent(slug)).then(function (d) {
        product = d.product;
        if (product.variants.length) {
          var firstAvail = product.variants.filter(function (v) { return v.stock_status !== "out_of_stock"; })[0];
          state.variant = (firstAvail || product.variants[0]).id;
        }
        render();
      }).catch(function (e) {
        if (e.status === 404) return notFound();
        pending(root, false);
        MWC.clear(root).appendChild(retryBox(t("load_error"), load));
      });
    }
    document.addEventListener("mwc:lang", function () { if (product) render(); });
    document.addEventListener("mwc:cart", function () { if (product) render(); });
    load();
  }

  /* ========================================================== CART PAGE */
  /** Applies the server's stock findings to the local cart. Returns notices to show. */
  function syncCartWithQuote(quote) {
    var notices = [];
    quote.lines.forEach(function (l) {
      var name = MWC.pick(l, "name") || "";
      if (!l.issue) return;
      if (l.issue === "INSUFFICIENT_STOCK" && l.max_qty > 0) {
        MWC.cart.setQty(l.product_id, l.variant_id, l.max_qty);
        notices.push(t("reduced_qty", { name: name, n: l.max_qty }));
      } else {
        MWC.cart.remove(l.product_id, l.variant_id);
        notices.push(t("removed_unavailable", { name: name || "#" + l.product_id }));
      }
    });
    return notices;
  }

  function freeShipHint(config, quote) {
    if (!config.free_shipping_over || quote.subtotal >= config.free_shipping_over || !quote.subtotal) return null;
    return h("p", { class: "summary-hint", text: t("free_ship_hint", { amount: MWC.money(config.free_shipping_over - quote.subtotal, quote.currency) }) });
  }

  function summaryRows(quote) {
    return [
      h("div", { class: "summary-row" }, h("span", { text: t("subtotal") }), h("span", { text: MWC.money(quote.subtotal, quote.currency) })),
      h("div", { class: "summary-row" }, h("span", { text: t("shipping") }),
        h("span", { text: quote.shipping === null ? "—" : quote.shipping === 0 ? t("free_shipping") : MWC.money(quote.shipping, quote.currency) })),
      h("div", { class: "summary-row is-total" }, h("span", { text: t("total") }), h("span", { class: "price", text: MWC.money(quote.total, quote.currency) })),
    ];
  }

  function countrySelect(config, value, onChange, id) {
    var sel = h("select", { id: id, name: "country", autocomplete: "country" });
    config.countries.forEach(function (c) {
      var o = h("option", { value: c.code, text: MWC.pick(c, "name") });
      if (c.code === value) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { onChange(sel.value); });
    return sel;
  }

  function initCart() {
    var root = $("#cart-root");
    var config = null;
    var country = null;
    var quote = null;
    var notices = [];
    var busy = false;

    function lineEl(l) {
      var name = MWC.pick(l, "name");
      var href = "produkt.html?p=" + encodeURIComponent(l.slug || "");
      var variant = MWC.pick(l, "variant_label");
      var dec = h("button", { type: "button", "aria-label": t("dec"), text: "−", disabled: l.quantity <= 1, onclick: function () { change(l, l.quantity - 1); } });
      var inc = h("button", { type: "button", "aria-label": t("inc"), text: "+", disabled: l.quantity >= l.max_qty, onclick: function () { change(l, l.quantity + 1); } });
      return h("li", { class: "cart-line" },
        h("a", { href: href, class: "cart-line-media", tabindex: "-1", "aria-hidden": "true" }, l.image ? h("img", { src: l.image, alt: "" }) : null),
        h("div", null,
          h("h3", null, h("a", { href: href, text: name })),
          variant ? h("p", { class: "cart-line-variant", text: variant }) : null,
          h("p", { class: "cart-line-unit", text: t("each", { price: MWC.money(l.unit_price, quote.currency) }) })),
        h("div", { class: "cart-line-total price", text: MWC.money(l.line_total, quote.currency) }),
        h("div", { class: "cart-line-actions" },
          h("div", { class: "qty", role: "group", "aria-label": t("quantity") + ": " + name }, dec, h("output", { text: String(l.quantity) }), inc),
          h("button", { type: "button", class: "link-btn", text: t("remove"), onclick: function () { MWC.cart.remove(l.product_id, l.variant_id); refresh(); } })));
    }

    function change(l, q) {
      MWC.cart.setQty(l.product_id, l.variant_id, q);
      refresh();
    }

    function render() {
      MWC.clear(root);
      var lines = quote ? quote.lines.filter(function (l) { return !l.issue; }) : [];
      notices.forEach(function (n) { root.appendChild(h("div", { class: "banner", role: "status", text: n })); });

      if (!lines.length) {
        root.appendChild(emptyState(t("cart_empty_h"), t("cart_empty_p"), [linkBtn("butik.html", t("back_to_shop"))]));
        return pending(root, false);
      }
      var list = h("ul", { class: "cart-lines" }, lines.map(lineEl));
      var left = h("div", null, list, h("div", { class: "cart-continue" }, linkBtn("butik.html", t("continue_shopping"), "btn-outline btn-sm")));

      var summary = h("aside", { class: "summary-panel", "aria-label": t("order_summary") },
        h("h2", { text: t("order_summary") }),
        h("div", { class: "field" }, h("label", { for: "cart-country", text: t("ship_to") }),
          countrySelect(config, country, function (c) { country = c; MWC.setCountry(c); refresh(); }, "cart-country")),
        summaryRows(quote),
        freeShipHint(config, quote),
        h("a", { href: "kassa.html", class: "btn btn-primary btn-block", text: t("checkout") }));
      root.appendChild(h("div", { class: "cart-layout" }, left, summary));
      pending(root, false);
    }

    function refresh(isRetry) {
      if (busy) return;
      busy = true;
      MWC.quote(country).then(function (q) {
        var fixes = syncCartWithQuote(q);
        if (fixes.length && !isRetry) {
          notices = notices.concat(fixes);
          busy = false;
          return refresh(true);
        }
        quote = q;
        busy = false;
        render();
      }).catch(function () {
        busy = false;
        pending(root, false);
        MWC.clear(root).appendChild(retryBox(t("load_error"), function () { refresh(); }));
      });
    }

    function start() {
      if (!MWC.cart.get().length) { quote = { lines: [] }; return render(); }
      MWC.config().then(function (c) { config = c; country = MWC.getCountry(c); refresh(); }).catch(function () {
        pending(root, false);
        MWC.clear(root).appendChild(retryBox(t("load_error"), start));
      });
    }
    document.addEventListener("mwc:lang", function () { if (quote && config) render(); });
    start();
  }

  /* ======================================================= CHECKOUT PAGE */
  var FIELD_IDS = ["first_name", "last_name", "email", "phone", "address", "address2", "postal_code", "city", "country"];
  var POSTAL = {
    SE: /^\d{3}\s?\d{2}$/, NO: /^\d{4}$/, DK: /^\d{4}$/, FI: /^\d{5}$/, DE: /^\d{5}$/, NL: /^\d{4}\s?[A-Za-z]{2}$/,
    BE: /^\d{4}$/, AT: /^\d{4}$/, FR: /^\d{5}$/, ES: /^\d{5}$/, IT: /^\d{5}$/, PL: /^\d{2}-?\d{3}$/, CH: /^\d{4}$/,
  };
  var POSTAL_GENERIC = /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/;

  function validateForm(v) {
    var e = {};
    ["first_name", "last_name", "address", "city"].forEach(function (f) { if (!v[f]) e[f] = "required"; });
    if (v.address && v.address.length < 3) e.address = "invalid";
    if (v.city && v.city.length < 2) e.city = "invalid";
    if (!v.email) e.email = "required"; else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) e.email = "invalid";
    var digits = (v.phone || "").replace(/\D/g, "");
    if (!v.phone) e.phone = "required";
    else if (!/^[+()\d][\d\s()+.-]{5,24}$/.test(v.phone) || digits.length < 7 || digits.length > 15) e.phone = "invalid";
    if (!v.country) e.country = "required";
    if (!v.postal_code) e.postal_code = "required";
    else if (!(POSTAL[v.country] || POSTAL_GENERIC).test(v.postal_code)) e.postal_code = "invalid";
    if (!v.accept_terms) e.accept_terms = "required";
    return e;
  }

  function fieldMessage(field, code) {
    if (field === "email" && code !== "required") return t("err_email");
    if (field === "phone" && code !== "required") return t("err_phone");
    if (field === "postal_code" && code !== "required") return t("err_postal");
    if (field === "accept_terms") return t("err_terms");
    if (code === "unsupported") return t("err_unsupported");
    if (code === "too_long") return t("err_too_long");
    if (code === "required") return t("err_required");
    return t("err_invalid");
  }

  function initCheckout() {
    var form = $("#checkout-form");
    var layout = $("#checkout-layout");
    var emptyBox = $("#checkout-empty");
    var banner = $("#checkout-banner");
    var button = $("#place-order");
    var summary = $("#checkout-summary");
    var config = null;
    var quote = null;
    var submitting = false;
    var lastErrors = {};
    var params = new URLSearchParams(location.search);

    // Coming back from the payment page (Back button / cancel): release the reserved stock first.
    function releasePending() {
      var raw = null;
      try { raw = sessionStorage.getItem("mwc-pending-order"); } catch (e) { /* ignore */ }
      if (!raw) return Promise.resolve(null);
      var p;
      try { p = JSON.parse(raw); } catch (e) { return Promise.resolve(null); }
      return MWC.api("POST", "/api/orders/" + encodeURIComponent(p.number) + "/abandon", { token: p.token })
        .then(function (r) {
          try { sessionStorage.removeItem("mwc-pending-order"); sessionStorage.removeItem("mwc-idem"); } catch (e) { /* ignore */ }
          if (r.status === "paid") { location.replace("bekraftelse.html?order=" + encodeURIComponent(p.number) + "&t=" + encodeURIComponent(p.token)); return "paid"; }
          return "abandoned";
        }).catch(function () { return null; });
    }

    function showBanner(msg, kind, list) {
      MWC.clear(banner);
      banner.className = "banner" + (kind === "error" ? " is-error" : "");
      banner.appendChild(h("span", { text: msg }));
      if (list && list.length) banner.appendChild(h("ul", null, list.map(function (x) { return h("li", { text: x }); })));
      banner.hidden = false;
      banner.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    function hideBanner() { banner.hidden = true; }

    function setError(field, code) {
      var wrap = form.querySelector('[data-field="' + field + '"]');
      var msg = $("#err-" + field);
      var input = $("#f-" + field);
      if (!wrap || !msg) return;
      if (code) {
        wrap.classList.add("has-error");
        msg.textContent = fieldMessage(field, code);
        msg.hidden = false;
        if (input) input.setAttribute("aria-invalid", "true");
      } else {
        wrap.classList.remove("has-error");
        msg.hidden = true;
        if (input) input.removeAttribute("aria-invalid");
      }
    }
    function showErrors(errors) {
      lastErrors = errors;
      FIELD_IDS.concat(["accept_terms"]).forEach(function (f) { setError(f, errors[f]); });
      var first = FIELD_IDS.concat(["accept_terms"]).filter(function (f) { return errors[f]; })[0];
      if (first) { var el = $("#f-" + first); if (el) el.focus(); }
    }

    function collect() {
      var v = {};
      FIELD_IDS.forEach(function (f) { var el = $("#f-" + f); v[f] = el ? el.value.trim() : ""; });
      v.accept_terms = $("#f-accept_terms").checked;
      return v;
    }

    function renderSummary() {
      MWC.clear(summary);
      var lines = quote.lines.filter(function (l) { return !l.issue; });
      summary.appendChild(h("h2", { text: t("order_summary") }));
      summary.appendChild(h("ul", { class: "summary-items" }, lines.map(function (l) {
        var v = MWC.pick(l, "variant_label");
        return h("li", null,
          h("span", null, l.quantity + " × " + MWC.pick(l, "name"), v ? h("small", { text: v }) : null),
          h("span", { text: MWC.money(l.line_total, quote.currency) }));
      })));
      summaryRows(quote).forEach(function (r) { summary.appendChild(r); });
      var hint = freeShipHint(config, quote);
      if (hint) summary.appendChild(hint);
      summary.appendChild(h("p", { class: "summary-hint" }, h("a", { href: "varukorg.html", text: t("view_cart") })));
    }

    function refreshQuote() {
      var country = $("#f-country").value;
      return MWC.quote(country).then(function (q) {
        var fixes = syncCartWithQuote(q);
        if (fixes.length) {
          showBanner(t("e_CART_INVALID"), "error", fixes);
          return MWC.quote(country).then(function (q2) { quote = q2; return q2; });
        }
        quote = q;
        return q;
      });
    }

    function afterQuote() {
      var lines = quote.lines.filter(function (l) { return !l.issue; });
      if (!lines.length) { layout.hidden = true; return showEmpty(); }
      renderSummary();
    }

    function showEmpty() {
      emptyBox.hidden = false;
      MWC.clear(emptyBox).appendChild(emptyState(t("cart_empty_h"), t("cart_empty_p"), [linkBtn("butik.html", t("back_to_shop"))]));
    }

    function idemKey() {
      var sig = JSON.stringify(MWC.cart.payload().sort(function (a, b) { return a.product_id - b.product_id || String(a.variant_id).localeCompare(String(b.variant_id)); }));
      try {
        var saved = JSON.parse(sessionStorage.getItem("mwc-idem") || "null");
        if (saved && saved.sig === sig) return saved.key;
        var key = MWC.uuid();
        sessionStorage.setItem("mwc-idem", JSON.stringify({ key: key, sig: sig }));
        return key;
      } catch (e) { return MWC.uuid(); }
    }
    function dropIdemKey() { try { sessionStorage.removeItem("mwc-idem"); } catch (e) { /* ignore */ } }

    function setBusy(on) {
      button.setAttribute("aria-busy", on ? "true" : "false");
      button.disabled = on;
      MWC.clear(button);
      if (on) { button.appendChild(h("span", { class: "spinner", "aria-hidden": "true" })); button.appendChild(document.createTextNode(" " + t("processing"))); }
      else button.textContent = label();
    }
    function label() { return config && config.payment_mode === "stripe" ? t("pay_now") : t("place_order"); }

    function onError(err) {
      if (err.code === "VALIDATION" && err.fields) {
        showErrors(err.fields);
        return showBanner(t("fix_fields"), "error");
      }
      if (err.code === "CART_INVALID") {
        var notices = [];
        (err.issues || []).forEach(function (i) {
          if (i.code === "INSUFFICIENT_STOCK" && i.max_qty > 0) MWC.cart.setQty(i.product_id, i.variant_id, i.max_qty);
          else MWC.cart.remove(i.product_id, i.variant_id);
        });
        return MWC.quote($("#f-country").value).then(function (q) {
          quote = q;
          quote.lines.forEach(function (l) { if (l.issue) notices.push(t("removed_unavailable", { name: MWC.pick(l, "name") || "#" + l.product_id })); });
          syncCartWithQuote(q);
          return MWC.quote($("#f-country").value);
        }).then(function (q2) { quote = q2; showBanner(t("e_CART_INVALID"), "error", notices); afterQuote(); })
          .catch(function () { showBanner(t("e_CART_INVALID"), "error"); });
      }
      if (["IDEMPOTENCY_MISMATCH", "SESSION_EXPIRED", "ORDER_CLOSED"].indexOf(err.code) >= 0) {
        dropIdemKey();
        return showBanner(t("e_RETRY"), "error");
      }
      showBanner(MWC.errorText(err), "error");
    }

    function submit(e) {
      e.preventDefault();
      if (submitting) return; // double-click guard (the server also de-duplicates)
      hideBanner();
      var v = collect();
      var errors = validateForm(v);
      if (Object.keys(errors).length) { showErrors(errors); return showBanner(t("fix_fields"), "error"); }
      showErrors({});

      submitting = true;
      setBusy(true);
      MWC.api("POST", "/api/checkout", {
        customer: { first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone },
        shipping: { address: v.address, address2: v.address2, city: v.city, postal_code: v.postal_code, country: v.country },
        items: MWC.cart.payload(),
        idempotency_key: idemKey(),
        language: MWC.lang(),
        accept_terms: true,
      }).then(function (res) {
        var confirmUrl = "bekraftelse.html?order=" + encodeURIComponent(res.order_number) + "&t=" + encodeURIComponent(res.token);
        if (res.status === "redirect" && res.redirect_url) {
          try { sessionStorage.setItem("mwc-pending-order", JSON.stringify({ number: res.order_number, token: res.token })); } catch (x) { /* ignore */ }
          location.href = res.redirect_url; // stays in the "processing" state while the browser navigates
          return;
        }
        MWC.cart.clear();
        dropIdemKey();
        location.href = confirmUrl;
      }).catch(function (err) {
        submitting = false;
        setBusy(false);
        onError(err);
      });
    }

    function init() {
      Promise.all([releasePending(), MWC.config()]).then(function (r) {
        if (r[0] === "paid") return;
        config = r[1];
        if (!MWC.cart.get().length) { showEmpty(); return pending($("#main"), false); }

        var sel = $("#f-country");
        config.countries.forEach(function (c) { sel.appendChild(h("option", { value: c.code, text: MWC.pick(c, "name") })); });
        sel.value = MWC.getCountry(config);
        sel.addEventListener("change", function () { MWC.setCountry(sel.value); refreshQuote().then(afterQuote).catch(function () {}); });
        $("#payment-note").textContent = config.payment_mode === "stripe" ? t("pay_note_stripe") : t("pay_note_manual");
        button.textContent = label();

        // Validate a field when the user leaves it, and clear its error while they fix it.
        FIELD_IDS.forEach(function (f) {
          var el = $("#f-" + f);
          el.addEventListener("blur", function () {
            var errs = validateForm(collect());
            if (el.value.trim() || lastErrors[f]) setError(f, errs[f]);
          });
          el.addEventListener("input", function () { if (lastErrors[f]) { delete lastErrors[f]; setError(f, null); } });
        });
        $("#f-accept_terms").addEventListener("change", function () { setError("accept_terms", this.checked ? null : "required"); });
        form.addEventListener("submit", submit);

        refreshQuote().then(function () {
          layout.hidden = false;
          afterQuote();
          if (params.get("cancelled")) showBanner(t("payment_cancelled"), "info");
        }).catch(function () {
          layout.hidden = true;
          emptyBox.hidden = false;
          MWC.clear(emptyBox).appendChild(retryBox(t("load_error"), function () { location.reload(); }));
        });
      }).catch(function () {
        emptyBox.hidden = false;
        MWC.clear(emptyBox).appendChild(retryBox(t("load_error"), function () { location.reload(); }));
      });
    }

    // Re-render dynamic text after a language switch
    document.addEventListener("mwc:lang", function () {
      if (!config) return;
      $("#payment-note").textContent = config.payment_mode === "stripe" ? t("pay_note_stripe") : t("pay_note_manual");
      if (!submitting) button.textContent = label();
      var sel = $("#f-country");
      config.countries.forEach(function (c, i) { if (sel.options[i]) sel.options[i].textContent = MWC.pick(c, "name"); });
      if (quote) afterQuote();
      showErrors(lastErrors);
    });
    // Back/forward cache: a restored page must not stay stuck in the "processing" state.
    window.addEventListener("pageshow", function (e) { if (e.persisted) location.reload(); });
    init();
  }

  /* ================================================= CONFIRMATION PAGE */
  function initConfirmation() {
    var root = $("#confirm-root");
    var title = $("#confirm-title");
    var params = new URLSearchParams(location.search);
    var number = params.get("order");
    var token = params.get("t");
    var order = null;
    var config = null;
    var attempts = 0;
    var timer = null;
    MWC.config().then(function (c) { config = c; if (order) render(); }).catch(function () { /* country code is shown instead */ });

    function setTitle(text) { title.removeAttribute("data-sv"); title.removeAttribute("data-en"); title.textContent = text; }

    function statusLabel(o) {
      var s = o.order_status;
      if (s === "pending" && o.payment_status === "unpaid") s = "pending";
      return t("s_" + s);
    }

    function render() {
      var o = order;
      MWC.clear(root);
      var cancelled = o.order_status === "cancelled";
      var awaitingOnline = o.payment_provider === "stripe" && o.payment_status === "unpaid" && !cancelled;

      var head = h("div", { class: "confirm-head" });
      if (cancelled) {
        setTitle(t("cancelled_h"));
        head.appendChild(h("p", { text: t("cancelled_p") }));
      } else if (awaitingOnline) {
        setTitle(t("pending_h"));
        head.appendChild(h("p", { text: attempts >= 12 ? t("pending_long") : t("pending_p") }));
      } else {
        setTitle(t("thanks"));
        head.appendChild(h("p", { text: t("thanks_p", { email: o.customer.email }) }));
      }
      head.appendChild(h("div", { class: "order-number-box" }, h("small", { text: t("order_number") }), h("strong", { text: o.order_number })));
      root.appendChild(head);

      var rows = o.items.map(function (i) {
        var v = MWC.pick(i, "variant_label");
        return h("tr", null,
          h("td", null, MWC.pick(i, "name"), v ? h("small", { text: v }) : null),
          h("td", { class: "num", text: String(i.quantity) }),
          h("td", { class: "num", text: MWC.money(i.unit_price, o.currency) }),
          h("td", { class: "num", text: MWC.money(i.total_price, o.currency) }));
      });
      var table = h("table", { class: "order-table" },
        h("thead", null, h("tr", null,
          h("th", { scope: "col", text: t("items") }), h("th", { scope: "col", class: "num", text: t("qty") }),
          h("th", { scope: "col", class: "num", text: t("price") }), h("th", { scope: "col", class: "num", text: t("sum") }))),
        h("tbody", null, rows),
        h("tfoot", null,
          h("tr", null, h("td", { colspan: "3", text: t("subtotal") }), h("td", { class: "num", text: MWC.money(o.subtotal, o.currency) })),
          h("tr", null, h("td", { colspan: "3", text: t("shipping") }), h("td", { class: "num", text: o.shipping_cost === 0 ? t("free_shipping") : MWC.money(o.shipping_cost, o.currency) })),
          h("tr", { class: "is-total" }, h("td", { colspan: "3", text: t("total") }), h("td", { class: "num", text: MWC.money(o.total, o.currency) }))));

      var sh = o.shipping;
      var addr = h("address", null,
        o.customer.first_name + " " + o.customer.last_name, h("br"), sh.address, h("br"),
        sh.address2 ? sh.address2 : null, sh.address2 ? h("br") : null,
        sh.postal_code + " " + sh.city, h("br"), config ? MWC.countryName(config, sh.country) : sh.country);

      var payText = null;
      if (o.payment_status === "paid") payText = t("payment_paid");
      else if (o.payment_instructions) payText = o.payment_instructions[MWC.lang()] || o.payment_instructions.sv;

      var side = h("div", null,
        h("div", { class: "confirm-block" }, h("h3", { text: t("status") }),
          h("span", { class: "status-badge is-" + (o.payment_status === "paid" && o.order_status === "pending" ? "paid" : o.order_status), text: statusLabel(o) }),
          o.tracking_number ? h("p", { class: "form-note", text: t("tracking") + ": " + o.tracking_number }) : null),
        h("div", { class: "confirm-block" }, h("h3", { text: t("delivery_address") }), addr));

      root.appendChild(h("div", { class: "confirm-grid" }, h("div", { class: "confirm-block" }, table), side));
      if (payText) root.appendChild(h("div", { class: "notice-block", text: payText }));
      root.appendChild(h("div", { class: "confirm-actions" }, linkBtn("butik.html", t("back_to_shop"))));
      pending(root, false);
    }

    function fail(titleKey, textKey) {
      pending(root, false);
      setTitle(t(titleKey));
      MWC.clear(root).appendChild(emptyState(t(titleKey), t(textKey), [linkBtn("butik.html", t("back_to_shop"))]));
    }

    function load() {
      MWC.api("GET", "/api/orders/" + encodeURIComponent(number) + "?token=" + encodeURIComponent(token)).then(function (d) {
        order = d.order;
        try { sessionStorage.removeItem("mwc-pending-order"); sessionStorage.removeItem("mwc-idem"); } catch (e) { /* ignore */ }
        if (order.order_status !== "cancelled") MWC.cart.clear();
        render();
        // Online payment: the payment provider confirms in the background, so check again for a short while.
        if (order.payment_provider === "stripe" && order.payment_status === "unpaid" && order.order_status !== "cancelled" && attempts < 12) {
          attempts += 1;
          timer = setTimeout(load, 2500);
        }
      }).catch(function (e) {
        if (e.status === 410) return fail("order_expired_h", "order_expired_p");
        if (e.status === 404 || e.status === 400) return fail("order_not_found_h", "order_not_found_p");
        if (order) return; // transient error while polling: keep what we show
        pending(root, false);
        MWC.clear(root).appendChild(retryBox(t("load_error"), load));
      });
    }

    document.addEventListener("mwc:lang", function () { if (order) render(); });
    if (!number || !token) return fail("order_not_found_h", "order_not_found_p");
    load();
  }

  /* ------------------------------------------------------------------ boot */
  if (page === "butik") initShop();
  else if (page === "produkt") initProduct();
  else if (page === "varukorg") initCart();
  else if (page === "kassa") initCheckout();
  else if (page === "bekraftelse") initConfirmation();
})();
