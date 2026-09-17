/* =========================================================
   DomeGallery — vanilla JS port of the React Bits component
   ---------------------------------------------------------
   Original: React + @use-gesture/react. A dome of image tiles
   laid out on a sphere with CSS 3D transforms, dragged with
   inertia, and click-to-enlarge into a centred frame.

   Two things replaced:

     1. @use-gesture/react. It supplies drag start/progress/end
        with velocity, direction and movement. All of that is
        pointer events plus a short sample buffer, which is what
        is implemented here; the inertia maths is the component's
        own and is unchanged.
     2. The React wrapper: a plain class owns the DOM, the
        ResizeObserver and the drag state.

   Nothing here touches a canvas, a texture or any pixel data, so
   it works from file:// as well as a host — no taint problem.

   One deliberate addition: the tiles carry role="button" and
   tabindex in the original but had no keyboard handler, so Enter
   and Space open a tile here.
   ========================================================= */
(function (global) {
  "use strict";

  var DEFAULTS = {
    fit: 0.5,
    fitBasis: "auto",
    minRadius: 600,
    maxRadius: Infinity,
    padFactor: 0.25,
    overlayBlurColor: "#120F17",
    maxVerticalRotationDeg: 5,
    dragSensitivity: 20,
    enlargeTransitionMs: 300,
    segments: 35,
    dragDampening: 2,
    openedImageWidth: "400px",
    openedImageHeight: "400px",
    imageBorderRadius: "30px",
    openedImageBorderRadius: "30px",
    grayscale: true,
    selector: "[data-dome-gallery]"
  };

  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
  function normalizeAngle(d) { return ((d % 360) + 360) % 360; }
  function wrapAngleSigned(deg) { return ((((deg + 180) % 360) + 360) % 360) - 180; }

  function getDataNumber(el, name, fallback) {
    var attr = el.dataset[name];
    if (attr == null) attr = el.getAttribute("data-" + name.replace(/[A-Z]/g, function (m) {
      return "-" + m.toLowerCase();
    }));
    if (attr == null) return fallback;
    var n = parseFloat(attr);
    return isFinite(n) ? n : fallback;
  }

  /* Tile layout: `segments` columns stepping 2 units around the sphere, and
     five rows per column, offset by one on alternate columns so the tiles brick
     up instead of lining into seams. */
  function buildItems(pool, seg) {
    var xCols = [];
    for (var i = 0; i < seg; i++) xCols.push(-37 + i * 2);
    var evenYs = [-4, -2, 0, 2, 4];
    var oddYs = [-3, -1, 1, 3, 5];

    var coords = [];
    xCols.forEach(function (x, c) {
      var ys = c % 2 === 0 ? evenYs : oddYs;
      ys.forEach(function (y) { coords.push({ x: x, y: y, sizeX: 2, sizeY: 2 }); });
    });

    var totalSlots = coords.length;
    if (pool.length === 0) {
      return coords.map(function (c) { return { x: c.x, y: c.y, sizeX: 2, sizeY: 2, src: "", alt: "" }; });
    }
    if (pool.length > totalSlots) {
      console.warn("[dome-gallery] provided image count (" + pool.length + ") exceeds available tiles (" +
        totalSlots + "). Some images will not be shown.");
    }

    var normalized = pool.map(function (image) {
      if (typeof image === "string") return { src: image, alt: "" };
      return { src: image.src || "", alt: image.alt || "" };
    });

    var used = [];
    for (var k = 0; k < totalSlots; k++) used.push(normalized[k % normalized.length]);

    // avoid two identical neighbours: swap the repeat with the next different one
    for (var a = 1; a < used.length; a++) {
      if (used[a].src === used[a - 1].src) {
        for (var b = a + 1; b < used.length; b++) {
          if (used[b].src !== used[a].src) {
            var tmp = used[a]; used[a] = used[b]; used[b] = tmp;
            break;
          }
        }
      }
    }

    return coords.map(function (c, idx) {
      return { x: c.x, y: c.y, sizeX: c.sizeX, sizeY: c.sizeY, src: used[idx].src, alt: used[idx].alt };
    });
  }

  function computeItemBaseRotation(offsetX, offsetY, sizeX, sizeY, segments) {
    var unit = 360 / segments / 2;
    return {
      rotateY: unit * (offsetX + (sizeX - 1) / 2),
      rotateX: unit * (offsetY - (sizeY - 1) / 2)
    };
  }

  /* =========================================================
     The component
     ========================================================= */
  function DomeGallery(el, options) {
    this.el = el;
    var o = this.o = {};
    for (var k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) o[k] = DEFAULTS[k];
    if (options) for (var j in options) if (options.hasOwnProperty(j)) o[j] = options[j];

    this.images = o.images && o.images.length ? o.images : [];
    this.rotation = { x: 0, y: 0 };
    this.startRot = { x: 0, y: 0 };
    this.startPos = null;
    this.dragging = false;
    this.moved = false;
    this.inertiaRAF = 0;
    this.opening = false;
    this.openStartedAt = 0;
    this.lastDragEndAt = 0;
    this.focusedEl = null;
    this.originalTilePosition = null;
    this.lockedRadius = null;
    this.scrollLocked = false;
    this.samples = [];

    this.build();
  }

  DomeGallery.prototype.build = function () {
    var self = this;
    var o = this.o;

    var items = buildItems(this.images, o.segments);

    var tiles = items.map(function (it) {
      return '<div class="item"' +
        ' data-src="' + escapeAttr(it.src) + '"' +
        ' data-offset-x="' + it.x + '" data-offset-y="' + it.y + '"' +
        ' data-size-x="' + it.sizeX + '" data-size-y="' + it.sizeY + '"' +
        ' style="--offset-x:' + it.x + ';--offset-y:' + it.y +
        ';--item-size-x:' + it.sizeX + ';--item-size-y:' + it.sizeY + '">' +
        '<div class="item__image" role="button" tabindex="0" aria-label="' +
        escapeAttr(it.alt || "Open image") + '">' +
        '<img src="' + escapeAttr(it.src) + '" draggable="false" alt="' + escapeAttr(it.alt) + '">' +
        "</div></div>";
    }).join("");

    // The component's own root lives INSIDE the sized container, which is the
    // structure the documented config uses (a sized wrapper div around
    // <DomeGallery/>). Putting .sphere-root on the sized element itself makes the
    // component's `height: 100%` override the container's fixed height, and a
    // percentage against an auto-height parent collapses to zero.
    var root = this.root = document.createElement("div");
    root.className = "sphere-root";
    this.el.appendChild(root);
    root.style.setProperty("--segments-x", o.segments);
    root.style.setProperty("--segments-y", o.segments);
    root.style.setProperty("--overlay-blur-color", o.overlayBlurColor);
    root.style.setProperty("--tile-radius", o.imageBorderRadius);
    root.style.setProperty("--enlarge-radius", o.openedImageBorderRadius);
    root.style.setProperty("--image-filter", o.grayscale ? "grayscale(1)" : "none");

    root.innerHTML =
      '<main class="sphere-main">' +
        '<div class="stage"><div class="sphere">' + tiles + "</div></div>" +
        '<div class="overlay"></div>' +
        '<div class="overlay overlay--blur"></div>' +
        '<div class="edge-fade edge-fade--top"></div>' +
        '<div class="edge-fade edge-fade--bottom"></div>' +
        '<div class="viewer">' +
          '<div class="scrim"></div>' +
          '<div class="frame"></div>' +
        "</div>" +
      "</main>";

    this.main = root.querySelector(".sphere-main");
    this.sphereEl = root.querySelector(".sphere");
    this.viewer = root.querySelector(".viewer");
    this.scrim = root.querySelector(".scrim");
    this.frame = root.querySelector(".frame");

    this.applyTransform(0, 0);
    this.bindDrag();
    this.bindTiles();
    this.bindClose();
    this.bindResize();
  };

  function escapeAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  DomeGallery.prototype.applyTransform = function (xDeg, yDeg) {
    if (!this.sphereEl) return;
    this.sphereEl.style.transform =
      "translateZ(calc(var(--radius) * -1)) rotateX(" + xDeg + "deg) rotateY(" + yDeg + "deg)";
  };

  /* ---------- sizing: radius and the CSS variables it feeds -------------- */
  DomeGallery.prototype.bindResize = function () {
    var self = this;
    var o = this.o;
    var ro = new ResizeObserver(function (entries) {
      var cr = entries[0].contentRect;
      var w = Math.max(1, cr.width), h = Math.max(1, cr.height);
      var minDim = Math.min(w, h), maxDim = Math.max(w, h), aspect = w / h;
      var basis;
      switch (o.fitBasis) {
        case "min": basis = minDim; break;
        case "max": basis = maxDim; break;
        case "width": basis = w; break;
        case "height": basis = h; break;
        default: basis = aspect >= 1.3 ? w : minDim;
      }
      var radius = basis * o.fit;
      radius = Math.min(radius, h * 1.35);
      radius = clamp(radius, o.minRadius, o.maxRadius);
      self.lockedRadius = Math.round(radius);

      var viewerPad = Math.max(8, Math.round(minDim * o.padFactor));
      var el = self.root;
      el.style.setProperty("--radius", self.lockedRadius + "px");
      el.style.setProperty("--viewer-pad", viewerPad + "px");
      el.style.setProperty("--overlay-blur-color", o.overlayBlurColor);
      el.style.setProperty("--tile-radius", o.imageBorderRadius);
      el.style.setProperty("--enlarge-radius", o.openedImageBorderRadius);
      el.style.setProperty("--image-filter", o.grayscale ? "grayscale(1)" : "none");
      self.applyTransform(self.rotation.x, self.rotation.y);

      var enlarged = self.viewer.querySelector(".enlarge");
      if (enlarged && self.frame && self.main) {
        var frameR = self.frame.getBoundingClientRect();
        var mainR = self.main.getBoundingClientRect();
        if (o.openedImageWidth && o.openedImageHeight) {
          var temp = document.createElement("div");
          temp.style.cssText = "position:absolute;width:" + o.openedImageWidth +
            ";height:" + o.openedImageHeight + ";visibility:hidden;";
          document.body.appendChild(temp);
          var tempRect = temp.getBoundingClientRect();
          document.body.removeChild(temp);
          enlarged.style.left = (frameR.left - mainR.left + (frameR.width - tempRect.width) / 2) + "px";
          enlarged.style.top = (frameR.top - mainR.top + (frameR.height - tempRect.height) / 2) + "px";
        } else {
          enlarged.style.left = (frameR.left - mainR.left) + "px";
          enlarged.style.top = (frameR.top - mainR.top) + "px";
          enlarged.style.width = frameR.width + "px";
          enlarged.style.height = frameR.height + "px";
        }
      }
    });
    ro.observe(this.root);
    this.ro = ro;
  };

  /* ---------- drag + inertia -------------------------------------------- */
  DomeGallery.prototype.bindDrag = function () {
    var self = this;

    this._onDown = function (e) {
      if (self.focusedEl) return;
      self.stopInertia();
      self.dragging = true;
      self.moved = false;
      self.startRot = { x: self.rotation.x, y: self.rotation.y };
      self.startPos = { x: e.clientX, y: e.clientY };
      self.samples = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
    };

    this._onMove = function (e) {
      if (self.focusedEl || !self.dragging || !self.startPos) return;
      var o = self.o;
      var dxTotal = e.clientX - self.startPos.x;
      var dyTotal = e.clientY - self.startPos.y;
      if (!self.moved) {
        if (dxTotal * dxTotal + dyTotal * dyTotal > 16) self.moved = true;
      }
      var nextX = clamp(self.startRot.x - dyTotal / o.dragSensitivity,
        -o.maxVerticalRotationDeg, o.maxVerticalRotationDeg);
      var nextY = wrapAngleSigned(self.startRot.y + dxTotal / o.dragSensitivity);
      if (self.rotation.x !== nextX || self.rotation.y !== nextY) {
        self.rotation = { x: nextX, y: nextY };
        self.applyTransform(nextX, nextY);
      }
      // keep a short window of samples for the release velocity
      var now = performance.now();
      self.samples.push({ t: now, x: e.clientX, y: e.clientY });
      while (self.samples.length > 2 && now - self.samples[0].t > 110) self.samples.shift();
    };

    this._onUp = function () {
      if (!self.dragging) return;
      self.dragging = false;
      var o = self.o;
      var vx = 0, vy = 0;
      if (self.samples.length >= 2) {
        var a = self.samples[0], b = self.samples[self.samples.length - 1];
        var dt = Math.max(1, b.t - a.t);
        vx = (b.x - a.x) / dt;
        vy = (b.y - a.y) / dt;
      }
      if (Math.abs(vx) > 0.005 || Math.abs(vy) > 0.005) self.startInertia(vx, vy);
      if (self.moved) self.lastDragEndAt = performance.now();
      self.moved = false;
      self.startPos = null;
      self.samples = [];
    };

    this.main.addEventListener("pointerdown", this._onDown);
    global.addEventListener("pointermove", this._onMove, { passive: true });
    global.addEventListener("pointerup", this._onUp);
    global.addEventListener("pointercancel", this._onUp);
  };

  DomeGallery.prototype.stopInertia = function () {
    if (this.inertiaRAF) {
      global.cancelAnimationFrame(this.inertiaRAF);
      this.inertiaRAF = 0;
    }
  };

  DomeGallery.prototype.startInertia = function (vx, vy) {
    var self = this;
    var o = this.o;
    var MAX_V = 1.4;
    var vX = clamp(vx, -MAX_V, MAX_V) * 80;
    var vY = clamp(vy, -MAX_V, MAX_V) * 80;
    var frames = 0;
    var d = clamp(o.dragDampening == null ? 0.6 : o.dragDampening, 0, 1);
    var frictionMul = 0.94 + 0.055 * d;
    var stopThreshold = 0.015 - 0.01 * d;
    var maxFrames = Math.round(90 + 270 * d);
    var step = function () {
      vX *= frictionMul;
      vY *= frictionMul;
      if (Math.abs(vX) < stopThreshold && Math.abs(vY) < stopThreshold) {
        self.inertiaRAF = 0;
        return;
      }
      if (++frames > maxFrames) {
        self.inertiaRAF = 0;
        return;
      }
      var nextX = clamp(self.rotation.x - vY / 200, -o.maxVerticalRotationDeg, o.maxVerticalRotationDeg);
      var nextY = wrapAngleSigned(self.rotation.y + vX / 200);
      self.rotation = { x: nextX, y: nextY };
      self.applyTransform(nextX, nextY);
      self.inertiaRAF = global.requestAnimationFrame(step);
    };
    this.stopInertia();
    this.inertiaRAF = global.requestAnimationFrame(step);
  };

  /* ---------- tiles ------------------------------------------------------ */
  DomeGallery.prototype.bindTiles = function () {
    var self = this;
    var tiles = this.root.querySelectorAll(".item__image");

    this._onTileActivate = function (e) {
      var el = e.currentTarget;
      if (self.dragging) return;
      if (self.moved) return;
      if (performance.now() - self.lastDragEndAt < 80) return;
      if (self.opening) return;
      self.openItemFromElement(el);
    };

    this._onTileKey = function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      e.preventDefault();
      self._onTileActivate(e);
    };

    for (var i = 0; i < tiles.length; i++) {
      tiles[i].addEventListener("click", this._onTileActivate);
      tiles[i].addEventListener("keydown", this._onTileKey);
      // touch pointers do not always produce a click after a gesture
      tiles[i].addEventListener("pointerup", function (e) {
        if (e.pointerType === "touch") self._onTileActivate(e);
      });
    }
    this.tiles = tiles;
  };

  /* ---------- scroll lock ------------------------------------------------ */
  DomeGallery.prototype.lockScroll = function () {
    if (this.scrollLocked) return;
    this.scrollLocked = true;
    document.body.classList.add("dg-scroll-lock");
  };

  DomeGallery.prototype.unlockScroll = function () {
    if (!this.scrollLocked) return;
    if (this.root.getAttribute("data-enlarging") === "true") return;
    this.scrollLocked = false;
    document.body.classList.remove("dg-scroll-lock");
  };

  /* ---------- enlarge open ----------------------------------------------- */
  DomeGallery.prototype.openItemFromElement = function (el) {
    if (this.opening) return;
    var self = this;
    var o = this.o;
    this.opening = true;
    this.openStartedAt = performance.now();
    this.lockScroll();

    var parent = el.parentElement;
    this.focusedEl = el;
    el.setAttribute("data-focused", "true");

    var offsetX = getDataNumber(parent, "offsetX", 0);
    var offsetY = getDataNumber(parent, "offsetY", 0);
    var sizeX = getDataNumber(parent, "sizeX", 2);
    var sizeY = getDataNumber(parent, "sizeY", 2);
    var parentRot = computeItemBaseRotation(offsetX, offsetY, sizeX, sizeY, o.segments);
    var parentY = normalizeAngle(parentRot.rotateY);
    var globalY = normalizeAngle(this.rotation.y);
    var rotY = -(parentY + globalY) % 360;
    if (rotY < -180) rotY += 360;
    var rotX = -parentRot.rotateX - this.rotation.x;

    parent.style.setProperty("--rot-y-delta", rotY + "deg");
    parent.style.setProperty("--rot-x-delta", rotX + "deg");

    var refDiv = document.createElement("div");
    refDiv.className = "item__image item__image--reference";
    refDiv.style.opacity = "0";
    refDiv.style.transform = "rotateX(" + (-parentRot.rotateX) + "deg) rotateY(" + (-parentRot.rotateY) + "deg)";
    parent.appendChild(refDiv);
    void refDiv.offsetHeight;

    var tileR = refDiv.getBoundingClientRect();
    var mainR = this.main.getBoundingClientRect();
    var frameR = this.frame.getBoundingClientRect();

    if (!mainR || !frameR || tileR.width <= 0 || tileR.height <= 0) {
      this.opening = false;
      this.focusedEl = null;
      parent.removeChild(refDiv);
      this.unlockScroll();
      return;
    }

    this.originalTilePosition = { left: tileR.left, top: tileR.top, width: tileR.width, height: tileR.height };
    el.style.visibility = "hidden";
    el.style.zIndex = 0;

    var overlay = document.createElement("div");
    overlay.className = "enlarge";
    overlay.style.position = "absolute";
    overlay.style.left = (frameR.left - mainR.left) + "px";
    overlay.style.top = (frameR.top - mainR.top) + "px";
    overlay.style.width = frameR.width + "px";
    overlay.style.height = frameR.height + "px";
    overlay.style.opacity = "0";
    overlay.style.zIndex = "30";
    overlay.style.willChange = "transform, opacity";
    overlay.style.transformOrigin = "top left";
    overlay.style.transition = "transform " + o.enlargeTransitionMs + "ms ease, opacity " +
      o.enlargeTransitionMs + "ms ease";

    var rawSrc = parent.dataset.src || (el.querySelector("img") ? el.querySelector("img").src : "");
    var img = document.createElement("img");
    img.src = rawSrc;
    overlay.appendChild(img);
    this.viewer.appendChild(overlay);

    var tx0 = tileR.left - frameR.left;
    var ty0 = tileR.top - frameR.top;
    var sx0 = tileR.width / frameR.width;
    var sy0 = tileR.height / frameR.height;
    var validSx0 = isFinite(sx0) && sx0 > 0 ? sx0 : 1;
    var validSy0 = isFinite(sy0) && sy0 > 0 ? sy0 : 1;
    overlay.style.transform = "translate(" + tx0 + "px, " + ty0 + "px) scale(" +
      validSx0 + ", " + validSy0 + ")";

    setTimeout(function () {
      if (!overlay.parentElement) return;
      overlay.style.opacity = "1";
      overlay.style.transform = "translate(0px, 0px) scale(1, 1)";
      self.root.setAttribute("data-enlarging", "true");
    }, 16);

    if (o.openedImageWidth || o.openedImageHeight) {
      var onFirstEnd = function (ev) {
        if (ev.propertyName !== "transform") return;
        overlay.removeEventListener("transitionend", onFirstEnd);
        var prevTransition = overlay.style.transition;
        overlay.style.transition = "none";
        var tempWidth = o.openedImageWidth || frameR.width + "px";
        var tempHeight = o.openedImageHeight || frameR.height + "px";
        overlay.style.width = tempWidth;
        overlay.style.height = tempHeight;
        var newRect = overlay.getBoundingClientRect();
        overlay.style.width = frameR.width + "px";
        overlay.style.height = frameR.height + "px";
        void overlay.offsetWidth;
        overlay.style.transition = "left " + o.enlargeTransitionMs + "ms ease, top " +
          o.enlargeTransitionMs + "ms ease, width " + o.enlargeTransitionMs + "ms ease, height " +
          o.enlargeTransitionMs + "ms ease";
        var centeredLeft = frameR.left - mainR.left + (frameR.width - newRect.width) / 2;
        var centeredTop = frameR.top - mainR.top + (frameR.height - newRect.height) / 2;
        global.requestAnimationFrame(function () {
          overlay.style.left = centeredLeft + "px";
          overlay.style.top = centeredTop + "px";
          overlay.style.width = tempWidth;
          overlay.style.height = tempHeight;
        });
        var cleanupSecond = function () {
          overlay.removeEventListener("transitionend", cleanupSecond);
          overlay.style.transition = prevTransition;
        };
        overlay.addEventListener("transitionend", cleanupSecond, { once: true });
      };
      overlay.addEventListener("transitionend", onFirstEnd);
    }
  };

  /* ---------- enlarge close ---------------------------------------------- */
  DomeGallery.prototype.bindClose = function () {
    var self = this;
    this._close = function () {
      var o = self.o;
      if (performance.now() - self.openStartedAt < 250) return;
      var el = self.focusedEl;
      if (!el) return;
      var parent = el.parentElement;
      var overlay = self.viewer.querySelector(".enlarge");
      if (!overlay) return;
      var refDiv = parent.querySelector(".item__image--reference");
      var originalPos = self.originalTilePosition;

      if (!originalPos) {
        overlay.remove();
        if (refDiv) refDiv.remove();
        parent.style.setProperty("--rot-y-delta", "0deg");
        parent.style.setProperty("--rot-x-delta", "0deg");
        el.style.visibility = "";
        el.style.zIndex = 0;
        self.focusedEl = null;
        self.root.removeAttribute("data-enlarging");
        self.opening = false;
        self.unlockScroll();
        return;
      }

      var currentRect = overlay.getBoundingClientRect();
      var rootRect = self.root.getBoundingClientRect();
      var originalPosRelativeToRoot = {
        left: originalPos.left - rootRect.left, top: originalPos.top - rootRect.top,
        width: originalPos.width, height: originalPos.height
      };
      var overlayRelativeToRoot = {
        left: currentRect.left - rootRect.left, top: currentRect.top - rootRect.top,
        width: currentRect.width, height: currentRect.height
      };

      var animating = document.createElement("div");
      animating.className = "enlarge-closing";
      animating.style.cssText = "position:absolute;left:" + overlayRelativeToRoot.left + "px;top:" +
        overlayRelativeToRoot.top + "px;width:" + overlayRelativeToRoot.width + "px;height:" +
        overlayRelativeToRoot.height + "px;z-index:9999;border-radius: var(--enlarge-radius, 32px);" +
        "overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:all " + o.enlargeTransitionMs +
        "ms ease-out;pointer-events:none;margin:0;transform:none;";
      var originalImg = overlay.querySelector("img");
      if (originalImg) {
        var clone = originalImg.cloneNode();
        clone.style.cssText = "width:100%;height:100%;object-fit:cover;";
        animating.appendChild(clone);
      }
      overlay.remove();
      self.root.appendChild(animating);
      void animating.getBoundingClientRect();
      global.requestAnimationFrame(function () {
        animating.style.left = originalPosRelativeToRoot.left + "px";
        animating.style.top = originalPosRelativeToRoot.top + "px";
        animating.style.width = originalPosRelativeToRoot.width + "px";
        animating.style.height = originalPosRelativeToRoot.height + "px";
        animating.style.opacity = "0";
      });

      var cleanup = function () {
        animating.remove();
        self.originalTilePosition = null;
        if (refDiv) refDiv.remove();
        parent.style.transition = "none";
        el.style.transition = "none";
        parent.style.setProperty("--rot-y-delta", "0deg");
        parent.style.setProperty("--rot-x-delta", "0deg");
        global.requestAnimationFrame(function () {
          el.style.visibility = "";
          el.style.opacity = "0";
          el.style.zIndex = 0;
          self.focusedEl = null;
          self.root.removeAttribute("data-enlarging");
          global.requestAnimationFrame(function () {
            parent.style.transition = "";
            el.style.transition = "opacity 300ms ease-out";
            global.requestAnimationFrame(function () {
              el.style.opacity = "1";
              setTimeout(function () {
                el.style.transition = "";
                el.style.opacity = "";
                self.opening = false;
                if (!self.dragging && self.root.getAttribute("data-enlarging") !== "true") {
                  document.body.classList.remove("dg-scroll-lock");
                  // The original removes the class here without clearing its own
                  // flag, and lockScroll() early-returns on that flag — so the
                  // scroll lock only ever engaged on the FIRST open. Reset it.
                  self.scrollLocked = false;
                }
              }, 300);
            });
          });
        });
      };
      animating.addEventListener("transitionend", cleanup, { once: true });
    };

    this._onKey = function (e) { if (e.key === "Escape") self._close(); };
    this.scrim.addEventListener("click", this._close);
    global.addEventListener("keydown", this._onKey);
  };

  DomeGallery.prototype.destroy = function () {
    this.stopInertia();
    if (this.ro) this.ro.disconnect();
    this.main.removeEventListener("pointerdown", this._onDown);
    global.removeEventListener("pointermove", this._onMove);
    global.removeEventListener("pointerup", this._onUp);
    global.removeEventListener("pointercancel", this._onUp);
    global.removeEventListener("keydown", this._onKey);
    if (this.scrim) this.scrim.removeEventListener("click", this._close);
    for (var i = 0; i < (this.tiles || []).length; i++) {
      this.tiles[i].removeEventListener("click", this._onTileActivate);
      this.tiles[i].removeEventListener("keydown", this._onTileKey);
    }
    document.body.classList.remove("dg-scroll-lock");
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  };

  /* =========================================================
     Site wiring
     ========================================================= */
  global.DomeGallery = DomeGallery;
  DomeGallery.DEFAULTS = DEFAULTS;

  /* Every work in the portfolio grid, in the same order, so the dome and the
     grid tell the same story. Swap an entry to change what appears here. */
  DomeGallery.SITE_IMAGES = [
    { src: "assets/images/portfolio-01-alley.svg", alt: "The Rhythm of Life in the Alley — photograph" },
    { src: "assets/images/portfolio-02-bench.svg", alt: "Warm Moments on a Park Bench — photograph" },
    { src: "assets/images/portfolio-03-711.svg", alt: "A 7-Eleven on a Street Corner — photograph" },
    { src: "assets/images/portfolio-04-livestream.svg", alt: "Live Stream Backstage — production" },
    { src: "assets/images/portfolio-05-video.svg", alt: "Editing & Motion Design — Premiere Pro" },
    { src: "assets/images/video-01-poster.jpg", alt: "Edit Showreel — video" },
    { src: "assets/images/portfolio-06-vfx.svg", alt: "Visual Effects & Compositing — After Effects" },
    { src: "assets/images/vfx-01-poster.jpg", alt: "Effects Showreel — VFX" },
    { src: "assets/images/retouch/alien.jpg", alt: "外星人 · Alien — Photoshop retouch" },
    { src: "assets/images/retouch/desert-whale.jpg", alt: "沙漠鲸鱼 · Desert Whale — composite" },
    { src: "assets/images/retouch/vegetable-traffic-light.jpg", alt: "蔬菜红绿灯 — composite" },
    { src: "assets/images/retouch/banana-duck.jpg", alt: "香蕉鸭 · Banana Duck — composite" },
    { src: "assets/images/retouch/photo-01.jpg", alt: "Photo Edit · 01" },
    { src: "assets/images/retouch/photo-02.jpg", alt: "Photo Edit · 02" },
    { src: "assets/images/retouch/photo-03.jpg", alt: "Photo Edit · 03" },
    { src: "assets/images/retouch/landscape-retouch.jpg", alt: "Landscape Retouch" },
    { src: "assets/images/portfolio-08-adobeai.svg", alt: "Generative Imagery — Adobe Firefly" },
    { src: "assets/images/motion-01-poster.jpg", alt: "Motion Graphic" },
    { src: "assets/images/motion-02-poster.jpg", alt: "Motion Showreel" },
    { src: "assets/images/motion-03-poster.jpg", alt: "Logo Animation" },
    { src: "assets/images/motion-04-poster.jpg", alt: "Motion Graphic" },
    { src: "assets/images/motion-05-poster.jpg", alt: "Motion Graphic" },
    { src: "assets/images/motion-06-poster.jpg", alt: "Motion Graphic" }
  ];

  function num(el, name, fallback) {
    var v = parseFloat(el.getAttribute(name));
    return isFinite(v) ? v : fallback;
  }

  DomeGallery.init = function (el, options) {
    if (!el) return null;
    if (el.__domeGallery) return el.__domeGallery;
    var inst = new DomeGallery(el, options || {});
    el.__domeGallery = inst;
    return inst;
  };

  /* The documented props, readable from data-* on the container. Only the ones
     a site actually needs to vary are parsed; the rest stay at the component's
     own defaults. */
  DomeGallery.autoInit = function () {
    var nodes = document.querySelectorAll(DEFAULTS.selector);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var raw = el.getAttribute("data-images");
      var images = (raw === "site" || !raw) ? DomeGallery.SITE_IMAGES : JSON.parse(raw);
      var inst = DomeGallery.init(el, {
        images: images,
        fit: num(el, "data-fit", DEFAULTS.fit),
        minRadius: num(el, "data-min-radius", DEFAULTS.minRadius),
        maxRadius: num(el, "data-max-radius", DEFAULTS.maxRadius),
        maxVerticalRotationDeg: num(el, "data-max-vertical-rotation", DEFAULTS.maxVerticalRotationDeg),
        segments: num(el, "data-segments", Math.round(DEFAULTS.segments)),
        dragDampening: num(el, "data-drag-dampening", DEFAULTS.dragDampening),
        dragSensitivity: num(el, "data-drag-sensitivity", DEFAULTS.dragSensitivity),
        padFactor: num(el, "data-pad-factor", DEFAULTS.padFactor),
        enlargeTransitionMs: num(el, "data-enlarge-transition", DEFAULTS.enlargeTransitionMs),
        fitBasis: el.getAttribute("data-fit-basis") || DEFAULTS.fitBasis,
        overlayBlurColor: el.getAttribute("data-overlay-blur-color") || DEFAULTS.overlayBlurColor,
        grayscale: el.getAttribute("data-grayscale") === "true",
        openedImageWidth: el.getAttribute("data-opened-width") || DEFAULTS.openedImageWidth,
        openedImageHeight: el.getAttribute("data-opened-height") || DEFAULTS.openedImageHeight,
        imageBorderRadius: el.getAttribute("data-tile-radius") || DEFAULTS.imageBorderRadius,
        openedImageBorderRadius: el.getAttribute("data-enlarge-radius") || DEFAULTS.openedImageBorderRadius
      });
      if (inst) out.push(inst);
    }
    return out;
  };

  function boot() {
    try {
      DomeGallery.autoInit();
    } catch (err) {
      console.error("[dome-gallery] boot failed", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
