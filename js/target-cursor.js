/* =========================================================
   TargetCursor — vanilla JS port of the React Bits component
   ---------------------------------------------------------
   Original (JavaScript + CSS variant) needs React, react-dom
   (createPortal) and GSAP. This port keeps the same behaviour
   and the same prop names with zero dependencies: the handful
   of GSAP features the component uses (gsap.to / set / getProperty
   / killTweensOf / ticker / an infinite repeat timeline) are
   reimplemented in ~150 lines at the top of this file.

     TargetCursor.autoInit({
       targetSelector: '.btn, .nav__link, ...',
       spinDuration: 2, hideDefaultCursor: true,
       hoverDuration: 0.2, parallaxOn: true,
       cursorColor: '#ffffff'
     });

   Behaviour notes that differ from the original, on purpose:
   - The original relies on `document.body.style.cursor = 'none'`
     to hide the native pointer. That does NOT beat the site's own
     `cursor: pointer` on buttons and filters, so a stray native
     arrow shows up on exactly the elements that have a target.
     We add a `target-cursor-on` class to <html> and force
     `cursor: none` through a CSS rule instead.
   - prefers-reduced-motion: the reticle is a cursor affordance,
     not decoration, so it stays — but the perpetual spin and the
     corner parallax are switched off.
   ========================================================= */

