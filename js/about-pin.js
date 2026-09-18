/* =========================================================
   About pin — a wheel-driven two-stage scene
   ---------------------------------------------------------
   The About section is taller than the window. Its stage sticks
   to the top of the viewport, so the wheel no longer moves the
   page through the section: it drives the scene instead.

     stage 1  — the About text, held in place
     stage 2  — the text tips upward and a name card swings in
                from below, rotating flat as it arrives

   Nothing here animates on its own. The script only reads the
   scroll position and writes three numbers onto the stage
   (--fit / --about-out / --card-in); every movement lives in
   css/styles.css. That keeps the timing in one place (the
   DEFAULTS windows below) and means the scene is always in
   sync with the wheel — including when the wheel goes back up.

   Without JavaScript the section is an ordinary About block and
   the card stays hidden; the same happens under
   prefers-reduced-motion.
   ========================================================= */

(function (global) {
  "use strict";

  var DEFAULTS = {
    pin: "#aboutPin",
    stage: ".pin__stage",
    fit: ".pin__fit",
    cardLayer: ".pin__layer--card",
    nav: ".nav",
    // Progress windows, as a fraction of the pinned runway. The wheel has to
    // travel `holdUntil` before anything moves at all — that dead zone is what
    // makes the section feel locked rather than merely tall.
    holdUntil: 0.16,
    outFrom: 0.16,
    outTo: 0.56,
    inFrom: 0.28,
    inTo: 0.88,
    margin: 0.94          // share of the free height the text may occupy
  };

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function ramp(v, a, b) { var d = b - a; return d <= 0 ? (v >= b ? 1 : 0) : clamp01((v - a) / d); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function AboutPin(options) {
    var o = {}, k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) o[k] = DEFAULTS[k];
    if (options) for (k in options) if (Object.prototype.hasOwnProperty.call(options, k)) o[k] = options[k];
    this.o = o;

    this.pin = document.querySelector(o.pin);
    if (!this.pin) return;
    this.stage = this.pin.querySelector(o.stage);
    this.fitEl = this.pin.querySelector(o.fit);
    this.cardLayer = this.pin.querySelector(o.cardLayer);
    if (!this.stage || !this.fitEl) return;

    if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var nav = document.querySelector(o.nav);
    this.navH = nav ? nav.offsetHeight : 0;

    document.documentElement.classList.add("pin-ready");
    this.progress = -1;
    this.frame = 0;

    this._bind();
    this.measure();
    this.update();
  }

  /* Scale the text block down until it fits a short window. A section that
     was authored for a 900px screen must not be clipped on a 700px one. */
  AboutPin.prototype.measure = function () {
    var free = (global.innerHeight - this.navH) * this.o.margin;
    var natural = this.fitEl.offsetHeight;
    this.fit = natural > 0 ? Math.min(1, free / natural) : 1;
    this.stage.style.setProperty("--fit", this.fit.toFixed(4));
    this.stage.style.paddingTop = this.navH + "px";
  };

  AboutPin.prototype.update = function () {
    var rect = this.pin.getBoundingClientRect();
    var runway = this.pin.offsetHeight - global.innerHeight;
    var p = runway > 0 ? clamp01(-rect.top / runway) : 0;
    if (p === this.progress) return;

    this.progress = p;
    var o = this.o;
    var out = p < o.holdUntil ? 0 : smoothstep(ramp(p, o.outFrom, o.outTo));
    var inn = easeOut(ramp(p, o.inFrom, o.inTo));

    var s = this.stage.style;
    s.setProperty("--about-out", out.toFixed(4));
    s.setProperty("--card-in", inn.toFixed(4));

    // only let the card take clicks once it has actually arrived
    if (this.cardLayer) {
      var live = inn >= 0.995;
      if (live !== this.cardLive) {
        this.cardLive = live;
        this.cardLayer.classList.toggle("is-live", live);
        if (live) this.cardLayer.removeAttribute("aria-hidden");
        else this.cardLayer.setAttribute("aria-hidden", "true");
      }
    }
  };

  AboutPin.prototype._bind = function () {
    var self = this;
    this._onScroll = function () {
      if (self.frame) return;
      self.frame = global.requestAnimationFrame(function () {
        self.frame = 0;
        self.update();
      });
    };
    this._onResize = function () {
      self.navH = (document.querySelector(self.o.nav) || {}).offsetHeight || 0;
      self.measure();
      self.progress = -1;
      self.update();
    };
    global.addEventListener("scroll", this._onScroll, { passive: true });
    global.addEventListener("resize", this._onResize);

    // Webfonts land after DOMContentLoaded and change the text height, which
    // is exactly what --fit is measuring.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        self.measure();
        self.progress = -1;
        self.update();
      });
    }
  };

  AboutPin.prototype.destroy = function () {
    if (this.frame) global.cancelAnimationFrame(this.frame);
    global.removeEventListener("scroll", this._onScroll);
    global.removeEventListener("resize", this._onResize);
    document.documentElement.classList.remove("pin-ready");
    this.stage.style.paddingTop = "";
    this.stage.style.removeProperty("--fit");
    this.stage.style.removeProperty("--about-out");
    this.stage.style.removeProperty("--card-in");
  };

  global.AboutPin = AboutPin;

  function boot() {
    try {
      global.__aboutPin = new AboutPin();
    } catch (err) {
      if (global.console && console.error) console.error("[about-pin] init failed", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : this);
