/* =========================================================
   Skill fall — physics edition
   ---------------------------------------------------------
   The hero background is a field of monospace glyphs spelling
   out the owner's tools, disciplines and traits (see data-text
   on #heroAscii). This layer plucks individual words out of
   that field and lets them fall down the page until they reach
   the About section, where they pile up, can be picked up with
   the mouse, and lie there for five seconds before fading out.

   The motion is a real rigid-body simulation (matter-js, see
   js/vendor/matter.min.js) rather than the hand-rolled gravity
   this file used to carry. That buys three things a scripted
   fall cannot fake:

     - words collide, so they stack on each other instead of
       overlapping into an unreadable smear
     - they can be grabbed and thrown, and a thrown word shoves
       whatever it lands on
     - nothing is ever quite repeated: angle, spin and bounce
       come out of the solver

   WEIGHT still matters — every word carries one, and it drives
   four things at once:
     - fall speed — heavy words accelerate harder (an extra
       gravity force) and have a HIGHER terminal velocity
       (lower air friction), so they arrive like a sandbag
     - wander     — light words get a sideways nudge on release
       and hold it; heavy ones drop almost straight
     - size / ink — heavier words render a touch larger
     - bounce     — light ones skitter on impact, heavy ones
       barely come back up

   Geometry. Words live in DOCUMENT coordinates and are only
   shifted by scrollY at paint time, which is what lets one
   leave the hero, cross the fold and keep going down into
   About. The floor follows the landing line, so a word always
   comes to rest relative to the section, whatever the layout
   has done in between.

   A word that lands off screen holds its countdown until it
   has been looked at, so scrolling down to About finds words
   lying there rather than an empty section.

   Cost. Nothing runs when there is nothing moving: the rAF
   chain stops once the last word is gone and is restarted by
   the next spawn timer.
   ========================================================= */