(function (global) {
  "use strict";

  /* =========================================================
     1. Tiny tween core — the slice of GSAP the component uses
     ========================================================= */

  var EASES = {
    none: function (t) { return t; },
    "power1.out": function (t) { return 1 - Math.pow(1 - t, 2); },
    "power2.out": function (t) { return 1 - Math.pow(1 - t, 3); },
    "power3.out": function (t) { return 1 - Math.pow(1 - t, 4); }
  };

  var NODES = [];          // animated state objects
  var TICKERS = [];        // per-frame callbacks (the corner parallax lives here)
  var looping = false;
  var lastFrame = 0;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function parseColor(str) {
    if (typeof str !== "string") return null;
    str = str.trim();
    if (str.charAt(0) === "#") {
      var hex = str.slice(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      if (hex.length !== 6) return null;
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    var m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean);
    return p.length >= 3 ? [parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2])] : null;
  }

  function rgbString(c) {
    return "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")";
  }

  /* An animated state object: numbers (or rgb arrays) plus a writer. */
  function Anim(initial, apply) {
    this.v = {};
    this.t = {};
    this.apply = apply;
    for (var k in initial) this.v[k] = initial[k];
    this.apply(this.v);
    NODES.push(this);
  }

  Anim.prototype.set = function (props) {
    for (var k in props) {
      this.v[k] = props[k];
      delete this.t[k];
    }
    this.apply(this.v);
    return this;
  };

  Anim.prototype.to = function (props, duration, ease) {
    if (!(duration > 0)) return this.set(props);
    var e = EASES[ease] || EASES.none;
    for (var k in props) {
      this.t[k] = { from: this.v[k], to: props[k], t: 0, d: duration, e: e };
    }
    kick();
    return this;
  };

  Anim.prototype.kill = function (keys) {
    if (!keys) { this.t = {}; return this; }
    var list = String(keys).split(",");
    for (var i = 0; i < list.length; i++) delete this.t[list[i].trim()];
    return this;
  };

  Anim.prototype.get = function (k) { return this.v[k]; };

  function stepOne(node) {
    for (var k in node.t) {
      var tw = node.t[k];
      tw.t += lastDelta;
      var p = tw.d > 0 ? Math.min(1, tw.t / tw.d) : 1;
      var e = tw.e(p);
      var isColor = Object.prototype.toString.call(tw.to) === "[object Array]";
      if (isColor) {
        var out = [];
        for (var i = 0; i < tw.to.length; i++) out.push(tw.from[i] + (tw.to[i] - tw.from[i]) * e);
        node.v[k] = out;
      } else {
        node.v[k] = tw.from + (tw.to - tw.from) * e;
      }
      if (p >= 1) delete node.t[k];
    }
    node.apply(node.v);
  }

  var lastDelta = 0.016;

  function loop(now) {
    if (!looping) return;
    lastDelta = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;
    for (var i = 0; i < NODES.length; i++) stepOne(NODES[i]);
    for (var j = TICKERS.length - 1; j >= 0; j--) TICKERS[j](lastDelta);
    global.requestAnimationFrame(loop);
  }

  function kick() {
    if (looping) return;
    looping = true;
    lastFrame = 0;
    global.requestAnimationFrame(loop);
  }

  function addTicker(fn) { if (TICKERS.indexOf(fn) === -1) TICKERS.push(fn); kick(); }
  function removeTicker(fn) {
    var i = TICKERS.indexOf(fn);
    if (i !== -1) TICKERS.splice(i, 1);
  }

  /* =========================================================
     2. Containing-block compensation (ported verbatim in spirit)
     A position:fixed element is positioned against the viewport
     UNLESS an ancestor establishes a containing block — then the
     translate no longer maps to viewport coordinates.
     ========================================================= */
  function getContainingBlock(element) {
    var node = element && element.parentElement;
    while (node && node !== document.documentElement) {
      var s = getComputedStyle(node);
      var wc = s.willChange || "";
      if (s.transform !== "none" || s.perspective !== "none" || s.filter !== "none" ||
          wc.indexOf("transform") !== -1 || wc.indexOf("perspective") !== -1 ||
          wc.indexOf("filter") !== -1 || /paint|layout|strict|content/.test(s.contain)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function getContainingBlockOffset(block) {
    if (!block) return { x: 0, y: 0 };
    var r = block.getBoundingClientRect();
    return { x: r.left + block.clientLeft, y: r.top + block.clientTop };
  }

  function nowMs() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  function isMobile() {
    var hasTouch = "ontouchstart" in global || navigator.maxTouchPoints > 0;
    var small = global.innerWidth <= 768;
    var ua = (navigator.userAgent || navigator.vendor || "").toLowerCase();
    var mobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    return (hasTouch && small) || mobileUA;
  }

  /* =========================================================
     3. The component
     ========================================================= */

  var DEFAULTS = {
    targetSelector: ".cursor-target",
    spinDuration: 2,
    hideDefaultCursor: true,
    hoverDuration: 0.2,
    parallaxOn: true,
    cursorColor: "#ffffff",
    cursorColorOnTarget: null,
    // How far from a target's edge (px) the ring starts to open. Beyond it the
    // cursor rests as a closed square with a centre dot; closing in on a
    // control, the arms separate and the ring starts to spin.
    proximity: 90,
    // Micro-parallax budget in px. 0 (default) welds the brackets to the
    // target's corners: the mouse can roam inside a button and nothing moves.
    // Raise it a couple of px if you want a hint of drift back.
    parallaxAmount: 0,
    root: null            // the portal target; defaults to <body>
  };

  var BORDER_WIDTH = 3;
  var CORNER_SIZE = 12;
  // Below this openness the ring is treated as closed: the spin settles and the
  // square sits axis-aligned rather than frozen at whatever angle it reached.
  var SPIN_MIN = 0.06;

  function TargetCursor(options) {
    var o = {};
    var k;
    for (k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) o[k] = DEFAULTS[k];
    if (options) for (k in options) if (options.hasOwnProperty(k)) o[k] = options[k];
    this.o = o;

    this.reduceMotion = !!(global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches);

    // the original returns null on mobile — there is no pointer to decorate
    if (isMobile() || typeof document === "undefined") {
      this.disabled = true;
      return;
    }
    this._build();
  }

  TargetCursor.prototype._build = function () {
    var self = this;
    var o = this.o;
    var color = o.cursorColor;

    var root = o.root || document.body;

    // --- DOM: the portal equivalent (one fixed wrapper on <body>) ---
    var wrap = document.createElement("div");
    wrap.className = "target-cursor-wrapper";
    wrap.setAttribute("aria-hidden", "true");

    var dot = document.createElement("div");
    dot.className = "target-cursor-dot";
    dot.style.backgroundColor = color;
    wrap.appendChild(dot);

    var klass = ["corner-tl", "corner-tr", "corner-br", "corner-bl"];
    var corners = [];
    for (var i = 0; i < 4; i++) {
      var c = document.createElement("div");
      c.className = "target-cursor-corner " + klass[i];
      c.style.borderColor = color;
      wrap.appendChild(c);
      corners.push(c);
    }
    root.appendChild(wrap);

    this.wrap = wrap;
    this.dot = dot;
    this.corners = corners;

    // --- animated state -------------------------------------------------
    // Corner transform is fully JS-owned; the initial x/y is the closed rest
    // position (see _restCornerPositions(0)), which is also what the CSS
    // percentage translate resolves to, so there is no jump on the first frame.
    this.cornerAnims = corners.map(function (el) {
      return new Anim({ x: -CORNER_SIZE, y: -CORNER_SIZE }, function (v) {
        el.style.transform = "translate(" + v.x.toFixed(2) + "px," + v.y.toFixed(2) + "px)";
      });
    });
    // seed per-corner rest positions, closed by default (no target in reach)
    this._restCornerPositions(0).forEach(function (p, idx) {
      self.cornerAnims[idx].set(p);
    });

    this.wrapAnim = new Anim({ x: global.innerWidth / 2, y: global.innerHeight / 2, rotation: 0, scale: 1 },
      function (v) {
        wrap.style.transform = "translate(" + v.x.toFixed(2) + "px," + v.y.toFixed(2) + "px) rotate(" +
          v.rotation.toFixed(3) + "deg) scale(" + v.scale.toFixed(3) + ")";
      });

    this.dotAnim = new Anim({ scale: 1 }, function (v) {
      dot.style.transform = "translate(-50%,-50%) scale(" + v.scale.toFixed(3) + ")";
    });

    if (o.cursorColorOnTarget) {
      this.cornerColors = corners.map(function (el) {
        return new Anim({ c: parseColor(color) }, function (v) { el.style.borderColor = rgbString(v.c); });
      });
      this.dotColor = new Anim({ c: parseColor(color) }, function (v) { dot.style.backgroundColor = rgbString(v.c); });
    }

    // --- misc state -----------------------------------------------------
    this.activeTarget = null;
    this.cornerStartAbs = null;      // viewport-space take-off point of a lock
    this.strength = 0;
    this.strengthAnim = new Anim({ v: 0 }, function () {});   // tweened 0..1
    // --- proximity / rest ring ------------------------------------------
    this.open = 0;                 // 0 = closed square, 1 = exploded ring
    this._lastOpen = -1;
    this._restDirty = false;       // set on release so the ring re-docks
    this.pointer = { x: global.innerWidth / 2, y: global.innerHeight / 2 };
    this._rects = null;
    this._rectsAt = 0;
    this._rectsPtrX = -1e6;
    this._rectsPtrY = -1e6;
    this._rectsScrollY = -1e6;
    this.rotation = 0;
    this.containingBlock = getContainingBlock(wrap);
    this.originalCursor = document.body.style.cursor;

    if (o.hideDefaultCursor) {
      // see the header note: body.style.cursor loses to the page's own
      // `cursor: pointer`, so the class + CSS rule does the real work
      document.documentElement.classList.add("target-cursor-on");
      document.body.style.cursor = "none";
    }

    this._bind();
    addTicker(this._spinTicker = function (dt) { self._tickCursor(dt); });
  };

  /* Rest ring, parametrised by openness.
     open = 0  -> CLOSED 24px square: each corner sits 12px from the centre, so
                  the two 12px arms of every edge meet end to end and the
                  outline is continuous. Arms read as one square.
     open = 1  -> the 36px exploded ring the component ships with, arms 6px
                  further out on each axis, which is what the corners animate
                  from when they fly out to a target's box.
     Every corner therefore travels 6px diagonally per unit of `open`. */
  TargetCursor.prototype._restCornerPositions = function (open) {
    var p = open > 0 ? (open > 1 ? 1 : open) : 0;
    var c = CORNER_SIZE;
    var s = c * 0.5 * p;             // outward spread
    return [
      { x: -c - s, y: -c - s },
      { x: s, y: -c - s },
      { x: s, y: s },
      { x: -c - s, y: s }
    ];
  };

  /* --- cursor follow ---------------------------------------------------- */
  TargetCursor.prototype._moveCursor = function (x, y) {
    var off = getContainingBlockOffset(this.containingBlock);
    this.wrapAnim.to({ x: x - off.x, y: y - off.y }, 0.1, "power3.out");
  };

  /* --- the frame ticker -------------------------------------------------- */
  TargetCursor.prototype._tickCursor = function (dt) {
    // While a target is locked the corner parallax ticker owns the corners, so
    // the ring must not fight it.
    if (this.activeTarget) return;
    this._tickProximity();
    this._tickSpin(dt);
  };

  /* Rects of every target, cached. This runs inside the frame loop and the page
     holds ~80 targets, so the rects are refreshed on a timer, when the pointer
     has travelled far enough to make the old ones meaningless, or after a
     scroll. The 3D tilt main.js applies to hovered cards only affects the card
     under the pointer, which the lock path re-measures every frame anyway. */
  TargetCursor.prototype._targetRects = function () {
    var p = this.pointer;
    var now = nowMs();
    var sy = global.pageYOffset || 0;
    // rects are viewport-relative, so a scroll invalidates them too
    if (!this._rects || now - this._rectsAt > 250 || Math.abs(sy - this._rectsScrollY) > 20 ||
        Math.abs(p.x - this._rectsPtrX) > 40 || Math.abs(p.y - this._rectsPtrY) > 40) {
      var els = document.querySelectorAll(this.o.targetSelector);
      var out = [];
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        if (r.width && r.height) out.push(r);   // filtered-out cards report 0x0
      }
      this._rects = out;
      this._rectsAt = now;
      this._rectsScrollY = sy;
      this._rectsPtrX = p.x;
      this._rectsPtrY = p.y;
    }
    return this._rects;
  };

  /* 0 = nothing in reach, 1 = at a target's edge. Chebyshev distance, so the
     "near" zone is square like the ring it drives. */
  TargetCursor.prototype._openness = function (x, y) {
    var rects = this._targetRects();
    var reach = Math.max(1, this.o.proximity);
    var full = reach * 0.35;              // fully open this close to the edge
    var near = Infinity;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
      var dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
      var d = dx > dy ? dx : dy;
      if (d < near) {
        near = d;
        if (near <= full) return 1;
      }
    }
    if (near === Infinity || near >= reach) return 0;
    if (near <= full) return 1;
    return 1 - (near - full) / (reach - full);
  };

  TargetCursor.prototype._tickProximity = function () {
    var open = this._openness(this.pointer.x, this.pointer.y);
    if (Math.abs(open - this._lastOpen) > 0.001 || this._restDirty) {
      // Retargeted every frame from the current value, so releasing a target
      // eases back into the ring instead of snapping to it.
      var rest = this._restCornerPositions(open);
      for (var i = 0; i < 4; i++) this.cornerAnims[i].to(rest[i], 0.12, "power2.out");
      this._lastOpen = open;
      this._restDirty = false;
    }
    this.open = open;
  };

  /* --- spin: only while the ring is open --------------------------------- */
  TargetCursor.prototype._tickSpin = function (dt) {
    if (this.reduceMotion) return;
    if (this.open > SPIN_MIN) {
      this.rotation = (this.rotation + (360 * dt) / Math.max(0.05, this.o.spinDuration)) % 360;
    } else if (this.rotation !== 0) {
      // Settle upright. The closed state is an axis-aligned square, so freezing
      // wherever the spin happened to stop would leave it sitting as a diamond.
      var d = ((0 - this.rotation + 540) % 360) - 180;     // shortest signed way to 0
      this.rotation = (this.rotation + d * Math.min(1, dt * 7) + 360) % 360;
      if (this.rotation < 0.3 || this.rotation > 359.7) this.rotation = 0;
    } else {
      return;                                              // already settled
    }
    this.wrapAnim.set({ rotation: this.rotation });
  };

  /* Viewport coordinates of the four brackets for a given rect. Shared by the
     lock ticker and the enter handler so both agree on where "the corners" are. */
  TargetCursor.prototype._targetCornerPositions = function (rect, off) {
    return [
      { x: rect.left - BORDER_WIDTH - off.x, y: rect.top - BORDER_WIDTH - off.y },
      { x: rect.right + BORDER_WIDTH - CORNER_SIZE - off.x, y: rect.top - BORDER_WIDTH - off.y },
      { x: rect.right + BORDER_WIDTH - CORNER_SIZE - off.x, y: rect.bottom + BORDER_WIDTH - CORNER_SIZE - off.y },
      { x: rect.left - BORDER_WIDTH - off.x, y: rect.bottom + BORDER_WIDTH - CORNER_SIZE - off.y }
    ];
  };

  /* Turn a bracket's stored local offset back into a viewport position. */
  TargetCursor.prototype._cornerAbs = function (i, off) {
    var cx = this.wrapAnim.get("x");
    var cy = this.wrapAnim.get("y");
    var scale = this.wrapAnim.get("scale") || 1;
    return {
      x: off.x + cx + this.cornerAnims[i].get("x") * scale,
      y: off.y + cy + this.cornerAnims[i].get("y") * scale
    };
  };

  /* --- corner lock while a target is held ---------------------------------
     The brackets used to be positioned relative to the wrapper — which is
     itself still chasing the pointer with its own 0.1s follow tween — and then
     eased into place with a second 0.2s tween. Every pixel the mouse travelled
     inside a button therefore re-fed both tweens and the frame lagged behind,
     dragging the corners around well past the button's own corners.

     This ticker works in absolute viewport coordinates instead:
       - the four target corners are re-measured from the live rect,
       - the blend from take-off to target is driven purely by `strength`,
       - the resulting absolute point is converted back to a local offset using
         the wrapper position rendered *this* frame.
     Net effect: once locked, moving the mouse inside the button moves nothing
     but the centre dot. The brackets stay welded to the corners, even while
     the wrapper is still easing, while the page scrolls, or while a card is
     tilting. */
  TargetCursor.prototype._cornerTicker = function () {
    var self = this;
    return function () {
      var target = self.activeTarget;
      if (!target || !self.cornerStartAbs) return;
      var s = self.strengthAnim.get("v");
      self.strength = s;              // mirror, for inspection only
      if (s === 0) return;

      // Re-measured every frame rather than trusting the rect taken at enter:
      // the page tilts .cards in 3D on mousemove (see main.js), so a single
      // cached rect would leave the brackets trailing behind the card.
      var rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;      // filtered-out cards: 0x0
      var off = getContainingBlockOffset(self.containingBlock);
      var abs = self._targetCornerPositions(rect, off);

      // Optional micro-drift, shared by all four corners so the box keeps its
      // shape. Off (parallaxAmount 0) by default — see DEFAULTS.
      var dx = 0, dy = 0;
      if (self.o.parallaxOn && self.o.parallaxAmount > 0) {
        var tcx = (rect.left + rect.right) / 2;
        var tcy = (rect.top + rect.bottom) / 2;
        var nx = (self.pointer.x - tcx) / Math.max(1, rect.width / 2);
        var ny = (self.pointer.y - tcy) / Math.max(1, rect.height / 2);
        var amt = self.o.parallaxAmount;
        dx = -clamp01(Math.abs(nx)) * (nx < 0 ? -1 : 1) * amt;
        dy = -clamp01(Math.abs(ny)) * (ny < 0 ? -1 : 1) * amt;
      }

      var cx = self.wrapAnim.get("x");
      var cy = self.wrapAnim.get("y");
      var scale = self.wrapAnim.get("scale") || 1;

      for (var i = 0; i < 4; i++) {
        var ax = self.cornerStartAbs[i].x + (abs[i].x - self.cornerStartAbs[i].x) * s + dx * s;
        var ay = self.cornerStartAbs[i].y + (abs[i].y - self.cornerStartAbs[i].y) * s + dy * s;
        // Written with .set(), not .to(): there is nothing to ease towards. The
        // tween already happened above, in absolute space, via `s`.
        self.cornerAnims[i].set({
          x: (ax - off.x - cx) / scale,
          y: (ay - off.y - cy) / scale
        });
      }
    };
  };

  /* --- target enter ----------------------------------------------------- */
  TargetCursor.prototype._enter = function (e) {
    var sel = this.o.targetSelector;
    var all = [];
    var cur = e.target;
    while (cur && cur !== document.body) {
      if (cur.matches && cur.matches(sel)) all.push(cur);
      cur = cur.parentElement;
    }
    var target = all[0] || null;
    if (!target || this.activeTarget === target) return;

    var self = this;

    this._cleanupLeave(this.activeTarget);

    // reticle snaps upright so the brackets can frame an axis-aligned box
    this.rotation = 0;
    this.wrapAnim.set({ rotation: 0 });

    if (this.cornerColors) {
      for (var i = 0; i < 4; i++) this.cornerColors[i].to({ c: parseColor(this.o.cursorColorOnTarget) }, 0.15, "power2.out");
      this.dotColor.to({ c: parseColor(this.o.cursorColorOnTarget) }, 0.15, "power2.out");
    }

    this.activeTarget = target;

    // Take-off point, in viewport coordinates: wherever the reticle happens to
    // be resting right now. The lock is a straight blend from here to the
    // target's corners, so it cannot be perturbed by later mouse movement.
    var offCb = getContainingBlockOffset(this.containingBlock);
    this.cornerStartAbs = [];
    for (var n4 = 0; n4 < 4; n4++) this.cornerStartAbs.push(this._cornerAbs(n4, offCb));

    this.strengthAnim.set({ v: 0 });
    this.strengthAnim.to({ v: 1 }, this.o.hoverDuration, "power2.out");

    var ticker = this._cornerTicker();
    this.tickerFn = ticker;
    addTicker(ticker);

    var leaveHandler = function () {
      removeTicker(self.tickerFn);
      self.tickerFn = null;
      self.cornerStartAbs = null;
      self.strength = 0;
      self.strengthAnim.set({ v: 0 });
      var left = self.activeTarget;
      self.activeTarget = null;

      if (self.cornerColors) {
        for (var n = 0; n < 4; n++) self.cornerColors[n].to({ c: parseColor(self.o.cursorColor) }, 0.15, "power2.out");
        self.dotColor.to({ c: parseColor(self.o.cursorColor) }, 0.15, "power2.out");
      }

      // Retarget the ring back to the closed rest positions: the proximity
      // ticker eases them there from wherever the lock left them.
      self._restDirty = true;

      if (left) left.removeEventListener("mouseleave", self.currentLeaveHandler);
      self.currentLeaveHandler = null;
    };

    this.currentLeaveHandler = leaveHandler;
    target.addEventListener("mouseleave", leaveHandler);
  };

  TargetCursor.prototype._cleanupLeave = function (target) {
    if (this.currentLeaveHandler && target) {
      target.removeEventListener("mouseleave", this.currentLeaveHandler);
    }
    this.currentLeaveHandler = null;
  };

  /* --- listeners --------------------------------------------------------- */
  TargetCursor.prototype._bind = function () {
    var self = this;

    this._onMove = function (e) {
      self.pointer.x = e.clientX;
      self.pointer.y = e.clientY;
      self._moveCursor(e.clientX, e.clientY);
    };
    this._onOver = function (e) { self._enter(e); };
    this._onDown = function () {
      self.dotAnim.to({ scale: 0.7 }, 0.3);
      self.wrapAnim.to({ scale: 0.9 }, 0.2);
    };
    this._onUp = function () {
      self.dotAnim.to({ scale: 1 }, 0.3);
      self.wrapAnim.to({ scale: 1 }, 0.2);
    };
    // keeping the target locked while the page scrolls under the pointer
    this._onScroll = function () {
      if (!self.activeTarget) return;
      var off = getContainingBlockOffset(self.containingBlock);
      var mx = self.wrapAnim.get("x") + off.x;
      var my = self.wrapAnim.get("y") + off.y;
      var el = document.elementFromPoint(mx, my);
      var still = el && (el === self.activeTarget || (el.closest && el.closest(self.o.targetSelector) === self.activeTarget));
      if (!still && self.currentLeaveHandler) self.currentLeaveHandler();
    };
    this._onResize = function () { self.containingBlock = getContainingBlock(self.wrap); };

    global.addEventListener("mousemove", this._onMove);
    global.addEventListener("mouseover", this._onOver, { passive: true });
    global.addEventListener("mousedown", this._onDown);
    global.addEventListener("mouseup", this._onUp);
    global.addEventListener("scroll", this._onScroll, { passive: true });
    global.addEventListener("resize", this._onResize);
  };

  TargetCursor.prototype.destroy = function () {
    if (this.disabled) return;
    if (this.tickerFn) removeTicker(this.tickerFn);
    if (this._spinTicker) removeTicker(this._spinTicker);
    global.removeEventListener("mousemove", this._onMove);
    global.removeEventListener("mouseover", this._onOver);
    global.removeEventListener("mousedown", this._onDown);
    global.removeEventListener("mouseup", this._onUp);
    global.removeEventListener("scroll", this._onScroll);
    global.removeEventListener("resize", this._onResize);
    this._cleanupLeave(this.activeTarget);
    document.documentElement.classList.remove("target-cursor-on");
    document.body.style.cursor = this.originalCursor;
    if (this.wrap && this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
    this.disabled = true;
  };

  /* =========================================================
     4. Auto-init + inspection
     ========================================================= */
  TargetCursor.autoInit = function (options) {
    var script = document.querySelector("script[data-target-cursor]");
    var opts = options || {};
    if (script) {
      var attrs = ["target-selector", "spin-duration", "hover-duration", "hide-default-cursor",
                   "parallax-on", "cursor-color", "cursor-color-on-target"];
      var keys = ["targetSelector", "spinDuration", "hoverDuration", "hideDefaultCursor",
                  "parallaxOn", "cursorColor", "cursorColorOnTarget"];
      for (var i = 0; i < attrs.length; i++) {
        var v = script.getAttribute("data-" + attrs[i]);
        if (v === null || v === "") continue;
        if (keys[i] === "spinDuration" || keys[i] === "hoverDuration") opts[keys[i]] = parseFloat(v);
        else if (keys[i] === "hideDefaultCursor" || keys[i] === "parallaxOn") opts[keys[i]] = (v === "true" || v === "1");
        else opts[keys[i]] = v;
      }
    }
    var inst = new TargetCursor(opts);
    global.__targetCursor = inst;
    return inst;
  };

  global.TargetCursor = TargetCursor;

  /* =========================================================
     5. Default wiring for this site
     Every interactive control: buttons, nav links, filter pills,
     portfolio cards, contact rows, education cards, tags.
     Trim the list here if any of them should keep the plain arrow.
     ========================================================= */
  TargetCursor.SITE_TARGETS = [
    ".btn",
    ".nav__link",
    ".nav__toggle",
    ".filter",
    ".card",
    ".contact__row",
    ".edu__card",
    ".tag"
  ].join(", ");

  function boot() {
    TargetCursor.autoInit({
      targetSelector: TargetCursor.SITE_TARGETS,
      spinDuration: 2,
      hideDefaultCursor: true,
      hoverDuration: 0.2,
      parallaxOn: true,
      parallaxAmount: 0,      // brackets weld to the corners, nothing drifts
      proximity: 90,              // far: closed square + dot; near a control: the open spinning ring
      cursorColor: "#ffffff"      // difference blend: dark on paper, white on the dark sections
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})(typeof window !== "undefined" ? window : this);
