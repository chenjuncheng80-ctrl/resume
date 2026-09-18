/* =========================================================
   Skill fall — words that detach from the hero field and drop
   ---------------------------------------------------------
   The hero background is a field of monospace glyphs spelling out
   the owner's tools, disciplines and traits (see data-text on
   #heroAscii). This layer plucks individual words out of that
   field and lets them fall down the page until they reach the
   bottom of the About section, where they settle and fade out.

   Every token carries a WEIGHT. The weight is the whole point of
   the effect, so it drives four things at once:
     - fall speed   — heavier words accelerate harder and have a
                      higher terminal velocity
     - wander       — light words drift and tumble, heavy ones
                      drop almost straight
     - size / ink   — heavier words render a touch larger and darker
     - impact       — a heavy word squashes on landing and throws
                      more dust than a light one

   Geometry. The canvas is fixed to the viewport but every token
   is tracked in DOCUMENT coordinates and only shifted by scrollY
   at paint time. That is what lets a word leave the hero, cross
   the fold and keep going down to the end of About: a word that
   is merely clamped to the bottom of the window has not fallen
   anywhere, it has just stopped.

   A word that lands while it is off screen holds its fade until
   it has been looked at (for a few seconds, at least), so
   scrolling down to About finds words resting there rather than
   an empty section.

   Cost. Nothing runs when there is nothing in the air: the rAF
   chain stops as soon as the last token and its dust are gone and
   is restarted by the next spawn timer.
   ========================================================= */

