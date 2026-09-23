/* ==========================================================================
  Rasch o Q Design — shared site behaviour
   ========================================================================== */
(function () {
  "use strict";

  var header = document.querySelector(".site-header");
  var navToggle = document.querySelector(".nav-toggle");
  var mainNav = document.querySelector(".main-nav");

  if (mainNav) {
    var currentPage = window.location.pathname.split("/").pop() || "index.html";
    mainNav.querySelectorAll("a").forEach(function (link) {
      var linkPage = link.getAttribute("href").split("#")[0].split("?")[0];
      var isCurrent = linkPage === currentPage ||
        (currentPage === "index.html" && linkPage === "");
      if (isCurrent) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  /* Sticky header shadow/border on scroll */
  function onScroll() {
    if (!header) return;
    if (window.scrollY > 8) {
      header.classList.add("is-scrolled");
    } else {
      header.classList.remove("is-scrolled");
    }
  }
  if (header) {
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* Mobile nav toggle */
  if (navToggle && mainNav) {
    navToggle.addEventListener("click", function () {
      var isOpen = mainNav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
    mainNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        mainNav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* Footer year */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ------------------------------------------------------------------
     Language switcher (SV default / EN)
     Every translatable element carries data-sv / data-en (text) or
     data-sv-html / data-en-html (for content needing simple markup),
     and inputs use data-sv-placeholder / data-en-placeholder.
     Selection persists via localStorage across pages.
     ------------------------------------------------------------------ */
  var LANG_KEY = "mwc-lang";

  function getStoredLang() {
    try {
      return localStorage.getItem(LANG_KEY);
    } catch (e) {
      return null;
    }
  }

  function storeLang(lang) {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {
      /* ignore */
    }
  }

  function applyLang(lang) {
    document.documentElement.setAttribute("lang", lang === "en" ? "en" : "sv");
    document.body.setAttribute("data-lang", lang);

    document.querySelectorAll("[data-" + lang + "]").forEach(function (el) {
      el.textContent = el.getAttribute("data-" + lang);
    });
    document.querySelectorAll("[data-" + lang + "-html]").forEach(function (el) {
      el.innerHTML = el.getAttribute("data-" + lang + "-html");
    });
    document.querySelectorAll("[data-" + lang + "-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", el.getAttribute("data-" + lang + "-placeholder"));
    });
    document.querySelectorAll("[data-" + lang + "-aria]").forEach(function (el) {
      el.setAttribute("aria-label", el.getAttribute("data-" + lang + "-aria"));
    });

    document.querySelectorAll(".lang-switch button").forEach(function (btn) {
      var isActive = btn.getAttribute("data-lang-btn") === lang;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    /* Lets the shop pages re-render their dynamic content in the new language */
    document.dispatchEvent(new CustomEvent("mwc:lang", { detail: { lang: lang } }));
  }

  function initLang() {
    var stored = getStoredLang();
    var lang = stored === "en" ? "en" : "sv";
    applyLang(lang);

    document.querySelectorAll(".lang-switch button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var chosen = btn.getAttribute("data-lang-btn");
        storeLang(chosen);
        applyLang(chosen);
      });
    });
  }

  initLang();

  /* ------------------------------------------------------------------
     Cart badge (the cart itself lives in localStorage, managed by shop-core.js)
     ------------------------------------------------------------------ */
  function updateCartBadge() {
    var count = 0;
    try {
      var items = JSON.parse(localStorage.getItem("mwc-cart") || "[]");
      if (Array.isArray(items)) items.forEach(function (i) { count += parseInt(i.q, 10) || 0; });
    } catch (e) { count = 0; }
    document.querySelectorAll("[data-cart-count]").forEach(function (el) {
      el.textContent = count > 99 ? "99+" : String(count);
      el.hidden = count === 0;
    });
  }
  updateCartBadge();
  window.addEventListener("storage", updateCartBadge);
  document.addEventListener("mwc:cart", updateCartBadge);

  /* Submit the Formspree contact form without leaving the page. */
  var contactForm = document.querySelector("#contact-form");
  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var submitButton = contactForm.querySelector('button[type="submit"]');
      var status = contactForm.querySelector(".form-status");
      var lang = document.body.getAttribute("data-lang") || "sv";

      submitButton.disabled = true;
      status.classList.remove("is-visible");

      fetch(contactForm.action, {
        method: "POST",
        body: new FormData(contactForm),
        headers: { Accept: "application/json" }
      })
        .then(function (response) {
          if (!response.ok) throw new Error("Form submission failed");
          contactForm.reset();
          status.textContent =
            lang === "en"
              ? "Thank you for contacting us. We will get back to you as soon as we can."
              : "Tack för att ni kontaktar oss. Vi återkommer så snart vi kan.";
          status.classList.add("is-visible");
        })
        .catch(function () {
          status.textContent =
            lang === "en"
              ? "Something went wrong. Please try again or contact us by phone."
              : "Något gick fel. Försök igen eller kontakta oss per telefon.";
          status.classList.add("is-visible");
        })
        .finally(function () {
          submitButton.disabled = false;
        });
    });
  }

})();
