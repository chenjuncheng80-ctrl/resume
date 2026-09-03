/* =========================================================
   Chan Chun Shing — Portfolio & Resume
   Interactions: scroll reveal, nav state, mobile menu
   ========================================================= */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----- Footer year ----- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ----- Nav scrolled state + dark-section inversion ----- */
  var nav = document.querySelector(".nav");
  var contactSection = document.getElementById("contact");
  function onScrollNav() {
    if (nav) {
      nav.classList.toggle("is-scrolled", window.scrollY > 24);
      if (contactSection) {
        var darkStart = contactSection.offsetTop - nav.offsetHeight;
        nav.classList.toggle("is-on-dark", window.scrollY >= darkStart);
      }
    }
  }
  window.addEventListener("scroll", onScrollNav, { passive: true });
  onScrollNav();

  /* ----- Mobile menu ----- */
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("is-open");
        toggle.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      });
    });
  }

  /* ----- Scroll reveal (stagger via data attribute) ----- */
  var reveals = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    // Assign stagger index within each group (siblings)
    reveals.forEach(function (el) {
      var siblings = Array.prototype.slice.call(el.parentNode.children).filter(function (c) {
        return c.classList.contains("reveal");
      });
      el.style.setProperty("--i", String(siblings.indexOf(el)));
    });

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ----- Active nav link highlight ----- */
  var sections = document.querySelectorAll("main section[id]");
  var navLinks = document.querySelectorAll(".nav__link");
  if ("IntersectionObserver" in window && sections.length) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var id = entry.target.getAttribute("id");
          navLinks.forEach(function (link) {
            var href = link.getAttribute("href");
            link.classList.toggle("is-active", href === "#" + id);
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ----- Portfolio category filter ----- */
  var filters = document.querySelectorAll(".filter");
  var cards = document.querySelectorAll(".grid .card");
  filters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      filters.forEach(function (b) {
        var active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", String(active));
      });
      var f = btn.getAttribute("data-filter");
      cards.forEach(function (card) {
        var cats = (card.getAttribute("data-category") || "").split(" ");
        var show = f === "all" || cats.indexOf(f) !== -1;
        if (show) {
          card.classList.remove("is-hidden");
          card.classList.remove("animate-in");
          void card.offsetWidth; /* restart animation */
          card.classList.add("animate-in");
        } else {
          card.classList.add("is-hidden");
        }
      });
    });
  });

  /* ----- Lazy video playback (play only when in viewport) ----- */
  var videos = document.querySelectorAll(".card video");
  if ("IntersectionObserver" in window && videos.length) {
    var vio = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var v = entry.target;
          if (entry.isIntersecting) {
            v.play().catch(function () {});
          } else {
            v.pause();
          }
        });
      },
      { threshold: 0.2 }
    );
    videos.forEach(function (v) { vio.observe(v); });
  }
})();
