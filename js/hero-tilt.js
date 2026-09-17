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
         >HI ! I am Jax</span>
     </h1>

   Signs. CSS rotateX(+) sends the top edge AWAY from the viewer and
   rotateY(+) sends the right edge away. Both axes therefore use
   "far edge follows the cursor", which makes the surface normal point
   at the cursor. The component this replaces fed the vertical axis the
   opposite sign, so its two axes were mirror images and moving the
   pointer up appeared to tilt the wrong way.

   Cost. One rAF chain that stops the moment both axes settle, so a
   parked pointer costs nothing and no transform work happens at rest.
   ========================================================= */
(function (global) {
  "use strict";

  var DEFAULTS = {
    selector: "[data-tilt-3d]",
    tilt: 12,
    perspective: 1100,
    ease: 0.12,
    settle: 0.0015      // rad; below this a step is not visible
  };

  function num(v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function Tilt(el) {
    this.el = el;
    this.o = {
      tilt: num(el.getAttribute("data-tilt"), DEFAULTS.tilt),
      perspective: num(el.getAttribute("data-tilt-perspective"), DEFAULTS.perspective),
      ease: clamp(num(el.getAttribute("data-tilt-ease"), DEFAULTS.ease), 0.02, 1)
    };
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

    el.addEventListener("pointermove", this._onMove);
    el.addEventListener("pointerleave", this._onLeave);
    // a pointer that leaves the window without firing pointerleave
    global.addEventListener("blur", this._onLeave);
  }

  Tilt.prototype._aim = function (clientX, clientY) {
    var r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // -1..1 from the element's centre, +ny = below centre
    var nx = clamp((clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
    var ny = clamp((clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
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
    this.el.removeEventListener("pointermove", this._onMove);
    this.el.removeEventListener("pointerleave", this._onLeave);
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
