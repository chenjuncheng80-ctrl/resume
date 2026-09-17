/* Renders the Selected Work grid from data/works.json.
   The cards used to be hard-coded in index.html; now the admin can add,
   reorder and remove them without touching markup.

   The data arrives two ways, and we prefer the first one:
     1. data/works.js — a <script> tag that sets window.PORTFOLIO_WORKS.
        A script tag is the only way to read a data file when the page is
        opened straight from disk (file://), where fetch() of a local file is
        blocked by the browser ("Failed to fetch").
     2. data/works.json — fetched at runtime, used when works.js is missing or
        stale (for example a page cached before this change).
   The admin rewrites both files on every publish, so they never drift. */
(function () {
  "use strict";

  var GRID_ID = "workGrid";
  var FILTERS_ID = "workFilters";

  var state = { data: null, filter: "all" };
  var revealIO = null;
  var videoIO = null;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function local() {
    return window.location.protocol === "file:";
  }

  function load() {
    var inline = window.PORTFOLIO_WORKS;
    if (inline && inline.works && inline.works.length) return Promise.resolve(inline);

    return fetch("data/works.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("works.json " + r.status);
      return r.json();
    });
  }

  /* Shown only when there is no data at all. Opened from disk the usual cause
     is a missing/broken data/works.js, so say that instead of a bare "Failed
     to fetch". */
  function loadError(err) {
    if (local()) {
      return "Could not load works — data/works.js is missing or invalid. " +
        "Rebuild it with: python tools/build_works_js.py";
    }
    return "Could not load works (" + (err && err.message ? err.message : err) + ").";
  }

  function labelFor(id) {
    var cats = (state.data && state.data.categories) || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i].label;
    return id;
  }

  function makeObserver() {
    if (reduceMotion || !("IntersectionObserver" in window)) return null;
    if (!revealIO) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          revealIO.unobserve(entry.target);
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    }
    return revealIO;
  }

  function watchVideos(video) {
    if (reduceMotion || !("IntersectionObserver" in window)) return;
    if (!videoIO) {
      videoIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var v = entry.target;
          if (entry.isIntersecting) {
            var p = v.play();
            if (p && p.catch) p.catch(function () {});
          } else if (!v.paused) {
            v.pause();
          }
        });
      }, { threshold: 0.25 });
    }
    videoIO.observe(video);
  }

  /* ---------- filters ---------- */
  function renderFilters() {
    var box = document.getElementById(FILTERS_ID);
    if (!box || !state.data) return;
    box.innerHTML = "";

    var defs = [{ id: "all", label: "All" }].concat(state.data.categories || []);
    defs.forEach(function (c) {
      var b = document.createElement("button");
      b.className = "filter" + (c.id === state.filter ? " is-active" : "");
      b.type = "button";
      b.setAttribute("data-filter", c.id);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(c.id === state.filter));
      b.textContent = c.label;
      b.addEventListener("click", function () { applyFilter(c.id); });
      box.appendChild(b);
    });
  }

  function applyFilter(id) {
    state.filter = id;
    var box = document.getElementById(FILTERS_ID);
    Array.prototype.forEach.call(box.querySelectorAll(".filter"), function (b) {
      var on = b.getAttribute("data-filter") === id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });

    var cards = document.querySelectorAll("#" + GRID_ID + " .card");
    var visibleIndex = 0;
    Array.prototype.forEach.call(cards, function (card) {
      var cats = (card.getAttribute("data-category") || "").split(" ");
      var show = id === "all" || cats.indexOf(id) !== -1;
      if (show) {
        card.classList.remove("is-hidden");
        card.classList.remove("animate-in");
        void card.offsetWidth;
        var delay = visibleIndex * 55;
        visibleIndex++;
        card.style.animationDelay = delay + "ms";
        card.classList.add("animate-in");
        setTimeout(function (c) {
          c.classList.remove("animate-in");
          c.style.animationDelay = "";
        }, 650 + delay, card);
      } else {
        card.classList.add("is-hidden");
        card.classList.remove("animate-in");
        card.style.animationDelay = "";
      }
    });
  }

  /* ---------- cards ---------- */
  function renderCards() {
    var grid = document.getElementById(GRID_ID);
    if (!grid || !state.data) return;

    // Drop the stale translation records before rebuilding.
    if (window.CCSI18n && window.CCSI18n.forget) window.CCSI18n.forget(grid);
    grid.innerHTML = "";

    (state.data.works || []).forEach(function (w, i) {
      var a = document.createElement("a");
      a.className = "card reveal";
      a.setAttribute("data-category", w.category || "");
      a.href = w.link || "#contact";
      if (/^https?:/i.test(a.href) || /\.(mp4|jpg|jpeg|png|gif|webp|pdf)$/i.test(a.href)) {
        a.target = "_blank";
        a.rel = "noopener";
      }

      var media;
      if (w.type === "video" && w.src) {
        media = document.createElement("video");
        media.className = "card__img";
        media.src = w.src;
        if (w.poster) media.poster = w.poster;
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.preload = "metadata";
        watchVideos(media);
      } else {
        media = document.createElement("img");
        media.className = "card__img";
        media.src = w.src || "";
        media.alt = w.alt || w.title || "";
        media.setAttribute("loading", "lazy");
      }
      a.appendChild(media);

      var overlay = document.createElement("div");
      overlay.className = "card__overlay";
      var cat = document.createElement("span");
      cat.className = "card__cat";
      cat.textContent = labelFor(w.category);
      var title = document.createElement("h3");
      title.className = "card__title";
      title.textContent = w.title || "";
      var year = document.createElement("span");
      year.className = "card__year";
      year.textContent = w.year || "";
      overlay.appendChild(cat);
      overlay.appendChild(title);
      overlay.appendChild(year);
      a.appendChild(overlay);

      a.style.setProperty("--i", String(i));
      grid.appendChild(a);
    });

    var io = makeObserver();
    Array.prototype.forEach.call(grid.children, function (card) {
      if (io) io.observe(card);
      else card.classList.add("is-visible");
    });
  }

  function renderAll() {
    renderFilters();
    renderCards();
    applyFilter(state.filter);
    // Fresh markup is English again — re-translate if the page is in Chinese.
    if (window.CCSI18n && window.CCSI18n.get() === "zh") {
      var grid = document.getElementById(GRID_ID);
      var box = document.getElementById(FILTERS_ID);
      if (box) window.CCSI18n.apply(box);
      if (grid) window.CCSI18n.apply(grid);
    }
  }

  function start() {
    if (!document.getElementById(GRID_ID)) return;
    load().then(function (data) {
      state.data = data;
      renderAll();
    }).catch(function (err) {
      var grid = document.getElementById(GRID_ID);
      if (!grid) return;
      var note = document.createElement("p");
      note.className = "section__note";
      note.textContent = loadError(err);
      grid.innerHTML = "";
      grid.appendChild(note);
    });

    document.addEventListener("i18n:change", function () {
      if (state.data) renderAll();
    });
  }

  window.CCSWorks = { state: state, render: renderAll };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