(function (global) {
  "use strict";

  var M = global.Matter;

  var DEFAULTS = {
    source: "#heroAscii",     // canvas whose data-text supplies the vocabulary
    landing: "#about",        // the section whose floor catches the words

    /* --- landing line ------------------------------------------------
       About is now a 240vh pinned scene, so its real bottom is a 2500px
       trip nobody would sit through. 0.35 of the way down is where the
       name card swings in — the part of the section actually being read. */
    landRatio: 0.35,
    landOffset: 30,           // px of clearance above the very bottom edge

    separator: "\u00b7",      // the data-text splits into words on this
    everyMin: 1400,           // ms between spawns
    everyMax: 3200,
    maxTokens: 6,

    fontSize: 15,             // px at weight 1

    /* --- physics ---------------------------------------------------- */
    engineGravity: 0.62,      // matter units; 1 is earth
    heavyBoost: 0.85,         // extra downward force at max weight: "heavy"
                              // should also mean it WANTS to go down, not
                              // merely that it falls faster once moving
    airLight: 0.0475,         // air friction at the lightest weight — high
                              // drag, so it flutters down slowly
    airHeavy: 0.0364,         // ...and at the heaviest. These three were set
                              // by MEASURING terminal velocity in the browser
                              // rather than solving for it: ~230 px/s light,
                              // ~280 mid, ~520 heavy, i.e. a ratio of ~2.3 —
                              // fast enough to read on the way down, heavy
                              // enough to feel like it hit something.
    restitutionLight: 0.42,   // bounce
    restitutionHeavy: 0.24,
    friction: 0.26,           // surface friction. High enough that a pile does
                              // not slide apart, low enough that a word which
                              // ends up on its end slips over and lies flat
                              // again — text reads badly standing up.
    frictionStatic: 0.5,
    spinLight: 0.09,          // rad/s of initial tumble
    spinHeavy: 0.012,
    slop: 0.5,                // px/step under which a body reads as at rest
    restTime: 320,            // ms at rest before it counts as landed
    restAge: 600,             // ms after spawn before rest may register —
                              // otherwise a word counts as landed the
                              // instant it lets go of the field

    /* --- life cycle ------------------------------------------------- */
    appear: 220,              // ms fade-in, so a word does not pop into being
    fade: 5000,               // ms a word lies on the floor after landing
    detachAt: 0.5,            // fraction of `fade` after which it leaves the
                              // simulation: ghosts still visible should not
                              // be solid obstacles for the next arrivals
    hold: 6,                  // s a landing off screen waits to be seen

    drag: true,
    dragStiffness: 0.9,
    dragDamping: 0.15,

    opacity: 0.34,
    dust: true,
    maxDPR: 2,
    maxSteps: 3               // physics steps per frame ceiling
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
  var STEP_MS = 1000 / 60;          // fixed physics step

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

    // Without the solver there is no effect at all — degrade to a quiet page
    // rather than throwing on every frame.
    if (!M || !M.Engine) return;

    this.source = document.querySelector(o.source);
    this.landing = document.querySelector(o.landing);
    if (!this.source || !this.landing) return;

    this.reduceMotion = global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (this.reduceMotion) return;

    this.words = this._vocabulary();
    if (!this.words.length) return;

    this.fontFamily = readToken("--font-mono", "ui-monospace, Menlo, Consolas, monospace");

    this.layer = document.createElement("div");
    this.layer.className = "skill-fall";
    this.layer.setAttribute("aria-hidden", "true");

    this.canvas = document.createElement("canvas");
    this.canvas.className = "skill-fall__fx";
    this.layer.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    this.words_ = document.createElement("div");
    this.words_.className = "skill-fall__words";
    this.layer.appendChild(this.words_);

    document.body.appendChild(this.layer);

    this.tokens = [];
    this.dust = [];
    this.bag = [];
    this.raf = 0;
    this.spawnTimer = 0;
    this.lastFrame = 0;
    this.acc = 0;
    this.fieldVisible = true;
    this.aboutVisible = false;
    this.drag = null;
    this.dragToken = null;
    this.floorY = null;

    this.resize();
    this._initWorld();
    this._bind();
    this._queueSpawn();
  }

  /* ---------- vocabulary ------------------------------------------------ */

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

  /* ---------- world ----------------------------------------------------- */

  SkillFall.prototype._initWorld = function () {
    var self = this;
    this.engine = M.Engine.create({ enableSleeping: false });
    this.engine.gravity.y = this.o.engineGravity;
    this.world = this.engine.world;

    // Heavy words get an extra pull, not just less drag: gravity in a solver
    // accelerates everything equally, so "heavy" has to be added by hand.
    M.Events.on(this.engine, "beforeUpdate", function () {
      var g = self.engine.gravity.y * self.engine.gravity.scale;
      for (var i = 0; i < self.tokens.length; i++) {
        var t = self.tokens[i];
        if (t.body && !t.detached) {
          t.body.force.y += t.body.mass * g * self.o.heavyBoost * t.wn;
        }
      }
    });

    this.bounds = [];
    this._buildBounds();
  };

  /* The four walls. Rebuilt on resize because their size depends on the
     viewport, and because a static box that no longer covers the page is
     a hole the words eventually find. */
  SkillFall.prototype._buildBounds = function () {
    var opts = { isStatic: true, friction: 0.8, restitution: 0.02, render: { visible: false } };
    var w = this.cssW;
    var h = Math.max(document.documentElement.scrollHeight || 0, this.cssH * 4);
    var wide = Math.max(w, 6000);
    var ground = this._landY();

    var next = [
      // floor: its top face IS the landing line, so no further offset needed
      M.Bodies.rectangle(w / 2, ground + 40, wide, 80, opts),
      M.Bodies.rectangle(-30, h / 2, 60, h * 2, opts),
      M.Bodies.rectangle(w + 30, h / 2, 60, h * 2, opts),
      // a lid, purely so a thrown word cannot leave the page upwards
      M.Bodies.rectangle(w / 2, -600, wide, 60, opts)
    ];

    if (this.bounds.length) M.Composite.remove(this.world, this.bounds);
    this.bounds = next;
    this.floor = next[0];
    this.floorY = ground;
    M.Composite.add(this.world, next);
  };

  /* ---------- canvas ---------- */
  SkillFall.prototype.resize = function () {
    var dpr = Math.min(this.o.maxDPR, global.devicePixelRatio || 1);
    var w = global.innerWidth;
    var h = global.innerHeight;
    var changed = w !== this.cssW || h !== this.cssH;
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (changed && this.bounds && this.bounds.length) this._buildBounds();
  };

  /* ---------- coordinates ---------- */
  SkillFall.prototype._scrollY = function () {
    return global.scrollY || global.pageYOffset || 0;
  };

  /* The landing line, in document coordinates: `landRatio` of the way down
     the landing section, never past its bottom edge. */
  SkillFall.prototype._landY = function () {
    var r = this.landing.getBoundingClientRect();
    var sy = this._scrollY();
    var top = r.top + sy;
    var bottom = r.bottom + sy;
    return Math.min(top + (bottom - top) * this.o.landRatio, bottom - this.o.landOffset);
  };

  /* Keep the floor under the section even if the layout reflows. Only moved
     when it actually moved — nudging a static body every frame would jog
     whatever is asleep on it. */
  SkillFall.prototype._syncFloor = function () {
    var ground = this._landY();
    if (this.floorY === null || Math.abs(ground - this.floorY) > 0.5) {
      this.floorY = ground;
      M.Body.setPosition(this.floor, { x: this.cssW / 2, y: ground + 40 });
    }
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

  /* Spawn one word from the hero field. x/y are optional DOCUMENT
     coordinates (used by the click pluck). */
  SkillFall.prototype.spawn = function (x, y) {
    var o = this.o;
    var r = this.source.getBoundingClientRect();
    var sy = this._scrollY();
    var word = this._nextWord();
    var weight = this._weightOf(word);
    var wn = clamp01((weight - W_MIN) / (W_MAX - W_MIN));

    var px = typeof x === "number" ? x : rand(r.left + 20, Math.max(r.left + 24, r.right - 20));
    // Only the upper half of the field sheds words — releasing near its
    // bottom gave some of them a 20px trip, so they appeared already landed.
    // Once the field has scrolled away the word joins the fall just above the
    // window instead, otherwise the drop takes four seconds to watch.
    var fieldTop = r.top + sy;
    var py = typeof y === "number" ? y
      : Math.max(rand(fieldTop + r.height * 0.06, fieldTop + r.height * 0.48),
                 sy - 60);

    var size = o.fontSize * (0.86 + 0.16 * weight);

    var el = document.createElement("span");
    el.className = "skill-fall__word";
    el.textContent = word;
    el.style.font = "500 " + size.toFixed(2) + "px " + this.fontFamily;
    el.style.color = "rgb(20,20,20)";
    el.style.opacity = "0";
    this.words_.appendChild(el);

    // Measured after it is in the document, so the box matches what is drawn.
    var bw = el.offsetWidth;
    var bh = el.offsetHeight;
    if (!bw || !bh) { this.words_.removeChild(el); return false; }

    var body = M.Bodies.rectangle(px, py, bw, bh, {
      restitution: o.restitutionLight + (o.restitutionHeavy - o.restitutionLight) * wn,
      friction: o.friction,
      frictionStatic: o.frictionStatic,
      frictionAir: o.airLight + (o.airHeavy - o.airLight) * wn,
      density: 0.0008 + 0.0012 * wn,     // heavier words shove, light ones yield
      render: { visible: false }
    });
    M.Body.setVelocity(body, {
      x: rand(-1.6, 1.6) * (1.4 - 0.9 * wn),   // light words drift sideways
      y: rand(0, 0.6)
    });
    M.Body.setAngularVelocity(body, rand(-1, 1) * (o.spinLight + (o.spinHeavy - o.spinLight) * wn));
    M.Composite.add(this.world, body);

    this.tokens.push({
      word: word,
      weight: weight,
      wn: wn,
      el: el,
      body: body,
      w: bw,
      h: bh,
      base: o.opacity * (0.78 + 0.22 * wn),
      alpha: 0,
      born: nowMs(),
      landed: false,
      landedAt: 0,
      held: 0,
      restMs: 0,
      detached: false,
      x: px,
      y: py,
      angle: 0
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

  SkillFall.prototype._removeToken = function (token) {
    var i = this.tokens.indexOf(token);
    if (i >= 0) this.tokens.splice(i, 1);
    if (token.el && token.el.parentNode) token.el.parentNode.removeChild(token.el);
    if (token.body && token.worldJoined !== false) {
      try { M.Composite.remove(this.world, token.body); } catch (e) { /* already gone */ }
    }
    if (this.dragToken === token) this._endDrag();
  };

  /* ---------- step + paint ---------- */
  SkillFall.prototype._stepPhysics = function (dtMs) {
    this.acc += dtMs;
    var steps = 0;
    while (this.acc >= STEP_MS && steps < this.o.maxSteps) {
      M.Engine.update(this.engine, STEP_MS);
      this.acc -= STEP_MS;
      steps++;
    }
    // A long stall should not be paid back as a burst of catch-up frames.
    if (steps >= this.o.maxSteps) this.acc = 0;
  };

  SkillFall.prototype._update = function (dt) {
    var o = this.o;
    var now = nowMs();
    var sy = this._scrollY();
    var viewTop = sy - 60;
    var viewBottom = sy + this.cssH + 40;
    var i;

    this._syncFloor();
    this._stepPhysics(dt * 1000);

    for (i = this.tokens.length - 1; i >= 0; i--) {
      var t = this.tokens[i];
      var b = t.body;

      if (!t.detached && b) {
        t.x = b.position.x;
        t.y = b.position.y;
        t.angle = b.angle;
      }

      if (!t.landed) {
        t.alpha = t.base * clamp01((now - t.born) / o.appear);

        // Landed = genuinely at rest, which covers both "hit the floor" and
        // "settled on top of another word". Being dragged does not count.
        if (now - t.born > o.restAge && !this.dragToken) {
          var v = b ? Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y) : 1;
          if (v < o.slop) {
            t.restMs += dt * 1000;
            if (t.restMs >= o.restTime) {
              t.landed = true;
              t.landedAt = now;
              if (o.dust) this._puff(t);
            }
          } else {
            t.restMs = 0;
          }
        } else {
          t.restMs = 0;
        }
      } else {
        var since = now - t.landedAt;

        // A word that came to rest below the fold holds its countdown for up
        // to `hold` seconds, so scrolling down to About actually finds words
        // lying there. After that it fades like any other.
        if (t.held < o.hold && (t.y < viewTop || t.y > viewBottom)) {
          t.landedAt += dt * 1000;
          t.held += dt;
        }

        // Halfway through its fade a word stops being solid — otherwise the
        // next arrivals would stack on invisible ghosts.
        if (!t.detached && since > o.fade * o.detachAt && this.dragToken !== t) {
          if (b) { M.Composite.remove(this.world, b); t.worldJoined = false; }
          t.detached = true;
          // Nor grabbable, nor blocking: a ghost should never swallow a click
          // meant for whatever is underneath it.
          t.el.classList.add("is-ghost");
        }

        t.alpha = t.base * (1 - clamp01(since / o.fade));
        if (since >= o.fade) { this._removeToken(t); continue; }
      }

      // something moved the page out from under it, or it escaped sideways
      if (t.x < -400 || t.x > this.cssW + 400 || t.y > this.floorY + 700) {
        this._removeToken(t); continue;
      }
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
    var half = t.w / 2;
    var n = Math.round(3 + 5 * t.wn);
    for (var i = 0; i < n; i++) {
      var dir = Math.random() < 0.5 ? -1 : 1;
      this.dust.push({
        x: t.x + rand(-half, half),
        y: t.y + t.h * 0.5,
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
    var sy = this._scrollY();
    var i;

    for (i = 0; i < this.tokens.length; i++) {
      var t = this.tokens[i];
      var x = t.x - t.w / 2;
      var y = t.y - sy - t.h / 2;
      t.el.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)" +
        " rotate(" + t.angle.toFixed(4) + "rad)";
      t.el.style.opacity = clamp01(t.alpha).toFixed(3);
    }

    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
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

  /* ---------- picking words up ---------- */
  SkillFall.prototype._pickAt = function (x, y) {
    var bodies = [];
    for (var i = 0; i < this.tokens.length; i++) {
      var t = this.tokens[i];
      if (t.body && !t.detached) bodies.push(t.body);
    }
    var hits = M.Query.point(bodies, { x: x, y: y });
    if (!hits.length) return null;
    for (var j = this.tokens.length - 1; j >= 0; j--) {
      if (this.tokens[j].body === hits[hits.length - 1]) return this.tokens[j];
    }
    return null;
  };

  SkillFall.prototype._startDrag = function (t, x, y) {
    var b = t.body;
    if (!b) return;
    // Grab it where it was clicked, not by the centre — the offset has to be
    // rotated into the body's own frame, or a spun word snaps to the cursor.
    var off = M.Vector.sub({ x: x, y: y }, b.position);
    var c = Math.cos(-b.angle), s = Math.sin(-b.angle);
    var local = { x: off.x * c - off.y * s, y: off.x * s + off.y * c };

    this.drag = M.Constraint.create({
      pointA: { x: x, y: y },
      bodyB: b,
      pointB: local,
      stiffness: this.o.dragStiffness,
      damping: this.o.dragDamping,
      length: 0,
      render: { visible: false }
    });
    this.dragToken = t;
    M.Composite.add(this.world, this.drag);
    t.el.classList.add("is-held");
    this._wake();
  };

  SkillFall.prototype._endDrag = function () {
    if (this.drag) {
      try { M.Composite.remove(this.world, this.drag); } catch (e) { /* gone */ }
      this.drag = null;
    }
    if (this.dragToken) {
      if (this.dragToken.el) this.dragToken.el.classList.remove("is-held");
      // A dropped word gets its landing countdown back from scratch: throwing
      // it across the floor should not count as having landed.
      this.dragToken.landed = false;
      this.dragToken.landedAt = 0;
      this.dragToken.restMs = 0;
      this.dragToken = null;
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

    // Dragging is tracked on the window, not on the word: once the cursor
    // leaves the word it is over something else, and a listener on the word
    // would lose it mid-throw.
    if (this.o.drag) {
      this._onGrab = function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        if (self.drag) return;
        // Only a press that lands on a word is ours; everything else on the
        // page has to keep working exactly as before.
        var cls = e.target && e.target.classList;
        if (!cls || !cls.contains("skill-fall__word")) return;
        var t = self._pickAt(e.clientX, e.clientY + self._scrollY());
        if (!t) return;
        e.preventDefault();
        self._startDrag(t, e.clientX, e.clientY + self._scrollY());
      };
      this._onDragMove = function (e) {
        if (!self.drag) return;
        self.drag.pointA.x = e.clientX;
        self.drag.pointA.y = e.clientY + self._scrollY();
        self._wake();
      };
      this._onRelease = function () { if (self.drag) self._endDrag(); };
      global.addEventListener("pointerdown", this._onGrab, true);
      global.addEventListener("pointermove", this._onDragMove, { passive: true });
      global.addEventListener("pointerup", this._onRelease, true);
      global.addEventListener("pointercancel", this._onRelease, true);
      global.addEventListener("blur", this._onRelease);
    }

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
    if (this.o.drag) {
      global.removeEventListener("pointerdown", this._onGrab, true);
      global.removeEventListener("pointermove", this._onDragMove);
      global.removeEventListener("pointerup", this._onRelease, true);
      global.removeEventListener("pointercancel", this._onRelease, true);
      global.removeEventListener("blur", this._onRelease);
    }
    if (this.source && this.source.parentElement) {
      this.source.parentElement.removeEventListener("pointerdown", this._onDown);
    }
    for (var i = this.tokens.length - 1; i >= 0; i--) this._removeToken(this.tokens[i]);
    this.dust.length = 0;
    if (this.engine) { M.Events.off(this.engine); M.Composite.clear(this.world, false); M.Engine.clear(this.engine); }
    if (this.layer && this.layer.parentNode) this.layer.parentNode.removeChild(this.layer);
    this.bounds = [];
    this.drag = null;
    this.dragToken = null;
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
