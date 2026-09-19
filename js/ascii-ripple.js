/* =========================================================
   ASCII Ripple — vanilla Canvas port
   ---------------------------------------------------------
   A field of monospace glyphs that behaves like a liquid
   surface: pointer drops and drags send simulated waves
   through the grid, bending the words and blooming into
   heavier glyphs.

   Zero dependencies, no build step. Drop the script in and
   mark up a canvas:

     <canvas data-ascii-ripple data-text="..." aria-hidden="true"></canvas>

   Every option below is also a data-* attribute on that
   canvas (kebab-case): data-font-size, data-text-opacity,
   data-drop-strength ... Colour and font tokens default to
   the site's CSS custom properties, so it inherits the
   design system instead of hard-coding a palette.

   Physics: a discrete 2D wave equation (FDTD) on a grid
   finer than the text grid ("resolution" cells per text
   row), rendered by mapping surface height + slope onto a
   glyph palette from lightest to heaviest.
   ========================================================= */

(function (global) {
  "use strict";

  /* ---------- defaults (prop names mirror the component API) ---------- */
  var DEFAULTS = {
    text: "Chan Chun Shing — Digital Media and Photography.",
    chars: "\u00b7.,:;-~=+*%#@",   // lightest -> heaviest (wave density ramp)
    // Garble palette, ordered mild -> wild. The pointer scramble walks up and
    // down this ramp, so a letter turns into . ~ : then * ^ < then @ # ¥ and
    // back — a transition, not a swap. Half-width ¥ (U+00A5) on purpose: the
    // full-width ￥ is double-advance and would break the monospace grid.
    garbleChars: "\u00b7._-~:;=+*^<>/\\|()[]{}!?$%&@#\u00a5",
    noise: 0.18,                   // fraction of the field that idles as garble
    noiseSpeed: 900,               // ms for one full re-roll pass over that noise
    scrambleRadius: 110,           // px — how far the pointer stirs letters
    scrambleRise: 130,             // ms to garble a letter the pointer touches
    scrambleFall: 520,             // ms to resolve it back to its own character
    scrambleIdle: 90,              // ms without pointer movement before the
                                   // scramble stops feeding: heat is driven by
                                   // MOVEMENT, not presence, so parking the
                                   // pointer lets the letters resolve instead
                                   // of leaving a garbled blob sitting there
    garbleAlpha: 0.85,             // opacity at full garble (resting is textOpacity)
    fontSize: 14,
    lineHeight: 1.2,
    fontFamily: "",                // resolved from --font-mono
    fontWeight: 400,
    textColor: "",                 // resolved from --ink
    rippleColor: "",               // resolved from --ink
    troughColor: "",               // resolved from --line
    backgroundColor: "transparent",
    textOpacity: 0.08,
    resolution: 3,                 // sim cells per text row (1-4)
    speed: 0.9,                    // wave propagation, 0-1
    damping: 0.085,                // 0..0.5, velocity lost per step
    viscosity: 0.12,               // 0-1, smooths sharp wavelets
    restore: 0.005,                // weak pull back to flat, 0 disables.
                                   // NOT in the reference API: pure damping
                                   // leaves a slow smooth bulge that takes
                                   // 3-4s to drain. This kills that
                                   // low-frequency tail without touching the
                                   // travelling ripples. Measured: 3.3s -> 0.8s
    edges: "absorb",               // "absorb" | "reflect"
    dropStrength: 1.2,             // click/tap impulse
    dropRadius: 26,                // px
    dragStrength: 0.3,             // moving-pointer impulse (0 = off)
    dragRadius: 16,                // px
    rain: 0,                       // random drops per second while idle
    rainStrength: 0.6,
    sensitivity: 2.2,              // height -> glyph intensity
    slopeGain: 1,                  // slope -> glyph intensity
    refraction: 4,                 // text displacement by slope, in cells
    scramble: 1,                   // 0-1 glyph reshuffle inside a ripple
    scrambleSpeed: 90,             // ms between reshuffles
    dither: 0.5,                   // 0 hard .. 1 grainy
    vignette: 0.6,                 // edge fade, fraction of shorter half-side
    interactive: true,
    idleDelay: 2200,               // ms without pointer input before rain
    maxDPR: 2
  };

  /* Tuned so a full-strength drop spans the palette without clipping.
     Values measured in a real browser against a 1243x719 hero:
     a click (dropStrength 1.2) peaks at u~0.34 and max intensity ~0.91. */
  var SIGNAL_GAIN = 3.4;           // surface height -> 0..1 intensity
  var SLOPE_GAIN_SCALE = 5.0;      // slope contribution scale
  var BEND_SCALE = 3.0;            // slope -> glyph displacement multiplier
  var DROP_IMPULSE = 0.24;         // internal scale; dropStrength 1.2 lands
                                   // here, tuned so a click drives the palette
                                   // to its heaviest glyphs and the ring still
                                   // reaches ~200px before fading
  var DRAG_IMPULSE = 0.30;         // per pointer move — 60 of these land per
                                   // second, so it stays below a click per
                                   // event and accumulates along the path
  var STEP_MS = 1000 / 60;         // fixed simulation timestep
  var MAX_STEPS = 5;               // catch-up ceiling after a stall
  var DRAW_THRESHOLD = 0.06;       // resting cells below this are left to the base layer
  var DRAW_BUDGET = 1400;          // max clearRect+stamp pairs per frame

  function nowMs() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  /* Deterministic per-cell pseudo-random in [0,1). Used so every cell keeps
     its own stable "personality" while the grid churns. */
  function hash2(a, b) {
    var x = (a * 374761393 + b * 668265263) | 0;
    x = (x ^ (x >>> 13));
    x = (x * 1274126177) | 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  /* ---------- small helpers ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function readToken(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      v = (v || "").trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function kebabToCamel(s) {
    return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
  }

  /* Resolve "rgb(...)"/"rgba(...)"/"#hex" into [r,g,b]; null if unparsable. */
  function parseColor(str) {
    if (!str) return null;
    str = String(str).trim();
    if (str.charAt(0) === "#") {
      var hex = str.slice(1);
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      if (hex.length >= 6) {
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16)
        ];
      }
      return null;
    }
    var m = str.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var parts = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (parts.length >= 3) {
        return [
          parseFloat(parts[0]),
          parseFloat(parts[1]),
          parseFloat(parts[2])
        ];
      }
    }
    return null;
  }

  /* Mix two [r,g,b] and return an rgba() string. */
  function mix(a, b, t, alpha) {
    var r = Math.round(lerp(a[0], b[0], t));
    var g = Math.round(lerp(a[1], b[1], t));
    var bl = Math.round(lerp(a[2], b[2], t));
    return "rgba(" + r + "," + g + "," + bl + "," + alpha + ")";
  }

  /* =========================================================
     AsciiRipple
     ========================================================= */
  function AsciiRipple(canvas, options) {
    if (!canvas) throw new Error("AsciiRipple: canvas element required");

    this.canvas = canvas;
    this.opts = {};
    var k;
    for (k in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) this.opts[k] = DEFAULTS[k];
    }
    // element data-* attributes win, then explicit options object
    for (k in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
      var attr = canvas.getAttribute("data-" + k.replace(/([A-Z])/g, "-$1").toLowerCase());
      if (attr !== null && attr !== "") this.opts[k] = coerce(attr, DEFAULTS[k]);
    }
    if (options) {
      for (k in options) {
        if (Object.prototype.hasOwnProperty.call(options, k)) this.opts[k] = options[k];
      }
    }

    var o = this.opts;

    /* Phone. A 390px window at the desktop settings packs the same glyph grid
       into a ninth of the area — the field turns into a dense grey cloth that
       fights the headline, and the sim is doing ~25k cells a frame for it.
       Bigger glyphs, coarser sim: fewer cells, more air, cheaper. A size
       handed in through the options object still wins; the data-* attributes
       on the canvas are the desktop values and are meant to be overridden. */
    if (global.matchMedia && global.matchMedia("(pointer: coarse)").matches &&
        global.innerWidth < 760) {
      if (!options || options.fontSize === undefined) o.fontSize = Math.max(o.fontSize, 22);
      if (!options || options.resolution === undefined) o.resolution = Math.min(o.resolution, 3);
      if (!options || options.maxDPR === undefined) o.maxDPR = Math.min(o.maxDPR, 2);
      /* and quieter: on a phone the field sits behind the whole screen rather
         than around a centred column, so at full strength it reads as a wall
         of words competing with the headline instead of a texture behind it */
      if (!options || options.textOpacity === undefined) o.textOpacity = Math.min(o.textOpacity, 0.055);
    }

    this.chars = String(o.chars || DEFAULTS.chars);
    this.garbleChars = String(o.garbleChars || DEFAULTS.garbleChars);
    this.text = String(o.text || "");
    this.edges = o.edges === "reflect" ? "reflect" : "absorb";

    // design tokens: resolve the site's variables when nothing explicit was given
    this.fontFamily = o.fontFamily || readToken("--font-mono", "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
    this.colText = parseColor(o.textColor || readToken("--ink", "#141414")) || [20, 20, 20];
    this.colCrest = parseColor(o.rippleColor || readToken("--ink", "#141414")) || this.colText.slice();
    this.colTrough = parseColor(o.troughColor || readToken("--line", "#e4e2da")) || [228, 226, 218];

    this.reduceMotion = global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.ctx = canvas.getContext("2d");
    this.base = document.createElement("canvas");      // resting text, drawn once
    this.baseCtx = this.base.getContext("2d");

    this.drops = [];            // pending impulses, applied on next step
    this.raf = 0;
    this.running = false;
    this.visible = true;
    this.lastPointer = -Infinity;
    this._lastDrag = { x: -999, y: -999 };
    this.lastFrame = 0;
    this._timer = 0;
    this._gen = 0;
    this._accum = 0;
    this._drawThreshold = DRAW_THRESHOLD;
    this.nextRain = 0;
    this.scrambleBucket = -1;
    this.time = 0;

    // pointer scramble state
    this.pointer = { x: -1e5, y: -1e5, inside: false, movedAt: -1e5 };
    this.heat = null;              // per text cell, 0 = its own letter, 1 = fully garbled
    this._heatActive = 0;
    this._noisy = [];              // cell indices that idle as garble
    this._noisyChars = [];
    this._noiseCursor = 0;
    this._garbleBucket = 0;

    this._bind();
    this.resize();
    this._wake();   // start the surface without waiting for the first input
  }

  function coerce(raw, sample) {
    if (typeof sample === "number") {
      var n = parseFloat(raw);
      return isNaN(n) ? sample : n;
    }
    if (typeof sample === "boolean") return raw === "true" || raw === "1";
    return raw;
  }

  /* ---------- geometry / allocation ---------- */
  AsciiRipple.prototype.resize = function () {
    var o = this.opts;
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    if (w <= 1 || h <= 1) return;

    var dpr = Math.min(o.maxDPR, global.devicePixelRatio || 1);

    // responsive type: shrink the grid on small screens so it stays legible
    // (parseFloat + fallback: a bad or missing fontSize used to produce a NaN
    // cell height, which threw inside new Array() and was swallowed by the
    // init try/catch — the component silently never started)
    var fs = parseFloat(o.fontSize) || DEFAULTS.fontSize;
    if (w < 640) fs = Math.max(9, fs - 3);
    else if (w < 1024) fs = Math.max(10, fs - 1.5);
    this.fontSize = fs;
    this.charH = fs * (parseFloat(o.lineHeight) || DEFAULTS.lineHeight);

    // measure the monospace advance width
    this.ctx.font = o.fontWeight + " " + fs + "px " + this.fontFamily;
    var adv = this.ctx.measureText("M").width;
    this.charW = adv > 0 ? adv : fs * 0.6;

    this.cssW = w;
    this.cssH = h;

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.base.width = Math.round(w * dpr);
    this.base.height = Math.round(h * dpr);
    this.baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // text grid
    this.cols = Math.max(1, Math.ceil(w / this.charW));
    this.rows = Math.max(1, Math.ceil(h / this.charH));

    // Simulation grid: SQUARE cells, sized from the text row height.
    // Deriving cellW and cellH from charW and charH separately (the obvious
    // reading of "resolution cells per text row") makes every cell 1:2,
    // because a monospace advance is about half the line height — so waves
    // travel twice as fast vertically in pixels and every ripple comes out as
    // an ellipse. Square cells also halve the cell count for the same visual
    // density.
    var res = clamp(Math.round(o.resolution) || 3, 1, 4);
    this.res = res;
    this.cellSize = this.charH / res;
    this.cellW = this.cellSize;
    this.cellH = this.cellSize;
    this.resY = res;                        // sim cells per text row
    this.resX = this.charW / this.cellSize; // sim cells per text column
    this.simW = Math.max(4, Math.ceil(w / this.cellSize));
    this.simH = Math.max(4, Math.ceil(h / this.cellSize));

    var n = this.simW * this.simH;
    if (this.u && this.u.length === n) {
      this.u.fill(0); this.v.fill(0); this.tmp.fill(0);
    } else {
      this.u = new Float32Array(n);
      this.v = new Float32Array(n);
      this.tmp = new Float32Array(n);
    }

    var cells = this.cols * this.rows;
    if (!this.heat || this.heat.length !== cells) this.heat = new Float32Array(cells);
    else this.heat.fill(0);
    this._heatActive = 0;

    this._c2 = clamp(o.speed, 0, 1) * 0.49;         // stability ceiling for 2D FDTD
    this._damp = 1 - clamp(o.damping, 0, 0.5);
    this._visc = clamp(o.viscosity, 0, 1) * 0.25;
    this._restore = clamp(o.restore, 0, 0.05);

    this._layoutText();
    this._seedNoise();
    this._drawBase();
    // reduced motion: no loop will run, so compose the single static frame now
    if (this.reduceMotion) this._render();
  };

  /* Wrap the passage into rows of `cols` glyphs, repeating until full. */
  AsciiRipple.prototype._layoutText = function () {
    var cols = this.cols;
    var words = String(this.text || "").replace(/\s+/g, " ").trim().split(" ");
    if (!words.length || words[0] === "") words = ["\u00b7"];

    // one pass of the passage, wrapped by word
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
      var cand = line ? line + " " + words[i] : words[i];
      if (cand.length > cols && line) {
        lines.push(line);
        line = words[i];
        // a single word longer than the row: hard-break it
        while (line.length > cols) {
          lines.push(line.slice(0, cols));
          line = line.slice(cols);
        }
      } else {
        line = cand;
      }
    }
    if (line) lines.push(line);

    // Repeat the wrapped passage down the grid, but rotate each row by its own
    // offset. Repeating it verbatim made every row start with the same words,
    // which read as one obvious repeated sentence instead of a data field.
    var rows = new Array(this.rows);
    var flat = new Array(this.rows * cols);
    var lightest = this.chars.charAt(0);
    for (var r = 0; r < this.rows; r++) {
      var src = lines[r % lines.length];
      var phase = src.length > 1 ? Math.floor(hash2(r, 7919) * src.length) : 0;
      var rotated = phase ? src.slice(phase) + " " + src.slice(0, phase) : src;
      rows[r] = rotated;
      var base = r * cols;
      for (var c = 0; c < cols; c++) {
        flat[base + c] = c < rotated.length ? rotated.charAt(c) : lightest;
      }
    }
    this.lines = rows;
    this.baseChars = flat;      // the character each cell owns, for the resolve
  };

  /* ---------- noisy field: cells that idle as garble instead of text ------ */

  AsciiRipple.prototype._seedNoise = function () {
    var total = this.cols * this.rows;
    var count = Math.round(clamp01(this.opts.noise) * total);
    // Even scatter: shuffle the whole index list and take the first `count`.
    // Picking independently at random clumps, which reads as blotches rather
    // than an evenly noisy field.
    var pool = new Array(total);
    for (var i = 0; i < total; i++) pool[i] = i;
    for (var j = total - 1; j > 0; j--) {
      var k = (Math.random() * (j + 1)) | 0;
      var t = pool[j]; pool[j] = pool[k]; pool[k] = t;
    }
    this._noisy = pool.slice(0, Math.max(0, count));
    this._noisyChars = new Array(this._noisy.length);
    this._noiseCursor = 0;
    for (var n = 0; n < this._noisy.length; n++) {
      var cell = this._noisy[n];
      // a stable per-cell strength so the field mixes mild and wild glyphs
      var s = 0.15 + 0.85 * hash2(cell, 12345);
      this._noisyChars[n] = this._pickGarble(cell, s, 0);
    }
  };

  /* Garble glyph for a cell at a given intensity. The palette is ordered
     mild -> wild and the intensity decides WHERE ON THE RAMP the glyph sits,
     so driving the intensity up and back down reads as a transformation
     rather than a character swap. The hash only jitters the tier by ±1.5 so
     neighbouring cells at the same intensity do not all show one character.
     (Deriving the tier as hash * span looked equivalent but pinned any cell
     whose hash was near 0 to the mildest glyph forever — measured: a cell at
     full intensity still rendering "·".) */
  AsciiRipple.prototype._pickGarble = function (cell, strength, bucket) {
    var pal = this.garbleChars;
    var n = pal.length;
    if (!n) return "\u00b7";
    var tier = clamp01(strength) * (n - 1);
    var jitter = (hash2(cell * 31 + bucket * 7919, 40503) - 0.5) * 3;
    return pal.charAt(clamp(Math.round(tier + jitter), 0, n - 1));
  };

  /* Repaint a single cell of the resting layer (used by the noise churn). */
  AsciiRipple.prototype._paintBaseCell = function (idx, ch) {
    var c = this.baseCtx;
    var tx = idx % this.cols;
    var ty = (idx / this.cols) | 0;
    var x = tx * this.charW;
    var y = ty * this.charH;
    c.clearRect(x, y - 1, this.charW + 2, this.charH + 2);
    c.fillStyle = mix(this.colText, this.colText, 0, clamp01(this.opts.textOpacity));
    c.fillText(ch, x, y + this.charH * 0.5);
  };

  /* Re-roll a slice of the noisy cells each frame instead of all of them at
     once: a full pass is thousands of clearRect+fillText, which would show up
     as a periodic hitch. Spreading it keeps the churn free and continuous. */
  AsciiRipple.prototype._churnNoise = function (dtMs) {
    var list = this._noisy;
    var n = list.length;
    if (!n) return;
    var pass = Math.max(120, this.opts.noiseSpeed);
    var per = Math.max(1, Math.round((n * dtMs) / pass));
    for (var i = 0; i < per; i++) {
      var k = this._noiseCursor++ % n;
      var cell = list[k];
      var s = 0.15 + 0.85 * hash2(cell, this._garbleBucket);
      var ch = this._pickGarble(cell, s, this._garbleBucket);
      if (ch === this._noisyChars[k]) continue;
      this._noisyChars[k] = ch;
      this._paintBaseCell(cell, ch);
    }
  };

  /* ---------- pointer heat: the in-place letter scramble ---------------- */

  AsciiRipple.prototype._updateHeat = function (dtMs) {
    var heat = this.heat;
    if (!heat) return;
    var o = this.opts;
    var inside = this.pointer.inside && o.interactive;
    // Only an actually-moving pointer feeds heat. Without this the letters
    // under a parked cursor stayed garbled forever, so the effect never
    // stopped while the mouse was still — the opposite of "pointer idle ->
    // nothing moves".
    var live = inside && (nowMs() - this.pointer.movedAt) < Math.max(16, o.scrambleIdle);
    if (!live && this._heatActive === 0) return;      // nothing to warm or cool

    var cols = this.cols, rows = this.rows;
    var radius = Math.max(1, o.scrambleRadius);
    var rad2 = radius * radius;
    var rise = Math.max(16, o.scrambleRise);
    var fall = Math.max(16, o.scrambleFall);
    var px = this.pointer.x, py = this.pointer.y;
    var act = 0;

    for (var ty = 0; ty < rows; ty++) {
      var cy = ty * this.charH + this.charH * 0.5;
      var dy = live ? cy - py : 0;
      var row = ty * cols;
      for (var tx = 0; tx < cols; tx++) {
        var k = row + tx;
        var h = heat[k];
        var add = 0;
        if (live) {
          var cx = tx * this.charW + this.charW * 0.5;
          var dx = cx - px;
          var d2 = dx * dx + dy * dy;
          // squared falloff: letters directly under the pointer garble first
          if (d2 < rad2) add = (1 - d2 / rad2) * (dtMs / rise);
        }
        h = add > 0 ? Math.min(1, h + add) : Math.max(0, h - dtMs / fall);
        heat[k] = h;
        if (h > 0.02) act++;
      }
    }
    this._heatActive = act;
  };

  /* Resting text layer: 15%-ish ink on transparency, drawn once. */
  AsciiRipple.prototype._drawBase = function () {
    var o = this.opts;
    var c = this.baseCtx;
    c.clearRect(0, 0, this.cssW, this.cssH);
    c.font = o.fontWeight + " " + this.fontSize + "px " + this.fontFamily;
    c.textBaseline = "middle";
    c.fillStyle = mix(this.colText, this.colText, 0, clamp01(o.textOpacity));

    var lightest = this.chars.charAt(0);
    for (var y = 0; y < this.rows; y++) {
      var line = this.lines[y];
      if (!line) continue;
      // pad the row with the lightest glyph so the grid reads as a field
      var rowText = line;
      if (rowText.length < this.cols) {
        rowText += new Array(this.cols - rowText.length + 1).join(lightest);
      }
      c.fillText(rowText, 0, y * this.charH + this.charH / 2);
    }

    // Then stamp the noisy cells on top. The whole-row fills above are far
    // cheaper than one fillText per cell, so only the garble goes per-cell.
    for (var n = 0; n < this._noisy.length; n++) {
      this._paintBaseCell(this._noisy[n], this._noisyChars[n]);
    }
  };

  /* ---------- impulses ---------- */
  AsciiRipple.prototype.drop = function (x, y, strength, radius) {
    var s = strength == null ? this.opts.dropStrength : strength;
    var r = radius == null ? this.opts.dropRadius : radius;
    this.drops.push({ x: x, y: y, s: s, r: r, drag: false });
    this._wake();
  };

  AsciiRipple.prototype.calm = function () {
    if (this.u) { this.u.fill(0); this.v.fill(0); }
    this.drops.length = 0;
  };

  AsciiRipple.prototype._applyDrops = function () {
    if (!this.drops.length) return;
    var w = this.simW, h = this.simH;
    var cw = this.cellW, ch = this.cellH;
    for (var d = 0; d < this.drops.length; d++) {
      var drop = this.drops[d];
      var cx = drop.x / cw;
      var cy = drop.y / ch;
      var rad = Math.max(1, drop.r / Math.min(cw, ch));
      var rad2 = rad * rad;
      var amp = drop.s * (drop.drag ? DRAG_IMPULSE : DROP_IMPULSE);
      var x0 = Math.max(1, Math.floor(cx - rad));
      var x1 = Math.min(w - 2, Math.ceil(cx + rad));
      var y0 = Math.max(1, Math.floor(cy - rad));
      var y1 = Math.min(h - 2, Math.ceil(cy + rad));
      for (var y = y0; y <= y1; y++) {
        var dy = y - cy;
        for (var x = x0; x <= x1; x++) {
          var dx = x - cx;
          var dist2 = dx * dx + dy * dy;
          if (dist2 > rad2) continue;
          var t = 1 - Math.sqrt(dist2 / rad2);
          // smooth falloff (raised cosine) so the impulse has no hard rim
          var fall = 0.5 - 0.5 * Math.cos(Math.PI * t);
          this.v[y * w + x] += amp * fall;
        }
      }
    }
    this.drops.length = 0;
  };

  /* ---------- simulation step ---------- */
  AsciiRipple.prototype._step = function () {
    var u = this.u, v = this.v, w = this.simW, h = this.simH;
    var c2 = this._c2, damp = this._damp, restore = this._restore;
    var reflect = this.edges === "reflect";

    if (reflect) {
      // mirror the border so the laplacian reflects waves back inward
      for (var x = 0; x < w; x++) {
        u[x] = u[w + x];
        u[(h - 1) * w + x] = u[(h - 2) * w + x];
      }
      for (var y = 0; y < h; y++) {
        u[y * w] = u[y * w + 1];
        u[y * w + w - 1] = u[y * w + w - 2];
      }
    }

    for (var yy = 1; yy < h - 1; yy++) {
      var row = yy * w;
      for (var xx = 1; xx < w - 1; xx++) {
        var i = row + xx;
        var lap = u[i - 1] + u[i + 1] + u[i - w] + u[i + w] - 4 * u[i];
        // -restore*u is the weak spring: damping alone cannot drain a wide
        // smooth bulge, so the surface used to take 3-4s to look "normal"
        // again after the pointer left. This does not affect travelling
        // ripples, whose frequency is far above the cutoff it introduces.
        v[i] = (v[i] + c2 * lap - restore * u[i]) * damp;
      }
    }

    var n = w * h;
    for (var k = 0; k < n; k++) u[k] += v[k];

    // viscosity: blend each cell toward its neighbourhood average
    var visc = this._visc;
    if (visc > 0) {
      var tmp = this.tmp;
      for (var y2 = 1; y2 < h - 1; y2++) {
        var r2 = y2 * w;
        for (var x2 = 1; x2 < w - 1; x2++) {
          var j = r2 + x2;
          var avg = (u[j - 1] + u[j + 1] + u[j - w] + u[j + w]) * 0.25;
          tmp[j] = u[j] + (avg - u[j]) * visc;
        }
      }
      for (var y3 = 1; y3 < h - 1; y3++) {
        var r3 = y3 * w;
        for (var x3 = 1; x3 < w - 1; x3++) {
          var i3 = r3 + x3;
          u[i3] = tmp[i3];
        }
      }
    }

    if (reflect) {
      for (var x4 = 0; x4 < w; x4++) {
        u[x4] = u[w + x4];
        u[(h - 1) * w + x4] = u[(h - 2) * w + x4];
      }
      for (var y4 = 0; y4 < h; y4++) {
        u[y4 * w] = u[y4 * w + 1];
        u[y4 * w + w - 1] = u[y4 * w + w - 2];
      }
    } else {
      // absorb: the outer ring stays flat
      for (var x5 = 0; x5 < w; x5++) { u[x5] = 0; u[(h - 1) * w + x5] = 0; }
      for (var y5 = 0; y5 < h; y5++) { u[y5 * w] = 0; u[y5 * w + w - 1] = 0; }
    }
  };

  AsciiRipple.prototype._energy = function () {
    var u = this.u, s = 0;
    for (var i = 0; i < u.length; i++) { var a = u[i] < 0 ? -u[i] : u[i]; if (a > s) s = a; }
    return s;
  };

  /* ---------- render ---------- */
  AsciiRipple.prototype._render = function () {
    var o = this.opts;
    var ctx = this.ctx;
    var w = this.simW, resX = this.resX, resY = this.resY;

    ctx.clearRect(0, 0, this.cssW, this.cssH);
    if (o.backgroundColor && o.backgroundColor !== "transparent") {
      ctx.fillStyle = o.backgroundColor;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    // resting text: one cheap blit. Disturbed cells clear their own rect and
    // restamp. A two-layer variant (offscreen active layer + 2 full blits) was
    // measured slower: 6.18ms vs 4.96ms for the identical 2708 active cells.
    ctx.drawImage(this.base, 0, 0, this.cssW, this.cssH);

    ctx.font = o.fontWeight + " " + this.fontSize + "px " + this.fontFamily;
    ctx.textBaseline = "middle";

    var pal = this.chars;
    var palMax = pal.length - 1;
    var sensitivity = o.sensitivity;
    var slopeGain = o.slopeGain;
    var refraction = o.refraction;
    var scramble = clamp01(o.scramble);
    var dither = clamp01(o.dither);
    var vignette = clamp01(o.vignette);
    var scrambleNow = this.time / Math.max(16, o.scrambleSpeed);
    var bucket = Math.floor(scrambleNow);
    this._garbleBucket = bucket;      // the noise churn re-rolls on the same beat

    // Vignette is normalised PER AXIS: using the shorter half-side for both
    // axes (the obvious way) squeezes the horizontal fade into a band the
    // height of the canvas, which on a 1585x900 hero left the outer 342px on
    // each side with a completely dead wave. Measured, then fixed.
    var halfW = this.cssW * 0.5, halfH = this.cssH * 0.5;
    var fadeStart = 1 - vignette;
    var cxCss = halfW, cyCss = halfH;

    this.activeCells = 0;

    for (var ty = 0; ty < this.rows; ty++) {
      var sy = Math.min(this.simH - 2, Math.max(1, Math.round(ty * resY + resY * 0.5)));
      var yCss = ty * this.charH;
      for (var tx = 0; tx < this.cols; tx++) {
        var sx = Math.min(this.simW - 2, Math.max(1, Math.round(tx * resX + resX * 0.5)));
        var idx = sy * w + sx;
        var cidx = ty * this.cols + tx;
        var heat = this.heat ? this.heat[cidx] : 0;

        var hgt = this.u[idx];
        var sxL = this.u[idx - 1], sxR = this.u[idx + 1];
        var syU = this.u[idx - w], syD = this.u[idx + w];
        var dX = (sxR - sxL) * 0.5;
        var dY = (syD - syU) * 0.5;

        var signal = hgt * sensitivity * SIGNAL_GAIN +
                     (Math.abs(dX) + Math.abs(dY)) * slopeGain * SLOPE_GAIN_SCALE;

        if (dither > 0) {
          signal += (Math.random() - 0.5) * dither * 0.35 * Math.min(1, Math.abs(signal) * 4);
        }

        var abs = signal < 0 ? -signal : signal;
        var hot = heat > 0.02;                     // pointer scramble in progress
        if (abs < this._drawThreshold && !hot) continue;   // -> resting layer

        var inten = clamp01(abs);
        var ch, alpha;

        if (hot) {
          // The letter scramble. Heat rises while the pointer is over the cell
          // and decays after it leaves, and the heat walks the garble palette
          // from mild punctuation up to ¥ @ # and back down — so the cell goes
          // abc -> . ~ : -> * ^ < -> @ # ¥ -> : ~ . -> abc. Below the resolve
          // threshold it snaps back to the character it actually owns.
          if (heat < 0.12) {
            ch = this.baseChars[cidx];
          } else {
            ch = this._pickGarble(cidx, heat, bucket);
          }
          alpha = lerp(clamp01(o.textOpacity), clamp01(o.garbleAlpha), Math.pow(heat, 0.7));
        } else {
          var gi = Math.round(Math.pow(inten, 0.72) * palMax);
          gi = clamp(gi, 1, palMax);
          ch = pal.charAt(gi);
          if (scramble > 0 && inten > 0.35 && Math.random() < scramble * 0.5) {
            ch = pal.charAt(clamp(Math.round(lerp(gi, palMax, Math.random())), 0, palMax));
          }
          alpha = lerp(clamp01(o.textOpacity), 1, Math.pow(inten, 0.6));
        }

        // slope displaces the glyph: the words bend into the wave. A garbled
        // cell is pinned: the ask was for the letter to change in place.
        var bendCells = (hot && heat > 0.15)
          ? 0
          : clamp(-dX * refraction * BEND_SCALE, -refraction, refraction);
        var xCss = tx * this.charW + bendCells * this.charW;

        // vignette: fade toward the edges, proportional to each axis
        var mx = Math.abs(xCss - cxCss) / halfW;
        var my = Math.abs(yCss + this.charH * 0.5 - cyCss) / halfH;
        var m = mx > my ? mx : my;
        var vg = m <= fadeStart ? 1 : 1 - (m - fadeStart) / Math.max(0.0001, vignette);

        alpha *= vg;
        if (alpha <= 0.01) continue;

        var col;
        if (hot) {
          col = mix(this.colText, this.colCrest, 1, alpha);
        } else if (signal >= 0) {
          col = mix(this.colText, this.colCrest, clamp01(inten * 1.15), alpha);
        } else {
          col = mix(this.colText, this.colTrough, clamp01(inten * 1.15), alpha);
        }

        // clear the resting glyph underneath, then stamp the disturbed one
        ctx.clearRect(xCss - 1, yCss, this.charW + 2, this.charH);
        ctx.fillStyle = col;
        ctx.fillText(ch, xCss, yCss + this.charH * 0.5);
        this.activeCells++;
      }
    }

    // Adaptive draw budget. Scrub the pointer over the whole hero and ~90% of
    // the text grid lights up: ~3500 clearRect+stamp pairs measured 15ms,
    // which is the entire 60fps budget. When that happens the cutoff creeps
    // up so only the strongest glyphs are stamped — the wave still reads, its
    // faint fringe is what gets dropped. It relaxes back afterwards.
    if (this.activeCells > DRAW_BUDGET) {
      this._drawThreshold = Math.min(0.85, this._drawThreshold + 0.04);
    } else if (this._drawThreshold > DRAW_THRESHOLD) {
      this._drawThreshold = Math.max(DRAW_THRESHOLD, this._drawThreshold - 0.01);
    }
  };

  /* ---------- loop ----------
     Exactly one callback is ever pending, enforced by a generation token.
     Input, idle timers and rAF all funnel through _schedule(), so a wake-up
     can never leave two competing loops running — overlapping chains do not
     throw, they silently multiply the frame rate. */
  AsciiRipple.prototype._schedule = function (delayMs) {
    var self = this;
    if (this._timer) { global.clearTimeout(this._timer); this._timer = 0; }
    var gen = ++this._gen;
    this.running = true;
    if (delayMs > 0) {
      this._timer = global.setTimeout(function () {
        if (gen !== self._gen) return;
        self._timer = 0;
        self._tick();
      }, delayMs);
    } else {
      this.raf = global.requestAnimationFrame(function () {
        if (gen !== self._gen) return;
        self._tick();
      });
    }
  };

  AsciiRipple.prototype._wake = function () {
    if (!this.visible) return;
    if (this.reduceMotion) { this._render(); return; }   // static frame only
    // a rAF frame already pending will pick this input up; an idle-throttled
    // timer is replaced so a click is not held behind a 34ms sleep
    if (this.running && !this._timer) return;
    this._schedule(0);
  };

  AsciiRipple.prototype._tick = function () {
    this.running = false;
    if (!this.visible || this.reduceMotion) return;

    var now = nowMs();
    var rain = this.opts.rain;
    var interactive = now - this.lastPointer <= this.opts.idleDelay;

    // Pointer-driven waves run every frame; once the pointer is gone only
    // ambient rain is left, which does not need 60 frames of work per second.
    var interval = interactive ? 0 : 34;
    if (interval && this.lastFrame && now - this.lastFrame < interval) {
      this._schedule(interval - (now - this.lastFrame));
      return;
    }

    var elapsed = this.lastFrame ? Math.min(250, now - this.lastFrame) : STEP_MS;
    this.lastFrame = now;
    this.time += elapsed;

    if (!interactive && rain > 0) {
      if (now >= this.nextRain) {
        this.nextRain = now + 1000 / rain;
        this.drop(Math.random() * this.cssW, Math.random() * this.cssH,
                  this.opts.rainStrength * (0.6 + Math.random() * 0.8));
      }
    } else {
      this.nextRain = now;
    }

    // Pointer scramble and ambient garble churn. Both are per-frame cosmetic
    // passes, not part of the fixed-timestep physics.
    this._updateHeat(elapsed);
    this._churnNoise(elapsed);

    // Fixed-timestep simulation. speed / damping / viscosity are per-step
    // quantities: without this, a 144Hz display would propagate and decay
    // waves 2.4x faster than a 60Hz one and the surface would feel different
    // on every machine.
    this._accum += elapsed;
    if (this._accum > STEP_MS * MAX_STEPS) this._accum = STEP_MS * MAX_STEPS;
    var steps = 0;
    while (this._accum >= STEP_MS && steps < MAX_STEPS) {
      this._applyDrops();
      this._step();
      this._accum -= STEP_MS;
      steps++;
    }
    if (steps) this._render();

    var still = this._energy() > 0.0015 || this.drops.length > 0 || this._heatActive > 0;
    if (still || (!interactive && rain > 0)) {
      this._schedule(0);
    } else {
      // settle: one final clean frame at rest, then stop burning frames
      this.calm();
      this._render();
    }
  };

  /* ---------- listeners ---------- */
  AsciiRipple.prototype._toLocal = function (e) {
    var r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  AsciiRipple.prototype._bind = function () {
    var self = this;
    var host = this.canvas.parentElement || this.canvas;

    this._onMove = function (e) {
      self.lastPointer = nowMs();
      var p = self._toLocal(e);
      // Pointer position feeds the letter scramble, so it is tracked whether
      // or not dragStrength is on — turning the wave off must not also turn
      // off the scramble.
      var mdx = p.x - self.pointer.x;
      var mdy = p.y - self.pointer.y;
      self.pointer.x = p.x;
      self.pointer.y = p.y;
      self.pointer.inside = (p.x >= 0 && p.y >= 0 && p.x <= self.cssW && p.y <= self.cssH);
      // a genuine move (not a coalesced same-point event) is what feeds heat
      if (mdx * mdx + mdy * mdy > 0.25) self.pointer.movedAt = self.lastPointer;

      // Frames are needed for the scramble too, so wake before the drag gate:
      // returning early on dragStrength <= 0 used to leave the scramble with
      // no render loop at all.
      self._wake();

      if (!self.opts.interactive || self.opts.dragStrength <= 0) return;
      if (!self.pointer.inside) return;
      // ignore sub-pixel jitter: a 240Hz pointer fires far more often than the
      // surface can absorb, and the trail would saturate to a solid block
      var dx = p.x - self._lastDrag.x, dy = p.y - self._lastDrag.y;
      if (dx * dx + dy * dy < 4) return;
      self._lastDrag.x = p.x;
      self._lastDrag.y = p.y;
      self.drops.push({
        x: p.x, y: p.y,
        s: self.opts.dragStrength, r: self.opts.dragRadius, drag: true
      });
      self._wake();
    };

    this._onDown = function (e) {
      self.lastPointer = nowMs();
      var p = self._toLocal(e);
      self.pointer.x = p.x;
      self.pointer.y = p.y;
      self.pointer.inside = true;
      self.pointer.movedAt = self.lastPointer;   // a click stirs the letters too
      if (!self.opts.interactive) return;
      self.drop(p.x, p.y);
    };

    this._onLeave = function () { self.pointer.inside = false; };

    // Attached unconditionally: _onMove itself decides whether the wave part
    // applies. The scramble only needs the pointer position.
    host.addEventListener("pointermove", this._onMove, { passive: true });
    host.addEventListener("pointerdown", this._onDown, { passive: true });
    host.addEventListener("pointerleave", this._onLeave, { passive: true });

    this._onResize = function () { self.resize(); };
    global.addEventListener("resize", this._onResize);

    if ("IntersectionObserver" in global) {
      this._io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          self.visible = entry.isIntersecting;
          if (self.visible) self._wake();
        });
      }, { threshold: 0 });
      this._io.observe(this.canvas);
    }

    // fonts land after first paint: re-measure so the grid is truly monospaced
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { self.resize(); }).catch(function () {});
    }
  };

  AsciiRipple.prototype.destroy = function () {
    this.visible = false;
    this.running = false;
    if (this.raf) global.cancelAnimationFrame(this.raf);
    if (this._timer) { global.clearTimeout(this._timer); this._timer = 0; }
    this.calm();
    if (this._io) this._io.disconnect();
    global.removeEventListener("resize", this._onResize);
    var host = this.canvas.parentElement || this.canvas;
    host.removeEventListener("pointermove", this._onMove);
    host.removeEventListener("pointerdown", this._onDown);
    host.removeEventListener("pointerleave", this._onLeave);
    this.pointer.inside = false;
  };

  /* ---------- inspection (used by the tuning pass; harmless in prod) ---------- */
  AsciiRipple.prototype.debug = function () {
    var u = this.u, min = 0, max = 0, s = 0;
    for (var i = 0; i < u.length; i++) {
      var v = u[i];
      if (v < min) min = v;
      if (v > max) max = v;
      s += v < 0 ? -v : v;
    }
    return {
      cols: this.cols, rows: this.rows,
      simW: this.simW, simH: this.simH, res: this.res,
      charW: +this.charW.toFixed(2), charH: +this.charH.toFixed(2),
      uMin: +min.toFixed(4), uMax: +max.toFixed(4),
      energy: +(s / u.length).toFixed(6),
      peak: +this._energy().toFixed(4),
      activeCells: this.activeCells || 0,
      heatActive: this._heatActive,
      noisyCells: this._noisy.length,
      garblePalette: this.garbleChars.length,
      running: this.running
    };
  };

  global.AsciiRipple = AsciiRipple;

  /* ---------- auto-init on [data-ascii-ripple] ---------- */
  function initAll() {
    var nodes = document.querySelectorAll("canvas[data-ascii-ripple]");
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__asciiRipple) { list.push(nodes[i].__asciiRipple); continue; }
      try {
        var inst = new AsciiRipple(nodes[i]);
        nodes[i].__asciiRipple = inst;
        list.push(inst);
      } catch (e) {
        // console.error, not warn: a construction failure used to hide here
        // and the only symptom was a canvas that never animated.
        if (global.console && console.error) console.error("AsciiRipple init failed:", e);
      }
    }
    return list;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  global.AsciiRipple.initAll = initAll;
})(typeof window !== "undefined" ? window : this);
