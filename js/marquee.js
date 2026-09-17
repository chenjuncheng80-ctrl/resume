/* =========================================================
   Hero marquee
   ---------------------------------------------------------
   The CSS loop slides the track by -50%, which only reads as
   a seamless loop if (a) every copy of the word list is the
   same width and (b) the track is at least twice the
   viewport — otherwise wide screens show empty paper on the
   right. This clones the first .hero__marquee-group until both
   hold, keeps the copy count even (so -50% always lands on a
   word boundary), and re-syncs the clones whenever the
   language switcher rewrites the copy.
   ========================================================= */
(function () {
  "use strict";

  var track = document.querySelector(".hero__marquee-track");
  if (!track) return;

  var first = track.querySelector(".hero__marquee-group");
  if (!first) return;

  var MAX_COPIES = 24;
  var SPEED = 28;          // px per second — keeps the pace constant however
                           // many copies the viewport needs

  function sync() {
    var html = first.innerHTML;
    Array.prototype.forEach.call(track.children, function (group, i) {
      if (i > 0 && group.innerHTML !== html) group.innerHTML = html;
    });
  }

  function fit() {
    var width = first.getBoundingClientRect().width;
    if (!width) return;

    // The animation shifts by half the track, so the track must be at least
    // two viewports wide for the strip to stay covered at every frame.
    var need = Math.ceil((window.innerWidth * 2) / width);
    if (need % 2) need += 1;                       // even → -50% stays seamless
    need = Math.max(2, Math.min(need, MAX_COPIES));

    while (track.children.length < need) {
      track.appendChild(first.cloneNode(true));
    }
    while (track.children.length > need) {
      track.removeChild(track.lastElementChild);
    }
    sync();

    // One lap is half the track, so tie the duration to the width: the strip
    // then crawls at the same speed on a phone and on a 4K display.
    track.style.animationDuration = (width * need) / 2 / SPEED + "s";
  }

  var t = null;
  window.addEventListener("resize", function () {
    clearTimeout(t);
    t = setTimeout(fit, 200);
  });

  // Web fonts land after first paint and change the measured width.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fit).catch(function () { /* ignore */ });
  }

  // The switcher rewrites group 1; the clones follow it.
  document.addEventListener("i18n:change", sync);

  fit();
})();
