/* =========================================================
   Chan Chun Shing — Portfolio & Resume
   Interactions: scroll-driven animations, nav state, mobile menu
   ========================================================= */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (!reduceMotion && "IntersectionObserver" in window) document.documentElement.classList.add("reveal-ready");

  /* ----- Footer year ----- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ----- Nav scrolled state + dark-section inversion ----- */
  var nav = document.querySelector(".nav");
  var darkSections = document.querySelectorAll(".section--dark");
  var footer = document.querySelector(".footer");
  var hero = document.querySelector(".hero");

  function isNavOverDark() {
    if (!nav) return false;
    var viewportCenter = window.scrollY + nav.offsetHeight / 2;
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
    document.body.classList.toggle("nav-light", isNavOverDark());
    document.body.classList.toggle("is-past-hero", hero && hero.getBoundingClientRect().bottom <= nav.offsetHeight);
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
    var menuQuery = window.matchMedia("(max-width: 900px)");
    var menuBackground = document.querySelectorAll(".hero, main, .footer, .nav__brand, .skip-link");
    function setMenu(open, restoreFocus) {
      links.classList.toggle("is-open", open);
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      document.documentElement.classList.toggle("menu-open", open);
      links.toggleAttribute("inert", menuQuery.matches && !open);
      menuBackground.forEach(function (el) { el.toggleAttribute("inert", open); });
      if (restoreFocus) toggle.focus();
    }
    toggle.addEventListener("click", function () {
      var open = !links.classList.contains("is-open");
      setMenu(open);
      if (open) links.querySelector("a").focus();
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        if (links.classList.contains("is-open")) {
          setMenu(false);
          var section = document.querySelector(a.getAttribute("href"));
          if (section) {
            section.setAttribute("tabindex", "-1");
            section.focus({ preventScroll: true });
          }
        }
      });
    });
    document.addEventListener("keydown", function (e) {
      if (!links.classList.contains("is-open")) return;
      if (e.key === "Escape") { e.preventDefault(); setMenu(false, true); }
      if (e.key === "Tab") {
        var focusable = Array.prototype.slice.call(links.querySelectorAll("a"))
          .concat(Array.prototype.slice.call(document.querySelectorAll(".lang-switch__opt")), [toggle]);
        var index = focusable.indexOf(document.activeElement);
        e.preventDefault();
        focusable[(index + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
      }
    });
    if (menuQuery.addEventListener) menuQuery.addEventListener("change", function () { setMenu(false); });
    setMenu(false);
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