(function (global) {
  "use strict";

  var DEFAULTS = {
    source: "#heroAscii",     // canvas whose data-text supplies the vocabulary
    landing: "#about",        // where a token comes to rest
    landOffset: 30,           // px above About's BOTTOM edge — a word falls the
                              // whole section instead of stopping at its title
    spawnLead: 60,            // a word joins the fall this far above the top of
                              // the window once the field itself has scrolled
                              // out of the way, so the trip stays watchable
    separator: "\u00b7",      // the data-text splits into words on this
    everyMin: 1000,           // ms between spawns
    everyMax: 2600,
    maxTokens: 8,
    fontSize: 15,             // px at weight 1
    gravity: 900,             // px/s^2 at weight 1
    terminal: 340,            // px/s at weight 1 — slow enough to READ the
                              // word on the way down (~1.9s over the hero)
    appear: 220,              // ms fade-in, so a word does not pop into being
    sway: 30,                 // px/s^2 of sideways drift at weight 1
    tumble: 80,               // deg/s at weight 1
    fade: 950,                // ms from landing to gone
    hold: 6,                  // s a landing off screen waits to be seen
    opacity: 0.34,
    dust: true,
    maxDPR: 2
  };

  /* Weight per word. Tools are heavy — a full NLE or a 3D suite should land
     like a sandbag — and personal traits are light, so they flutter down.
     Anything not listed falls at 1. */
  var WEIGHTS = {
    "Premiere Pro": 3.0, "After Effects": 2.9, "DaVinci Resolve": 2.9,
    "Blender": 2.7, "Unity": 2.5, "Photoshop": 2.2, "Lightroom": 1.9,
    "Illustrator": 1.7, "Audition": 1.6, "Figma": 1.2, "OBS": 1.2,
    "Adobe": 2.0,
    "Street Documentary": 2.1, "Live Production": 2.0, "Video Editing": 1.9,
    "Colour Grading": 1.8, "Motion Design": 1.6, "Photography": 1.5,
    "Sound Design": 1.4, "Storytelling": 1.3, "Portrait": 1.2,
    "Composition": 1.1, "Lighting": 1.0,
    "Cantonese": 0.9, "Mandarin": 0.9, "English": 0.9,
    "HKDI": 1.1, "Sha Tin": 1.0,
    "Observant": 0.7, "Patient": 0.6, "Curious": 0.7, "Detail Driven": 0.8
  };
  var DEFAULT_WEIGHT = 1;

  var W_MIN = 0.5, W_MAX = 3.0;     // weight range used for visual scaling

  function nowMs() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function readToken(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      v = (v || "").trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function SkillFall(options) {
    var o = {};
    var k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) o[k] = DEFAULTS[k];
    if (options) for (k in options) if (Object.prototype.hasOwnProperty.call(options, k)) o[k] = options[k];
    this.o = o;

    this.source = document.querySelector(o.source);
    this.landing = document.querySelector(o.landing);
    if (!this.source || !this.landing) return;

    this.reduceMotion = global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (this.reduceMotion) return;

    this.words = this._vocabulary();
    if (!this.words.length) return;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "skill-fall";
    this.canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    this.fontFamily = readToken("--font-mono", "ui-monospace, Menlo, Consolas, monospace");
    this.tokens = [];
    this.dust = [];
    this.bag = [];
    this.raf = 0;
    this.spawnTimer = 0;
    this.lastFrame = 0;
    this.fieldVisible = true;
    this.aboutVisible = false;

    this.resize();
    this._bind();
    this._queueSpawn();
  }

  /* The vocabulary is the hero field's own data-text, split on the separator,
     so one edit to the canvas keeps the field and the falling words in sync. */
  SkillFall.prototype._vocabulary = function () {
    var raw = this.source.getAttribute("data-text") || "";
    var out = [];
    var parts = raw.split(this.o.separator);
    for (var i = 0; i < parts.length; i++) {
      var w = parts[i].replace(/\s+/g, " ").trim();
      if (w.length > 1) out.push(w);
    }
    return out;
  };

  /* A shuffled bag rather than a fresh random pick: every word gets a turn
     before any of them repeats, so the field never appears to favour the
     first few skills. */
  SkillFall.prototype._nextWord = function () {
    if (!this.bag.length) {
      this.bag = this.words.slice();
      for (var j = this.bag.length - 1; j > 0; j--) {
        var k = (Math.random() * (j + 1)) | 0;
        var t = this.bag[j]; this.bag[j] = this.bag[k]; this.bag[k] = t;
      }
    }
    return this.bag.pop();
  };

  SkillFall.prototype._weightOf = function (word) {
    var w = WEIGHTS[word];
    return typeof w === "number" ? w : DEFAULT_WEIGHT;
  };

  /* ---------- canvas ---------- */
  SkillFall.prototype.resize = function () {
    var dpr = Math.min(this.o.maxDPR, global.devicePixelRatio || 1);
    var w = global.innerWidth;
    var h = global.innerHeight;
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /* ---------- spawning ---------- */
  SkillFall.prototype._queueSpawn = function () {
    var self = this;
    if (this.spawnTimer) global.clearTimeout(this.spawnTimer);
    var wait = rand(this.o.everyMin, this.o.everyMax);
    this.spawnTimer = global.setTimeout(function () {
      self.spawnTimer = 0;
      if (!document.hidden && (self.fieldVisible || self.aboutVisible) &&
          self.tokens.length < self.o.maxTokens) {
        self.spawn();
      }
      self._queueSpawn();
    }, wait);
  };

  /* Spawn one token from a random point inside the hero field.
     x/y are optional DOCUMENT coordinates (used by the click pluck). */
  SkillFall.prototype.spawn = function (x, y) {
    var r = this.source.getBoundingClientRect();
    var sy = this._scrollY();
    var word = this._nextWord();
    var weight = this._weightOf(word);
    var wn = clamp01((weight - W_MIN) / (W_MAX - W_MIN));

    var px = typeof x === "number" ? x : rand(r.left + 20, Math.max(r.left + 24, r.right - 20));
    // Only the upper half of the field sheds words — spawning near the bottom
    // gave some tokens a 20px trip, so they appeared already landed. Once the
    // field has scrolled away the word joins the fall just above the window
    // instead, otherwise the drop would take four seconds to watch.
    var fieldTop = r.top + sy;
    var py = typeof y === "number" ? y
      : Math.max(rand(fieldTop + r.height * 0.06, fieldTop + r.height * 0.48),
                 sy - this.o.spawnLead);

    var size = this.o.fontSize * (0.86 + 0.16 * weight);
    this.tokens.push({
      word: word,
      weight: weight,
      wn: wn,
      size: size,
      x: px,
      y: py,
      vx: rand(-14, 14) / weight,
      vy: rand(0, 40),
      rot: rand(-8, 8),
      spin: rand(-1, 1) * this.o.tumble / weight,
      phase: rand(0, Math.PI * 2),
      alpha: 0,                 // faded in over `appear` ms, see _update
      base: this.o.opacity * (0.78 + 0.22 * wn),
      born: nowMs(),
      landed: false,
      landedAt: 0,
      squash: 0,
      held: 0,
      seed: Math.random() * 1000
    });

    // pluck the field where the word came from: a small ripple in the surface.
    // Skipped when the field is off screen — the ripple belongs to a surface
    // nobody is looking at.
    var ripple = this.source.__asciiRipple;
    var fieldOnScreen = r.bottom > 0 && r.top < this.cssH;
    if (ripple && ripple.drop && fieldOnScreen) {
      ripple.drop(px - r.left, py - sy - r.top, 0.35, 34);
    }
    this._wake();
    return true;
  };

  /* ---------- coordinates ---------- */
  SkillFall.prototype._scrollY = function () {
    return global.scrollY || global.pageYOffset || 0;
  };

  /* ---------- landing line ----------
     About's bottom edge, in document coordinates: a word crosses the whole
     section before it lands. */
  SkillFall.prototype._landY = function () {
    var r = this.landing.getBoundingClientRect();
    return r.bottom + this._scrollY() - this.o.landOffset;
  };

  /* ---------- physics + paint ---------- */
  SkillFall.prototype._update = function (dt) {
    var o = this.o;
    var landY = this._landY();
    var sy = this._scrollY();
    var viewTop = sy - 60;
    var viewBottom = sy + this.cssH + 40;
    var now = nowMs();
    var i;

    for (i = this.tokens.length - 1; i >= 0; i--) {
      var t = this.tokens[i];

      if (!t.landed) {
        t.alpha = t.base * clamp01((now - t.born) / o.appear);

        var accel = o.gravity * (0.55 + 0.45 * t.weight);
        var term = o.terminal * (0.7 + 0.3 * t.weight);
        t.vy = Math.min(term, t.vy + accel * dt);

        // light words wander, heavy ones hold their line
        t.phase += dt * 1.7;
        t.vx += Math.sin(t.phase + t.seed) * (o.sway / t.weight) * dt;
        t.vx *= 0.985;
        t.rot += t.spin * dt;

        t.x += t.vx * dt;
        t.y += t.vy * dt;

        if (t.y >= landY) {
          t.y = landY;
          t.landed = true;
          t.landedAt = now;
          // heavier = harder hit = more squash and more dust
          t.squash = 0.18 + 0.34 * t.wn;
          if (o.dust) this._puff(t);
          if (t.x < 8 || t.x > this.cssW - 8) t.x = clamp(t.x, 8, this.cssW - 8);
        }
      } else {
        // settle: eased upright, drifting to a halt, fading out
        var since = now - t.landedAt;
        t.rot += (0 - t.rot) * Math.min(1, dt * 6);
        t.x += t.vx * dt * 0.25;
        t.vx *= 0.94;
        t.squash += (0 - t.squash) * Math.min(1, dt * 7);

        // A word that came to rest below the fold holds its fade for up to
        // `hold` seconds, so scrolling down to About actually finds words
        // lying there. After that it fades like any other.
        if (t.held < o.hold) {
          if (t.y < viewTop || t.y > viewBottom) { t.landedAt += dt * 1000; t.held += dt; }
        }

        t.alpha = t.base * (1 - clamp01(since / o.fade));
        if (since >= o.fade) { this.tokens.splice(i, 1); continue; }
      }

      // still falling long after the landing line — something moved the page
      // under it; drop it rather than let it chase the section forever
      if (!t.landed && t.y > landY + 400) { this.tokens.splice(i, 1); continue; }
    }

    for (i = this.dust.length - 1; i >= 0; i--) {
      var d = this.dust[i];
      d.life -= dt;
      if (d.life <= 0) { this.dust.splice(i, 1); continue; }
      d.vy += 380 * dt;
      d.vx *= 0.97;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    }
  };

  /* Impact dust: a few flecks thrown sideways, count and reach scaled by the
     weight so a heavy tool visibly hits the deck. */
  SkillFall.prototype._puff = function (t) {
    var n = Math.round(3 + 5 * t.wn);
    for (var i = 0; i < n; i++) {
      var dir = Math.random() < 0.5 ? -1 : 1;
      this.dust.push({
        x: t.x + rand(-t.size * 1.4, t.size * 1.4),
        y: t.y + t.size * 0.4,
        vx: dir * rand(30, 130) * (0.6 + 0.6 * t.wn),
        vy: rand(-90, -20) * (0.5 + 0.5 * t.wn),
        size: rand(1.1, 2.4),
        life: rand(0.35, 0.85),
        max: 0.85,
        alpha: 0.34 * (0.6 + 0.4 * t.wn)
      });
    }
  };

  SkillFall.prototype._render = function () {
    var ctx = this.ctx;
    var sy = this._scrollY();
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    var i;
    for (i = 0; i < this.tokens.length; i++) {
      var t = this.tokens[i];
      ctx.save();
      ctx.translate(t.x, t.y - sy);
      ctx.rotate(t.rot * Math.PI / 180);
      // squash on impact: flatten vertically, widen a little
      ctx.scale(1 + t.squash * 0.5, 1 - t.squash);
      ctx.font = "500 " + t.size.toFixed(2) + "px " + this.fontFamily;
      ctx.fillStyle = "rgba(20,20,20," + clamp01(t.alpha).toFixed(3) + ")";
      ctx.fillText(t.word, 0, 0);
      ctx.restore();
    }

    for (i = 0; i < this.dust.length; i++) {
      var d = this.dust[i];
      var a = clamp01(d.life / d.max) * d.alpha;
      ctx.fillStyle = "rgba(20,20,20," + a.toFixed(3) + ")";
      ctx.fillRect(d.x, d.y - sy, d.size, d.size);
    }
  };

  /* ---------- loop ---------- */
  SkillFall.prototype._wake = function () {
    if (this.raf) return;
    var self = this;
    this.lastFrame = 0;
    this.raf = global.requestAnimationFrame(function () { self._tick(); });
  };

  SkillFall.prototype._tick = function () {
    this.raf = 0;
    if (document.hidden) { this.lastFrame = 0; return; }

    var now = nowMs();
    var dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;

    this._update(dt);
    this._render();

    if (this.tokens.length || this.dust.length) {
      var self = this;
      this.raf = global.requestAnimationFrame(function () { self._tick(); });
    } else {
      this.lastFrame = 0;
    }
  };

  /* ---------- wiring ---------- */
  SkillFall.prototype._bind = function () {
    var self = this;

    this._onResize = function () { self.resize(); };
    global.addEventListener("resize", this._onResize);

    // clicking the hero plucks a word out of the field right there
    this._onDown = function (e) {
      if (self.tokens.length >= self.o.maxTokens + 3) return;
      self.spawn(e.clientX, e.clientY + self._scrollY());
    };
    this.source.parentElement.addEventListener("pointerdown", this._onDown, { passive: true });

    // Words keep being shed while either end of the trip is on screen: the
    // field where they come from, or About where they land. Watching the
    // landing zone matters — reading About should not mean an empty sky.
    if ("IntersectionObserver" in global) {
      this._io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.target === self.landing) self.aboutVisible = entry.isIntersecting;
          else self.fieldVisible = entry.isIntersecting;
        });
      }, { threshold: 0 });
      this._io.observe(this.source);
      this._io.observe(this.landing);
    }

    this._onVisibility = function () {
      if (!document.hidden && (self.tokens.length || self.dust.length)) self._wake();
    };
    document.addEventListener("visibilitychange", this._onVisibility);
  };

  SkillFall.prototype.destroy = function () {
    if (this.raf) global.cancelAnimationFrame(this.raf);
    if (this.spawnTimer) global.clearTimeout(this.spawnTimer);
    if (this._io) this._io.disconnect();
    global.removeEventListener("resize", this._onResize);
    document.removeEventListener("visibilitychange", this._onVisibility);
    if (this.source && this.source.parentElement) {
      this.source.parentElement.removeEventListener("pointerdown", this._onDown);
    }
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.tokens.length = 0;
    this.dust.length = 0;
  };

  global.SkillFall = SkillFall;

  function boot() {
    try {
      global.__skillFall = new SkillFall();
    } catch (err) {
      if (global.console && console.error) console.error("[skill-fall] init failed", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : this);
