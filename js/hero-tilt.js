/* =========================================================
   Hero tilt — pointer reaction for real type
   ---------------------------------------------------------
   This is the motion the ASCIIText layer used to provide, kept
   after the glyph grid was removed and applied to ordinary
   text: the line leans in 3D so its surface faces the cursor.

   Markup:
     <h1 class="hero__title">                 <- gets `perspective`
       <span data-tilt-3d
             data-tilt="12"                   peak rotation, degrees
             data-tilt-perspective="1100"     px, set on the parent
             data-tilt-ease="0.12"            lerp per frame
             data-tilt-pad-y="96"             px of dead-air above/below that
                                              still counts as "at the title"
             data-tilt-pad-x="120"            ditto, left/right
         >HI ! I am Jax</span>
     </h1>

   Sensing area. Listening for pointermove ON the element meant the effect
   only existed inside the glyph box: a hero title is ~130px tall in an
   ~800px hero, so the pointer fell off it constantly and the line snapped
   flat the moment you strayed above or below. The pointer is now read from
   the window and judged against the element rect grown by pad-y / pad-x
   (auto-sized from the element itself when the attributes are absent), so
   the line keeps tracking well past its own top and bottom edges and only
   relaxes once you are genuinely elsewhere.

   Within the element's own box the axis reaches INNER of the peak rotation;
   the rest of the way out to the padded edge fills the remaining 1-INNER.
   That keeps almost all of the old punch over the type itself while giving
   the extended zone something continuous to do instead of a plateau.

   Signs. CSS rotateX(+) sends the top edge AWAY from the viewer and
   rotateY(+) sends the right edge away. Both axes therefore use
   "far edge follows the cursor", which makes the surface normal point
   at the cursor. The component this replaces fed the vertical axis the
   opposite sign, so its two axes were mirror images and moving the
   pointer up appeared to tilt the wrong way.

   Cost. One rAF chain that stops the moment both axes settle, so a parked
   pointer costs no transform work. Moving it costs one getBoundingClientRect
   per pointermove — the same reason the old element-level listener could not
   stay: it was free, but it was also deaf everywhere it mattered.
   ========================================================= */
