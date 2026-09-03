/* =========================================================
   Chan Chun Shing — Portfolio & Resume
   Interactions: scroll-driven animations, nav state, mobile menu
   ========================================================= */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

  /* ----- Footer year ----- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ----- Nav scrolled state + dark-section inversion ----- */
  var nav = document.querySelector(".nav");
  var darkSections = document.querySelectorAll(".section--dark");
  var footer = document.querySelector(".footer");

  function isNavOverDark() {
    if (!nav) return false;
    var viewportCenter = window.scrollY + window.innerHeight / 2;
    var i, section, secTop, secBottom;
    for (i = 0; i < darkSections.length; i++) {
      section = darkSections[i];
      secTop = section.offsetTop;
      secBottom = secTop + section.offsetHeight;
      if (viewportCenter >= secTop && viewportCenter <= secBottom) return true;
    }
    if (footer && viewportCenter >= footer.offsetTop) return true;
    return false;
  }

  function updateNavState() {
    if (!nav) return;
    nav.classList.toggle("is-scrolled", window.scrollY > 24);
    nav.classList.toggle("is-on-dark", isNavOverDark());
  }

  /* ----- Scroll progress bar ----- */
  var progressBar = document.getElementById("scrollProgress");
  function updateProgressBar() {
    if (!progressBar) return;
    var scrollTop = window.scrollY;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var progress = docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 0;
    progressBar.style.width = progress + "%";
  }

  /* ----- Hero elements ----- */
  var heroSection = document.querySelector(".hero");
  var heroContent = document.querySelector(".hero__content");
  var heroSide = document.querySelector(".hero__side");
  var heroEyebrow = document.querySelector(".hero__eyebrow");
  var heroLead = document.querySelector(".hero__lead");
  var heroActions = document.querySelector(".hero__actions");
  var heroFadeEls = [heroEyebrow, heroLead, heroActions].filter(Boolean);

  /* ----- Hero parallax (excludes heroName so the name never fades) ----- */
  function updateHeroParallax(customScrollY) {
    if (reduceMotion || !heroSection) return;
    var scrollY = customScrollY !== undefined ? customScrollY : window.scrollY;
    var heroHeight = heroSection.offsetHeight;
    var progress = heroHeight > 0 ? Math.min(1, scrollY / heroHeight) : 0;
    var opacity = Math.max(0, 1 - progress * 2.4);

    heroFadeEls.forEach(function (el) {
      el.style.transform = "translateY(" + (scrollY * 0.25).toFixed(1) + "px)";
      el.style.opacity = String(opacity);
    });
    if (heroSide) {
      heroSide.style.transform = "translateY(" + (scrollY * 0.12).toFixed(1) + "px)";
      heroSide.style.opacity = String(opacity);
    }
  }

  /* ----- Hero name flight to About (scroll-driven, no locking) ----- */
  var heroName = document.getElementById("heroName");
  var aboutName = document.getElementById("aboutName");
  var aboutBig = aboutName ? aboutName.closest(".about__big") : null;
  var heroCn = document.querySelector(".hero__cn");
  var heroLines = heroName ? heroName.querySelectorAll(".line") : [];
  var heroLine1 = heroLines[0] || null;
  var heroLine2 = heroLines[1] || null;
  var heroLine1Inner = heroLine1 ? heroLine1.querySelector("span") : null;
  var heroLine2Inner = heroLine2 ? heroLine2.querySelector("span") : null;
  var flightBase = null;
  var flightTarget = null;
  var flightDistance = 1;
  var MERGE_GAP = 0.32; /* word gap between the two lines once merged onto one line */

  /* Measure with transforms cleared so earlier frames don't pollute the rects */
  function measureFlight() {
    if (!heroName || !aboutName || !heroSection) return;

    var prevT = heroName.style.transform;
    var prevL2 = heroLine2 ? heroLine2.style.transform : "";
    heroName.style.transform = "";
    if (heroLine2) heroLine2.style.transform = "";

    var r = heroName.getBoundingClientRect();
    flightBase = {
      top: r.top + window.scrollY,
      left: r.left + window.scrollX,
      width: r.width,
      height: r.height
    };

    /* how far line 2 ("Shing") must travel to sit beside line 1 ("Chan Chun")
       on a single merged line, and the natural width of that merged line */
    if (heroLine1Inner && heroLine2Inner) {
      var r1 = heroLine1Inner.getBoundingClientRect();
      var r2 = heroLine2Inner.getBoundingClientRect();
      var fs = parseFloat(getComputedStyle(heroName).fontSize) || 16;
      flightBase.mergeX = (r1.right - r2.left) + fs * MERGE_GAP;
      flightBase.mergeY = -(r2.top - r1.top);
      /* merged single-line width = "Chan Chun" + word gap + "Shing" */
      flightBase.width = r1.width + fs * MERGE_GAP + r2.width;
    }

    heroName.style.transform = prevT;
    if (heroLine2) heroLine2.style.transform = prevL2;

    var aboutRect = aboutName.getBoundingClientRect();
    var aboutSection = document.getElementById("about");
    var aboutTop = aboutSection ? aboutSection.offsetTop : window.innerHeight;
    flightTarget = {
      top: aboutRect.top + window.scrollY,
      left: aboutRect.left + window.scrollX,
      width: aboutRect.width,
      height: aboutRect.height
    };
    /* the flight spans from the very top until About reaches the top */
    flightDistance = Math.max(1, aboutTop);
  }

  function updateHeroNameFlight() {
    if (reduceMotion || isTouch || !heroName || !aboutName) {
      if (aboutName) aboutName.classList.add("is-visible");
      if (aboutBig) aboutBig.classList.add("is-visible");
      return;
    }
    if (!flightBase || !flightTarget) return;

    /* progress comes from the real scroll position - nothing is locked */
    var t = window.scrollY / flightDistance;
    t = Math.max(0, Math.min(1, t));

    if (t <= 0.001) {
      heroName.style.transform = "";
      heroName.style.opacity = "";
      heroName.style.visibility = "";
      heroName.classList.remove("is-body-font");
      if (heroLine2) heroLine2.style.transform = "";
      if (heroCn) heroCn.style.opacity = "";
      aboutName.classList.remove("is-visible");
      if (aboutBig) aboutBig.classList.remove("is-visible");
      return;
    }

    var ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    /* top-left anchored positions (transform-origin: top left) in the viewport */
    var baseTop = flightBase.top - window.scrollY;
    var baseLeft = flightBase.left - window.scrollX;
    var tgtTop = flightTarget.top - window.scrollY;
    var tgtLeft = flightTarget.left - window.scrollX;

    var dx = (tgtLeft - baseLeft) * ease;
    var dy = (tgtTop - baseTop) * ease;
    /* scale from 1 (hero size) down to aboutName size, interpolated by ease */
    var s = (flightBase.width > 0 && flightTarget.width > 0) ? flightTarget.width / flightBase.width : 1;
    var scale = 1 + (s - 1) * ease;

    heroName.style.transform =
      "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px) scale(" + scale.toFixed(4) + ")";
    heroName.style.opacity = "1";
    heroName.style.visibility = "";

    /* merge line 2 ("Shing 陳俊丞") up beside line 1 to form one line */
    if (heroLine2 && flightBase.mergeX !== undefined) {
      heroLine2.style.transform =
        "translate(" + (flightBase.mergeX * ease).toFixed(1) + "px," +
        (flightBase.mergeY * ease).toFixed(1) + "px)";
    }

    /* fade the Chinese name out as it flies (About only shows the English) */
    if (heroCn) heroCn.style.opacity = String(Math.max(0, 1 - t * 1.7));

    /* swap the display serif for the body font partway through the flight */
    if (t >= 0.5) heroName.classList.add("is-body-font");
    else heroName.classList.remove("is-body-font");

    /* hand off to the real About name at the very end */
    if (t >= 0.985) {
      aboutName.classList.add("is-visible");
      if (aboutBig) aboutBig.classList.add("is-visible");
      heroName.style.visibility = "hidden";
    } else {
      aboutName.classList.remove("is-visible");
      if (aboutBig) aboutBig.classList.remove("is-visible");
    }
  }

  /* ----- Flight wiring (scroll-driven, NO scroll-locking) ----- */
  function initFlight() {
    measureFlight();
    updateHeroNameFlight();
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { measureFlight(); updateHeroNameFlight(); });
  }
  window.addEventListener("resize", function () { measureFlight(); updateHeroNameFlight(); }, { passive: true });
  window.addEventListener("load", function () { measureFlight(); updateHeroNameFlight(); });
  initFlight();

  /* ----- Stat counter animation ----- */
  var statNums = document.querySelectorAll(".stat__num");
  var counterDone = false;
  function runCounters() {
    if (counterDone || reduceMotion) return;
    var aboutSection = document.getElementById("about");
    if (!aboutSection) return;
    var rect = aboutSection.getBoundingClientRect();
    if (rect.top > window.innerHeight * 0.65) return;
    counterDone = true;

    statNums.forEach(function (el) {
      var targetText = el.textContent.trim();
      if (targetText === "\u221e" || targetText.indexOf("\u2013") !== -1) {
        el.style.opacity = "0";
        el.style.transition = "opacity 0.6s ease";
        setTimeout(function () { el.style.opacity = "1"; }, 200);
        return;
      }
      var target = parseInt(targetText, 10);
      if (isNaN(target)) return;
      var duration = 1400;
      var start = null;
      function step(timestamp) {
        if (!start) start = timestamp;
        var p = Math.min((timestamp - start) / duration, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased);
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = targetText;
      }
      requestAnimationFrame(step);
    });
  }

  /* ----- Skills: one-shot language dots animation on enter ----- */
  var skillsSection = document.getElementById("skills");
  var langData = [];
  document.querySelectorAll(".lang").forEach(function (lang) {
    var totalOn = lang.querySelectorAll(".lang__dots i.on").length;
    lang.querySelectorAll(".lang__dots i").forEach(function (dot) { dot.classList.remove("on"); });
    langData.push({ el: lang, total: totalOn });
  });

  function playSkillsAnimation() {
    if (!skillsSection || skillsSection.classList.contains("is-animated")) return;
    skillsSection.classList.add("is-animated");
    langData.forEach(function (item, langIdx) {
      var dots = item.el.querySelectorAll(".lang__dots i");
      dots.forEach(function (dot, i) {
        if (i < item.total) {
          setTimeout(function () { dot.classList.add("on"); }, 500 + langIdx * 220 + i * 110);
        }
      });
    });
  }

  if (skillsSection && "IntersectionObserver" in window && !reduceMotion) {
    var skillsIO = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            playSkillsAnimation();
            skillsIO.unobserve(skillsSection);
          }
        });
      },
      { threshold: 0.35 }
    );
    skillsIO.observe(skillsSection);
  } else {
    playSkillsAnimation();
  }

  /* ----- Timeline: scroll-driven draw ----- */
  var timeline = document.querySelector(".timeline");
  var timelineItems = timeline ? timeline.querySelectorAll(".timeline__item") : [];
  function updateTimeline() {
    if (!timeline) return;
    if (reduceMotion) {
      timeline.style.setProperty("--draw", "1");
      timelineItems.forEach(function (item) {
        var dot = item.querySelector(".timeline__dot");
        if (dot) dot.style.transform = "scale(1)";
      });
      return;
    }
    var rect = timeline.getBoundingClientRect();
    var vh = window.innerHeight;
    var sectionCenter = rect.top + rect.height / 2;
    var progress = Math.max(0, Math.min(1, (vh - sectionCenter) / vh));
    timeline.style.setProperty("--draw", String(progress));

    timelineItems.forEach(function (item, i) {
      var dot = item.querySelector(".timeline__dot");
      if (!dot) return;
      var itemP = Math.max(0, Math.min(1, (progress * timelineItems.length - i) * 1.8));
      dot.style.transform = "scale(" + itemP + ")";
    });
  }

  /* ----- Unified scroll handler with rAF throttle ----- */
  var ticking = false;
  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(function () {
        updateNavState();
        updateProgressBar();
        updateHeroParallax();
        updateHeroNameFlight();
        runCounters();
        updateTimeline();
        ticking = false;
      });
      ticking = true;
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  /* ----- Mobile menu ----- */
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("is-open");
        toggle.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      });
    });
  }

  /* ----- Scroll reveal (stagger via data attribute) ----- */
  var reveals = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    reveals.forEach(function (el) {
      var siblings = Array.prototype.slice.call(el.parentNode.children).filter(function (c) {
        return c.classList.contains("reveal");
      });
      el.style.setProperty("--i", String(siblings.indexOf(el)));
    });

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ----- Active nav link highlight ----- */
  var sections = document.querySelectorAll("main section[id]");
  var navLinks = document.querySelectorAll(".nav__link");
  if ("IntersectionObserver" in window && sections.length) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var id = entry.target.getAttribute("id");
          navLinks.forEach(function (link) {
            var href = link.getAttribute("href");
            link.classList.toggle("is-active", href === "#" + id);
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ----- Portfolio category filter ----- */
  var filters = document.querySelectorAll(".filter");
  var cards = document.querySelectorAll(".grid .card");
  var currentFilter = "all";

  filters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var f = btn.getAttribute("data-filter");
      if (f === currentFilter) return;
      currentFilter = f;

      filters.forEach(function (b) {
        var active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", String(active));
      });

      var visibleIndex = 0;
      cards.forEach(function (card) {
        var cats = (card.getAttribute("data-category") || "").split(" ");
        var show = f === "all" || cats.indexOf(f) !== -1;

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
    });
  });

  /* ----- Lazy video playback (play only when in viewport) ----- */
  var videos = document.querySelectorAll(".card video");
  if ("IntersectionObserver" in window && videos.length) {
    var vio = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var v = entry.target;
          if (entry.isIntersecting) {
            v.play().catch(function () {});
          } else {
            v.pause();
          }
        });
      },
      { threshold: 0.2 }
    );
    videos.forEach(function (v) { vio.observe(v); });
  }

  /* ----- Card 3D tilt (desktop only) ----- */
  if (!isTouch && !reduceMotion) {
    cards.forEach(function (card) {
      card.addEventListener("mousemove", function (e) {
        var rect = card.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        var cx = rect.width / 2;
        var cy = rect.height / 2;
        var rotX = ((y - cy) / cy) * -7;
        var rotY = ((x - cx) / cx) * 7;
        card.style.transform =
          "perspective(1000px) rotateX(" + rotX.toFixed(2) + "deg) rotateY(" + rotY.toFixed(2) + "deg) scale(1.03)";
      });
      card.addEventListener("mouseleave", function () {
        card.style.transform = "";
      });
    });
  }

  /* ----- Magnetic buttons (desktop only) ----- */
  if (!isTouch && !reduceMotion) {
    var magneticEls = document.querySelectorAll(".btn, .nav__link--cta");
    magneticEls.forEach(function (el) {
      el.addEventListener("mousemove", function (e) {
        var rect = el.getBoundingClientRect();
        var x = e.clientX - rect.left - rect.width / 2;
        var y = e.clientY - rect.top - rect.height / 2;
        el.style.transform = "translate(" + (x * 0.18).toFixed(1) + "px, " + (y * 0.18).toFixed(1) + "px)";
      });
      el.addEventListener("mouseleave", function () {
        el.style.transform = "";
      });
    });
  }
})();
