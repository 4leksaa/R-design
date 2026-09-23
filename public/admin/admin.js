/* ==========================================================================
  Rasch o Q Design — admin (orders + products)
   All security decisions are made by the server (session cookie + CSRF token).
   ========================================================================== */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var me = null; // { email, csrf, payment_mode, email_enabled, currency }

  var STATUSES = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"];
  var STATUS_LABEL = { pending: "Pending", paid: "Paid", processing: "Processing", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };
  var PAY_LABEL = { unpaid: "Unpaid", paid: "Paid", failed: "Failed" };
  var ERRORS = {
    UNAUTHENTICATED: "Your session has expired. Please sign in again.",
    INVALID_LOGIN: "Wrong email or password.",
    RATE_LIMITED: "Too many failed attempts. Try again in 15 minutes.",
    PAYMENT_NOT_CONFIRMED: null, // server message is clear enough
    NETWORK: "Could not reach the server. Check your connection.",
    INVALID_IMAGE: "Upload a JPEG, PNG or WebP image (max 8 MB).",
    PAYLOAD_TOO_LARGE: "That file is too large (max 8 MB).",
  };
  var FIELD_ERRORS = { required: "Required", invalid: "Invalid value", too_long: "Too long", too_many: "Too many entries" };

  /* ------------------------------------------------------------------ utils */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "value") el.value = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function money(minor, currency) {
    var whole = minor % 100 === 0;
    return new Intl.NumberFormat("sv-SE", { style: "currency", currency: currency || (me && me.currency) || "SEK", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(minor / 100);
  }
  function date(iso) { return iso ? new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }) : ""; }
  function pill(kind, label) { return h("span", { class: "pill pill-" + kind, text: label }); }
  function toast(msg) {
    var el = h("div", { class: "a-toast", role: "status", text: msg });
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2800);
  }
  /** Parses "12 900", "12900,50" or "12900.5" into minor units. Returns null if invalid. */
  function parseMoney(str) {
    var s = String(str).replace(/\s/g, "").replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    return Math.round(parseFloat(s) * 100);
  }
  function moneyInput(minor) { return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2); }

  function api(method, url, body, raw) {
    var headers = { Accept: "application/json" };
    var opts = { method: method, headers: headers, credentials: "same-origin" };
    if (method !== "GET" && me) headers["X-CSRF-Token"] = me.csrf;
    if (raw) { headers["Content-Type"] = raw.type; opts.body = raw; }
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        var e = (data && data.error) || {};
        var err = { status: res.status, code: e.code || "SERVER_ERROR", message: e.message, fields: e.fields };
        if (res.status === 401 && me) { me = null; render(); }
        throw err;
      });
    }, function () { throw { status: 0, code: "NETWORK" }; });
  }
  function errText(err) {
    if (err.code in ERRORS && ERRORS[err.code]) return ERRORS[err.code];
    return err.message || "Something went wrong. Please try again.";
  }

  /* ---------------------------------------------------------------- layout */
  function shell(active, content) {
    clear(app);
    app.appendChild(h("header", { class: "a-bar" }, h("div", { class: "a-bar-inner" },
      h("div", { class: "a-brand" }, h("em", { text: "Rasch & Q" }), " Design — Admin"),
      h("nav", { class: "a-nav", "aria-label": "Admin" },
        h("a", { href: "#/orders", "aria-current": active === "orders" ? "page" : "false", text: "Orders" }),
        h("a", { href: "#/products", "aria-current": active === "products" ? "page" : "false", text: "Products" })),
      h("div", { class: "a-user" }, h("span", { text: me.email }),
        h("button", { type: "button", text: "Log out", onclick: logout })))));
    var main = h("main", { class: "a-main" });
    main.appendChild(content);
    app.appendChild(main);
    return main;
  }
  function logout() {
    api("POST", "/api/admin/logout", {}).catch(function () {}).then(function () { me = null; location.hash = ""; render(); });
  }
  function alertBox(kind, text) { return h("div", { class: "a-alert" + (kind ? " is-" + kind : ""), role: kind === "error" ? "alert" : "status", text: text }); }

  /* ------------------------------------------------------------------ login */
  function renderLogin() {
    clear(app);
    var msg = h("div");
    var email = h("input", { class: "a-input", type: "email", id: "l-email", autocomplete: "username", required: true });
    var pw = h("input", { class: "a-input", type: "password", id: "l-pw", autocomplete: "current-password", required: true });
    var btn = h("button", { class: "a-btn", type: "submit", text: "Sign in" });
    var form = h("form", { novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      clear(msg);
      btn.disabled = true;
      api("POST", "/api/admin/login", { email: email.value, password: pw.value }).then(function (d) {
        me = { email: d.email, csrf: d.csrf };
        return api("GET", "/api/admin/me");
      }).then(function (d) { me = { email: d.email, csrf: d.csrf, payment_mode: d.payment_mode, email_enabled: d.email_enabled, currency: d.currency }; render(); })
        .catch(function (err) { me = null; btn.disabled = false; msg.appendChild(alertBox("error", errText(err))); });
    } },
      h("div", { class: "a-field" }, h("label", { for: "l-email", text: "Email" }), email),
      h("div", { class: "a-field" }, h("label", { for: "l-pw", text: "Password" }), pw), msg, btn);
    app.appendChild(h("div", { class: "a-login" }, h("div", { class: "a-card" }, h("h1", { text: "Sign in" }), h("p", { text: "Rasch o Q Design shop admin" }), form)));
    email.focus();
  }

  /* ----------------------------------------------------------------- orders */
  var ordersState = { search: "", status: "", page: 1 };

  function renderOrders() {
    var wrap = h("div");
    var tableBox = h("div");
    var timer = null;

    var search = h("input", { type: "search", placeholder: "Search order number, name, email or phone", "aria-label": "Search orders", value: ordersState.search });
    var status = h("select", { "aria-label": "Filter by status", onchange: function () { ordersState.status = status.value; ordersState.page = 1; load(); } });
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { ordersState.search = search.value; ordersState.page = 1; load(); }, 300);
    });

    function fillStatus(counts) {
      clear(status);
      var total = 0;
      Object.keys(counts).forEach(function (k) { total += counts[k]; });
      status.appendChild(h("option", { value: "", text: "All statuses (" + total + ")" }));
      STATUSES.forEach(function (s) {
        var o = h("option", { value: s, text: STATUS_LABEL[s] + " (" + (counts[s] || 0) + ")" });
        if (s === ordersState.status) o.selected = true;
        status.appendChild(o);
      });
    }

    function load() {
      var q = "?page=" + ordersState.page + (ordersState.status ? "&status=" + ordersState.status : "") + (ordersState.search ? "&search=" + encodeURIComponent(ordersState.search) : "");
      api("GET", "/api/admin/orders" + q).then(function (d) {
        fillStatus(d.counts);
        clear(tableBox);
        if (!d.orders.length) { tableBox.appendChild(h("div", { class: "a-table-wrap" }, h("div", { class: "a-empty", text: "No orders found." }))); return; }
        var rows = d.orders.map(function (o) {
          return h("tr", { class: "is-click", tabindex: "0", onclick: function () { location.hash = "#/orders/" + o.id; }, onkeydown: function (e) { if (e.key === "Enter") location.hash = "#/orders/" + o.id; } },
            h("td", null, h("a", { class: "row-link", href: "#/orders/" + o.id, text: o.order_number })),
            h("td", { text: date(o.created_at) }),
            h("td", null, o.customer_first_name + " " + o.customer_last_name, h("br"), h("small", { text: o.customer_email })),
            h("td", { class: "num", text: String(o.item_count) }),
            h("td", { class: "num", text: money(o.total, o.currency) }),
            h("td", null, pill(o.payment_status, PAY_LABEL[o.payment_status])),
            h("td", null, pill(o.order_status, STATUS_LABEL[o.order_status])));
        });
        tableBox.appendChild(h("div", { class: "a-table-wrap" }, h("table", { class: "a-table" },
          h("thead", null, h("tr", null, ["Order", "Date", "Customer", "Items", "Total", "Payment", "Status"].map(function (c, i) { return h("th", { scope: "col", class: i === 3 || i === 4 ? "num" : "", text: c }); }))),
          h("tbody", null, rows))));
        tableBox.appendChild(h("div", { class: "a-pager" },
          h("span", { text: d.total + " orders · page " + d.page + " of " + d.pages }),
          h("button", { class: "a-btn is-ghost is-sm", type: "button", text: "Previous", disabled: d.page <= 1, onclick: function () { ordersState.page -= 1; load(); } }),
          h("button", { class: "a-btn is-ghost is-sm", type: "button", text: "Next", disabled: d.page >= d.pages, onclick: function () { ordersState.page += 1; load(); } })));
      }).catch(function (err) { clear(tableBox).appendChild(alertBox("error", errText(err))); });
    }

    wrap.appendChild(h("div", { class: "a-title" }, h("h1", { text: "Orders" })));
    if (me.payment_mode === "manual") wrap.appendChild(alertBox("warn", "Stripe is not connected. Orders are saved as unpaid; use “Mark payment received” on each order once the customer has paid."));
    wrap.appendChild(h("div", { class: "a-toolbar" }, search, status));
    wrap.appendChild(tableBox);
    shell("orders", wrap);
    fillStatus({});
    load();
  }

  function renderOrder(id) {
    var wrap = h("div");
    shell("orders", wrap);
    wrap.appendChild(h("p", { text: "Loading…" }));

    function show(o, notice) {
      clear(wrap);
      if (notice) wrap.appendChild(alertBox(notice.kind, notice.text));
      wrap.appendChild(h("p", null, h("a", { href: "#/orders", text: "← All orders" })));
      wrap.appendChild(h("div", { class: "a-title" },
        h("h1", { text: o.order_number }),
        h("div", { class: "a-actions" }, pill(o.payment_status, "Payment: " + PAY_LABEL[o.payment_status]), pill(o.order_status, STATUS_LABEL[o.order_status]))));

      if (o.refund_required) wrap.appendChild(alertBox("error", "This order is cancelled but the customer has paid. Issue a refund in the Stripe dashboard (or by other means for manual payments)."));
      if (o.events.some(function (e) { return e.event === "payment_amount_mismatch"; }) && o.payment_status !== "paid") {
        wrap.appendChild(alertBox("error", "Stripe reported a payment amount that differs from this order, so it was NOT marked as paid. Check the payment in the Stripe dashboard."));
      }

      var items = h("table", { class: "a-table" },
        h("thead", null, h("tr", null, h("th", { text: "Item" }), h("th", { class: "num", text: "Qty" }), h("th", { class: "num", text: "Unit price" }), h("th", { class: "num", text: "Total" }))),
        h("tbody", null, o.items.map(function (i) {
          return h("tr", null, h("td", null, i.product_name, i.variant_label ? h("br") : null, i.variant_label ? h("small", { text: i.variant_label }) : null),
            h("td", { class: "num", text: String(i.quantity) }), h("td", { class: "num", text: money(i.unit_price, o.currency) }), h("td", { class: "num", text: money(i.total_price, o.currency) }));
        })),
        h("tfoot", null,
          h("tr", null, h("td", { colspan: "3", text: "Subtotal" }), h("td", { class: "num", text: money(o.subtotal, o.currency) })),
          h("tr", null, h("td", { colspan: "3", text: "Shipping" }), h("td", { class: "num", text: money(o.shipping_cost, o.currency) })),
          h("tr", null, h("td", { colspan: "3" }, h("strong", { text: "Total" })), h("td", { class: "num" }, h("strong", { text: money(o.total, o.currency) })))));

      var customer = h("dl", { class: "a-kv" },
        h("dt", { text: "Name" }), h("dd", { text: o.customer_first_name + " " + o.customer_last_name }),
        h("dt", { text: "Email" }), h("dd", null, h("a", { href: "mailto:" + o.customer_email, text: o.customer_email })),
        h("dt", { text: "Phone" }), h("dd", null, h("a", { href: "tel:" + o.customer_phone.replace(/[^\d+]/g, ""), text: o.customer_phone })),
        h("dt", { text: "Address" }), h("dd", null, o.shipping_address, o.shipping_address2 ? h("br") : null, o.shipping_address2 || null, h("br"), o.shipping_postal_code + " " + o.shipping_city, h("br"), o.shipping_country),
        h("dt", { text: "Placed" }), h("dd", { text: date(o.created_at) }),
        h("dt", { text: "Payment" }), h("dd", { text: (o.payment_provider === "stripe" ? "Stripe" : "Manual") + (o.paid_at ? " · paid " + date(o.paid_at) : "") }),
        h("dt", { text: "Language" }), h("dd", { text: o.language === "en" ? "English" : "Swedish" }));

      // status form
      var sel = h("select", { class: "a-select", id: "o-status" }, STATUSES.map(function (s) {
        var opt = h("option", { value: s, text: STATUS_LABEL[s] });
        if (s === o.order_status) opt.selected = true;
        return opt;
      }));
      var track = h("input", { class: "a-input", id: "o-track", value: o.tracking_number || "", maxlength: "100", placeholder: "Optional" });
      var save = h("button", { class: "a-btn", type: "button", text: "Save changes", onclick: function () {
        if (sel.value === "cancelled" && o.order_status !== "cancelled" &&
            !confirm("Cancel this order? The reserved stock is returned. Cancelled orders cannot be reopened.")) return;
        save.disabled = true;
        api("PATCH", "/api/admin/orders/" + o.id, { order_status: sel.value, tracking_number: track.value }).then(function (d) {
          show(d.order, { kind: "ok", text: "Order updated." });
        }).catch(function (err) { save.disabled = false; formMsg.textContent = errText(err); formMsg.hidden = false; });
      } });
      var formMsg = h("p", { class: "a-err", role: "alert", hidden: true });
      var statusCard = h("div", { class: "a-card" }, h("h2", { text: "Status" }),
        h("div", { class: "a-field" }, h("label", { for: "o-status", text: "Order status" }), sel),
        h("div", { class: "a-field" }, h("label", { for: "o-track", text: "Tracking number" }), track,
          h("p", { class: "hint", text: "Moving an order to Shipped emails the customer (if email is set up)." })),
        formMsg, h("div", { class: "a-actions" }, save));

      if (o.can_mark_paid) {
        statusCard.appendChild(h("div", { style: "margin-top:20px;padding-top:20px;border-top:1px solid var(--color-line)" },
          h("p", { class: "hint", style: "margin-bottom:10px;font-size:.85rem;color:var(--color-ink-soft)", text: "Payment is not connected to this order. Once the customer has paid (Swish, invoice, in store…), confirm it here." }),
          h("button", { class: "a-btn is-ghost", type: "button", text: "Mark payment received", onclick: function () {
            if (!confirm("Confirm that you have received the payment for " + o.order_number + "?")) return;
            api("POST", "/api/admin/orders/" + o.id + "/mark-paid", {}).then(function (d) { show(d.order, { kind: "ok", text: "Payment marked as received." }); })
              .catch(function (err) { formMsg.textContent = errText(err); formMsg.hidden = false; });
          } })));
      }

      var events = h("ul", { class: "a-timeline" }, o.events.slice().reverse().map(function (e) {
        return h("li", null, h("span", { text: e.event.replace(/_/g, " ") + (e.detail ? ": " + e.detail : "") }), h("small", { text: date(e.at) + " · " + e.actor }));
      }));
      var emails = o.emails.length ? h("ul", { class: "a-timeline" }, o.emails.map(function (m) {
        return h("li", null, h("span", { text: m.template.replace(/_/g, " ") + " → " + m.recipient }), h("small", { text: m.status + " · " + date(m.created_at) }));
      })) : h("p", { class: "hint", style: "color:var(--color-ink-soft);font-size:.87rem", text: "No emails sent." });

      wrap.appendChild(h("div", { class: "a-grid" },
        h("div", null, h("div", { class: "a-card" }, h("h2", { text: "Ordered watches" }), h("div", { class: "a-table-wrap", style: "border:0" }, items)),
          h("div", { class: "a-card" }, h("h2", { text: "Customer" }), customer)),
        h("div", null, statusCard, h("div", { class: "a-card" }, h("h2", { text: "History" }), events), h("div", { class: "a-card" }, h("h2", { text: "Emails" }), emails))));
    }

    api("GET", "/api/admin/orders/" + id).then(function (d) { show(d.order); })
      .catch(function (err) { clear(wrap).appendChild(alertBox("error", err.status === 404 ? "Order not found." : errText(err))); });
  }

  /* --------------------------------------------------------------- products */
  function renderProducts() {
    var wrap = h("div");
    shell("products", wrap);
    wrap.appendChild(h("div", { class: "a-title" }, h("h1", { text: "Products" }), h("a", { class: "a-btn", href: "#/products/new", text: "Add product" })));
    var box = h("div");
    wrap.appendChild(box);
    api("GET", "/api/admin/products").then(function (d) {
      if (!d.products.length) return box.appendChild(h("div", { class: "a-table-wrap" }, h("div", { class: "a-empty", text: "No products yet. Add your first watch." })));
      box.appendChild(h("div", { class: "a-table-wrap" }, h("table", { class: "a-table" },
        h("thead", null, h("tr", null, h("th", { scope: "col", text: "" }), h("th", { scope: "col", text: "Watch" }), h("th", { scope: "col", class: "num", text: "Price" }), h("th", { scope: "col", class: "num", text: "Stock" }), h("th", { scope: "col", text: "Visible" }))),
        h("tbody", null, d.products.map(function (p) {
          return h("tr", { class: "is-click", onclick: function () { location.hash = "#/products/" + p.id; } },
            h("td", null, p.images[0] ? h("img", { class: "thumb", src: p.images[0], alt: "" }) : null),
            h("td", null, h("a", { class: "row-link", href: "#/products/" + p.id, text: p.name }), p.variants.length ? h("br") : null, p.variants.length ? h("small", { text: p.variants.length + " variants" }) : null),
            h("td", { class: "num", text: money(p.price, p.currency) }),
            h("td", { class: "num", text: String(p.stock_quantity) }),
            h("td", null, pill(p.active ? "active" : "cancelled", p.active ? "Active" : "Hidden")));
        })))));
    }).catch(function (err) { box.appendChild(alertBox("error", errText(err))); });
  }

  function resizeImage(file) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, 1800 / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 1500000) return resolve(file);
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { resolve(b && /^image\/(jpeg|png|webp)$/.test(b.type) ? b : file); }, "image/webp", 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function renderProductForm(id) {
    var isNew = id === "new";
    var wrap = h("div");
    shell("products", wrap);
    wrap.appendChild(h("p", { text: "Loading…" }));

    (isNew ? Promise.resolve({ product: { name: "", name_en: "", category: "all", short_description: "", short_description_en: "", description: "", description_en: "", price: 0, images: [], variants: [], specs: [], stock_quantity: 0, active: true, sort_order: 0, slug: "" } })
      : api("GET", "/api/admin/products/" + id)).then(function (d) { build(d.product); })
      .catch(function (err) { clear(wrap).appendChild(alertBox("error", err.status === 404 ? "Product not found." : errText(err))); });

    function build(p) {
      var state = { images: p.images.slice(), variants: p.variants.map(function (v) { return Object.assign({}, v); }), specs: p.specs.map(function (s) { return Object.assign({}, s); }) };
      var fields = {};
      var errBox = h("div");
      var imagesBox = h("div");
      var variantsBox = h("div");
      var specsBox = h("div");
      var stockInput;
      var category = h("select", { class: "a-select", id: "p-category" }, [
        ["all", "Alla smycken"], ["rings", "Ringar"], ["earrings", "Örhängen"],
        ["necklaces", "Halsband"], ["bracelets", "Armband"], ["sale", "Sista chansen"],
      ].map(function (entry) {
        var option = h("option", { value: entry[0], text: entry[1] });
        option.selected = (p.category || "all") === entry[0];
        return option;
      }));

      function text(name, label, opts) {
        opts = opts || {};
        var input = opts.area ? h("textarea", { class: "a-textarea", id: "p-" + name, rows: opts.rows || 4 }) : h("input", { class: "a-input", id: "p-" + name, type: "text", maxlength: opts.max });
        input.value = opts.value !== undefined ? opts.value : (p[name] || "");
        fields[name] = input;
        var err = h("p", { class: "a-err", hidden: true, id: "perr-" + name });
        return h("div", { class: "a-field", "data-field": name }, h("label", { for: "p-" + name, text: label }), input, opts.hint ? h("p", { class: "hint", text: opts.hint }) : null, err);
      }

      function drawImages() {
        clear(imagesBox);
        var list = h("div", { class: "a-images" }, state.images.map(function (src, i) {
          return h("div", { class: "a-image" }, h("img", { src: src, alt: "" }), h("div", null,
            h("button", { type: "button", "aria-label": "Move earlier", text: "←", disabled: i === 0, onclick: function () { state.images.splice(i - 1, 0, state.images.splice(i, 1)[0]); drawImages(); } }),
            h("button", { type: "button", "aria-label": "Remove image", text: "Remove", onclick: function () { state.images.splice(i, 1); drawImages(); } }),
            h("button", { type: "button", "aria-label": "Move later", text: "→", disabled: i === state.images.length - 1, onclick: function () { state.images.splice(i + 1, 0, state.images.splice(i, 1)[0]); drawImages(); } })));
        }));
        var msg = h("p", { class: "a-err", role: "alert", hidden: true });
        var input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true, "aria-label": "Upload images", onchange: function () {
          var files = Array.prototype.slice.call(input.files);
          msg.hidden = true;
          var chain = Promise.resolve();
          files.forEach(function (f) {
            chain = chain.then(function () { return resizeImage(f); }).then(function (blob) { return api("POST", "/api/admin/uploads", undefined, blob); })
              .then(function (r) { state.images.push(r.url); drawImages(); })
              .catch(function (err) { msg.textContent = f.name + ": " + errText(err); msg.hidden = false; });
          });
        } });
        imagesBox.appendChild(list);
        imagesBox.appendChild(input);
        imagesBox.appendChild(h("p", { class: "hint", style: "font-size:.8rem;color:var(--color-ink-soft);margin-top:6px", text: "The first image is the main image. Portrait (4:5) photos look best. Large photos are resized automatically." }));
        imagesBox.appendChild(msg);
      }

      function drawVariants() {
        clear(variantsBox);
        var rows = h("div", { class: "a-rows variants" }, state.variants.map(function (v, i) {
          return h("div", { class: "row" },
            h("input", { class: "a-input", "aria-label": "Variant name (Swedish)", placeholder: "Name (Swedish)", value: v.label, oninput: function (e) { v.label = e.target.value; } }),
            h("input", { class: "a-input", "aria-label": "Variant name (English)", placeholder: "Name (English)", value: v.label_en || "", oninput: function (e) { v.label_en = e.target.value; } }),
            h("input", { class: "a-input", type: "number", min: "0", step: "1", "aria-label": "Variant stock", value: String(v.stock_quantity), oninput: function (e) { v.stock_quantity = e.target.value === "" ? "" : parseInt(e.target.value, 10); syncStock(); } }),
            h("button", { class: "x", type: "button", "aria-label": "Remove variant", text: "×", onclick: function () { state.variants.splice(i, 1); drawVariants(); syncStock(); } }));
        }));
        variantsBox.appendChild(rows);
        variantsBox.appendChild(h("button", { class: "a-btn is-ghost is-sm", type: "button", text: "Add variant", onclick: function () { state.variants.push({ label: "", label_en: "", stock_quantity: 0 }); drawVariants(); syncStock(); } }));
        variantsBox.appendChild(h("p", { class: "hint", style: "font-size:.8rem;color:var(--color-ink-soft);margin-top:8px", text: "Use variants for colours or dial types. Each variant has its own stock." }));
      }
      function syncStock() {
        if (!stockInput) return;
        var has = state.variants.length > 0;
        stockInput.disabled = has;
        if (has) stockInput.value = String(state.variants.reduce(function (n, v) { return n + (parseInt(v.stock_quantity, 10) || 0); }, 0));
      }

      function drawSpecs() {
        clear(specsBox);
        specsBox.appendChild(h("div", { class: "a-rows specs" }, state.specs.map(function (s, i) {
          function inp(key, ph) { return h("input", { class: "a-input", "aria-label": ph, placeholder: ph, value: s[key] || "", oninput: function (e) { s[key] = e.target.value; } }); }
          return h("div", { class: "row" }, inp("label", "Label (sv)"), inp("value", "Value (sv)"), inp("label_en", "Label (en)"), inp("value_en", "Value (en)"),
            h("button", { class: "x", type: "button", "aria-label": "Remove specification", text: "×", onclick: function () { state.specs.splice(i, 1); drawSpecs(); } }));
        })));
        specsBox.appendChild(h("button", { class: "a-btn is-ghost is-sm", type: "button", text: "Add specification", onclick: function () { state.specs.push({ label: "", value: "", label_en: "", value_en: "" }); drawSpecs(); } }));
      }

      var priceField = h("div", { class: "a-field", "data-field": "price" }, h("label", { for: "p-price", text: "Price (" + ((me && me.currency) || "SEK") + ", incl. VAT)" }),
        (fields.price = h("input", { class: "a-input", id: "p-price", inputmode: "decimal", value: moneyInput(p.price || 0) })), h("p", { class: "a-err", hidden: true, id: "perr-price" }));
      stockInput = h("input", { class: "a-input", id: "p-stock_quantity", type: "number", min: "0", step: "1", value: String(p.stock_quantity || 0) });
      fields.stock_quantity = stockInput;
      var stockField = h("div", { class: "a-field", "data-field": "stock_quantity" }, h("label", { for: "p-stock_quantity", text: "Stock" }), stockInput,
        h("p", { class: "hint", text: "With variants, stock is the sum of the variants." }), h("p", { class: "a-err", hidden: true, id: "perr-stock_quantity" }));
      var active = h("input", { type: "checkbox", id: "p-active" });
      active.checked = !!p.active;
      var sort = h("input", { class: "a-input", id: "p-sort", type: "number", step: "1", value: String(p.sort_order || 0) });

      drawImages(); drawVariants(); drawSpecs(); syncStock();

      function collect() {
        var priceMinor = parseMoney(fields.price.value);
        return {
          name: fields.name.value, name_en: fields.name_en.value,
          category: category.value,
          short_description: fields.short_description.value, short_description_en: fields.short_description_en.value,
          description: fields.description.value, description_en: fields.description_en.value,
          price: priceMinor === null ? -1 : priceMinor,
          stock_quantity: parseInt(stockInput.value, 10),
          active: active.checked, sort_order: parseInt(sort.value, 10) || 0,
          images: state.images,
          variants: state.variants.map(function (v) { return { id: v.id, label: v.label, label_en: v.label_en || "", stock_quantity: v.stock_quantity === "" ? -1 : v.stock_quantity }; }),
          specs: state.specs,
        };
      }
      function showFieldErrors(f) {
        wrap.querySelectorAll(".a-field").forEach(function (el) { el.classList.remove("has-error"); });
        wrap.querySelectorAll('[id^="perr-"]').forEach(function (el) { el.hidden = true; });
        Object.keys(f || {}).forEach(function (k) {
          var el = document.getElementById("perr-" + k);
          if (el) { el.textContent = FIELD_ERRORS[f[k]] || "Invalid"; el.hidden = false; el.parentNode.classList.add("has-error"); }
        });
        var first = Object.keys(f || {})[0];
        var target = first && (document.getElementById("p-" + first) || null);
        if (target) target.focus();
      }

      var saveBtn = h("button", { class: "a-btn", type: "submit", text: isNew ? "Add product" : "Save changes" });
      var form = h("form", { novalidate: true, onsubmit: function (e) {
        e.preventDefault();
        clear(errBox);
        showFieldErrors({});
        var payload = collect();
        saveBtn.disabled = true;
        (isNew ? api("POST", "/api/admin/products", payload) : api("PUT", "/api/admin/products/" + id, payload)).then(function (d) {
          toast("Saved");
          if (isNew) location.hash = "#/products/" + d.product.id; else build(d.product);
        }).catch(function (err) {
          saveBtn.disabled = false;
          if (err.fields) { showFieldErrors(err.fields); errBox.appendChild(alertBox("error", "Please check the highlighted fields.")); }
          else errBox.appendChild(alertBox("error", errText(err)));
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      } },
        errBox,
        h("div", { class: "a-card" }, h("h2", { text: "Basics" }),
          h("div", { class: "a-grid-2" }, text("name", "Name (Swedish)", { max: 120 }), text("name_en", "Name (English, optional)", { max: 120 })),
          h("div", { class: "a-grid-2" }, priceField, stockField),
          h("div", { class: "a-field", "data-field": "category" }, h("label", { for: "p-category", text: "Category" }), category),
          h("div", { class: "a-field" }, h("div", { class: "a-check" }, active, h("label", { for: "p-active", style: "margin:0", text: "Visible in the shop" })),
            h("p", { class: "hint", text: "Hidden products cannot be bought and are removed from customers' carts." })),
          h("div", { class: "a-field", style: "max-width:180px" }, h("label", { for: "p-sort", text: "Sort order" }), sort, h("p", { class: "hint", text: "Lower numbers first." }))),
        h("div", { class: "a-card" }, h("h2", { text: "Description" }),
          h("div", { class: "a-grid-2" }, text("short_description", "Short description (Swedish)", { area: true, rows: 2 }), text("short_description_en", "Short description (English)", { area: true, rows: 2 })),
          h("div", { class: "a-grid-2" }, text("description", "Full description (Swedish)", { area: true, rows: 7, hint: "Blank line = new paragraph." }), text("description_en", "Full description (English)", { area: true, rows: 7 }))),
        h("div", { class: "a-card" }, h("h2", { text: "Images" }), imagesBox, h("p", { class: "a-err", id: "perr-images", hidden: true })),
        h("div", { class: "a-card" }, h("h2", { text: "Variants" }), variantsBox, h("p", { class: "a-err", id: "perr-variants", hidden: true })),
        h("div", { class: "a-card" }, h("h2", { text: "Specifications" }), specsBox),
        h("div", { class: "a-actions" }, saveBtn, h("a", { class: "a-btn is-ghost", href: "#/products", text: "Back to products" }),
          isNew ? null : h("button", { class: "a-btn is-danger", type: "button", text: "Delete product", onclick: function () {
            if (!confirm("Delete this product permanently? Past orders keep their name and price. To just stop selling it, untick “Visible in the shop” instead.")) return;
            api("DELETE", "/api/admin/products/" + id).then(function () { toast("Deleted"); location.hash = "#/products"; }).catch(function (err) { errBox.appendChild(alertBox("error", errText(err))); });
          } })));

      clear(wrap);
      wrap.appendChild(h("p", null, h("a", { href: "#/products", text: "← All products" })));
      wrap.appendChild(h("div", { class: "a-title" }, h("h1", { text: isNew ? "Add product" : p.name }),
        !isNew && p.active ? h("a", { class: "a-btn is-ghost is-sm", href: "/produkt.html?p=" + encodeURIComponent(p.slug), target: "_blank", rel: "noopener", text: "View in shop" }) : null));
      wrap.appendChild(form);
    }
  }

  /* ----------------------------------------------------------------- router */
  function render() {
    if (!me) return renderLogin();
    var hash = location.hash.replace(/^#/, "") || "/orders";
    var m;
    if (hash === "/orders") renderOrders();
    else if ((m = /^\/orders\/(\d+)$/.exec(hash))) renderOrder(m[1]);
    else if (hash === "/products") renderProducts();
    else if (hash === "/products/new") renderProductForm("new");
    else if ((m = /^\/products\/(\d+)$/.exec(hash))) renderProductForm(m[1]);
    else location.hash = "#/orders";
  }
  window.addEventListener("hashchange", render);

  api("GET", "/api/admin/me").then(function (d) {
    me = { email: d.email, csrf: d.csrf, payment_mode: d.payment_mode, email_enabled: d.email_enabled, currency: d.currency };
    render();
  }).catch(function () { me = null; render(); });
})();