(function (global) {
  "use strict";

  var DEFAULTS = {
    selector: "[data-tilt-3d]",
    tilt: 12,
    perspective: 1100,
    ease: 0.12,
    settle: 0.0015,     // rad; below this a step is not visible
    // Sensing area, auto-sized when the element carries no explicit pad:
    padY: { fraction: 1.15, min: 96 },  // top/bottom, ~3.3x the line box tall
    padX: { fraction: 0.1, min: 40 },   // left/right
    inner: 0.8          // share of peak rotation reached at the element's edge
  };

  function num(v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* Signed -1..1 along one axis. Inside the element's own extent the ramp is
     steep (reaching `inner` at its edge); the padded remainder adds the last
     stretch of travel so leaving the box is a continuation, not a wall. */
  function axis(delta, half, pad, inner) {
    var a = Math.abs(delta);
    var v;
    if (a <= half) v = inner * (a / half);
    else if (pad <= 0) v = inner;
    else v = inner + (1 - inner) * Math.min(1, (a - half) / pad);
    return delta < 0 ? -v : v;
  }

  function Tilt(el) {
    this.el = el;
    this.o = {
      tilt: num(el.getAttribute("data-tilt"), DEFAULTS.tilt),
      perspective: num(el.getAttribute("data-tilt-perspective"), DEFAULTS.perspective),
      ease: clamp(num(el.getAttribute("data-tilt-ease"), DEFAULTS.ease), 0.02, 1)
    };
    // null = derive from the element's own size every time it is measured
    this.padY = el.hasAttribute("data-tilt-pad-y") ? Math.max(0, num(el.getAttribute("data-tilt-pad-y"), 0)) : null;
    this.padX = el.hasAttribute("data-tilt-pad-x") ? Math.max(0, num(el.getAttribute("data-tilt-pad-x"), 0)) : null;
    this.rx = 0;   // current, radians
    this.ry = 0;
    this.tx = 0;   // target
    this.ty = 0;
    this.raf = 0;

    el.style.transformStyle = "preserve-3d";
    // perspective belongs on the parent: on the transformed element itself it
    // would apply per-descendant and the rotation would read as a shear
    if (el.parentNode) {
      el.parentNode.style.perspective = this.o.perspective + "px";
    }

    var self = this;
    this._onMove = function (e) { self._aim(e.clientX, e.clientY); };
    this._onLeave = function () { self.tx = 0; self.ty = 0; self._wake(); };

    // The element itself can no longer be the listener: everything outside its
    // glyph box is exactly the region we now want to hear about. One rect read
    // per pointermove for one element costs nothing.
    global.addEventListener("pointermove", this._onMove, { passive: true });
    // a pointer that leaves the window fires nothing on the way out
    document.addEventListener("pointerleave", this._onLeave);
    global.addEventListener("blur", this._onLeave);
  }

  Tilt.prototype._padFor = function (explicit, extent, def) {
    if (explicit !== null) return explicit;
    return Math.max(def.min, extent * def.fraction);
  };

  Tilt.prototype._aim = function (clientX, clientY) {
    var r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;

    var padY = this._padFor(this.padY, r.height, DEFAULTS.padY);
    var padX = this._padFor(this.padX, r.width, DEFAULTS.padX);

    var dx = clientX - (r.left + r.width / 2);
    var dy = clientY - (r.top + r.height / 2);       // + = below centre
    if (Math.abs(dx) > r.width / 2 + padX || Math.abs(dy) > r.height / 2 + padY) {
      // Outside the sensing area — relax to flat. Guard the write so a pointer
      // crossing empty hero space does not wake a parked ticker every event.
      if (this.tx !== 0 || this.ty !== 0) { this.tx = 0; this.ty = 0; this._wake(); }
      return;
    }

    var nx = axis(dx, r.width / 2, padX, DEFAULTS.inner);
    var ny = axis(dy, r.height / 2, padY, DEFAULTS.inner);
    var t = this.o.tilt * Math.PI / 180;
    this.tx = -ny * t;   // pointer above -> top edge recedes
    this.ty = nx * t;    // pointer right -> right edge recedes
    this._wake();
  };

  Tilt.prototype._wake = function () {
    if (this.raf) return;
    var self = this;
    this.raf = global.requestAnimationFrame(function () { self._tick(); });
  };

  Tilt.prototype._tick = function () {
    var k = this.o.ease;
    this.rx += (this.tx - this.rx) * k;
    this.ry += (this.ty - this.ry) * k;

    var settled = Math.abs(this.tx - this.rx) < DEFAULTS.settle &&
                  Math.abs(this.ty - this.ry) < DEFAULTS.settle;
    if (settled) { this.rx = this.tx; this.ry = this.ty; }

    this.el.style.transform = "rotateX(" + this.rx.toFixed(5) + "rad) rotateY(" +
      this.ry.toFixed(5) + "rad)";

    if (settled) { this.raf = 0; return; }
    var self = this;
    this.raf = global.requestAnimationFrame(function () { self._tick(); });
  };

  Tilt.prototype.destroy = function () {
    if (this.raf) global.cancelAnimationFrame(this.raf);
    this.raf = 0;
    global.removeEventListener("pointermove", this._onMove);
    document.removeEventListener("pointerleave", this._onLeave);
    global.removeEventListener("blur", this._onLeave);
    this.el.style.transform = "";
  };

  var HeroTilt = {
    DEFAULTS: DEFAULTS,
    Tilt: Tilt,
    instances: [],
    init: function (el) {
      // No motion for a reduced-motion user, and nothing to aim on a touch
      // screen — the effect is pointer-driven or absent.
      if (!el || el.__heroTilt) return el && el.__heroTilt;
      if (global.matchMedia) {
        if (global.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
        if (global.matchMedia("(pointer: coarse)").matches) return null;
      }
      var inst = new Tilt(el);
      el.__heroTilt = inst;
      HeroTilt.instances.push(inst);
      return inst;
    },
    initAll: function () {
      var nodes = document.querySelectorAll(DEFAULTS.selector);
      var out = [];
      for (var i = 0; i < nodes.length; i++) {
        var inst = HeroTilt.init(nodes[i]);
        if (inst) out.push(inst);
      }
      return out;
    }
  };

  global.HeroTilt = HeroTilt;

  function boot() {
    try {
      HeroTilt.initAll();
    } catch (err) {
      // loud: a swallowed failure here looks exactly like "the effect is off"
      console.error("[hero-tilt] init failed", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
