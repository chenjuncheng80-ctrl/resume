/* =========================================================
   Built-in EN ⇄ 中文 switcher
   ---------------------------------------------------------
   No build step, no data-attributes needed on existing copy:
   TEXT is keyed by the English sentence exactly as it reads
   in the markup (runs of whitespace collapsed to one space).
   apply() walks the DOM depth-first; the first element whose
   text matches a key is swapped wholesale for its Chinese
   counterpart (markup included) and is not descended into.
   Switching back restores the English captured on first hit,
   so the markup can never drift.
   ========================================================= */
(function () {
  "use strict";

  var STORAGE = "ccs-lang";

  /* ---------- copy: matched by English text ---------- */
  var TEXT = {
    /* nav + hero */
    "Digital Resume": "數碼履歷",
    "About": "關於",
    "Experience": "經驗",
    "Skills": "技能",
    "Portfolio": "作品集",
    "Contact": "聯絡",
    "HI ! I am": "你好！我是",
    "Digital Media & Photography / Sha Tin, Hong Kong": "數碼媒體與攝影 / 香港 沙田",
    "View Portfolio": "查看作品集",
    "Download Resume": "下載履歷",
    "Education": "教育",
    "HKDI · Digital Media": "HKDI · 數碼媒體",
    "Available": "可到崗",
    "From 25 May 2026": "2026 年 5 月 25 日起",

    /* marquee + skills tags + portfolio categories */
    "Photography": "攝影",
    "Street Documentary": "街頭紀實",
    "Video Editing": "影片剪輯",
    "Motion Design": "動態設計",
    "Live Production": "現場製作",

    /* about */
    "I'm Chan Chun Shing, a Digital Media student at the Hong Kong Design Institute (HKDI) with a documentary eye for street photography.":
      "我是<strong>陳俊丞</strong>，香港知專設計學院（HKDI）數碼媒體系學生，以紀實的眼光拍攝街頭。",
    "My work sits at the intersection of technical craft and everyday observation. I shoot the small, unguarded scenes — a shaded alley, a park bench, a corner convenience store — and turn them into quiet records of how a city lives.":
      "我的作品介於技術與日常觀察之間。我拍下那些細小、不設防的場景——有蔭的小巷、公園長椅、轉角的便利店——並把它們變成城市如何生活的安靜紀錄。",
    "Alongside photography, I produce and edit video with the Adobe Suite, build interactive prototypes in Unity, and have hands-on experience supporting live broadcast production. I'm driven by storytelling in every medium.":
      "除了攝影，我亦用 Adobe 系列製作與剪輯影片、在 Unity 內製作互動原型，並有支援直播製作的實戰經驗。說故事是我在各種媒材背後的動力。",
    "Languages spoken": "使用的語言",
    "Years in service & production": "服務與製作年資",
    "Curiosity for the street": "對街頭的好奇",

    /* experience */
    "Mar 2026 · 4 days": "2026 年 3 月 · 4 天",
    "Hong Kong Design Institute": "香港知專設計學院",
    "Live Stream Backstage Helper": "直播後台助理",
    "Supported the production team during live sessions — scene coordination, timing cues, and real-time troubleshooting of minor technical issues.":
      "在直播期間支援製作團隊——場景協調、時間提示，以及即時排除小型技術問題。",
    "Moderated live chat and relayed key audience questions to the host.":
      "管理直播聊天室，並把觀眾的重要提問轉達給主持人。",
    "Assisted with post-stream wrap-up: equipment dismantling, data logging, and studio cleanup.":
      "協助直播後的收尾工作：拆除器材、記錄資料、清理廠房。",
    "Cashier & Service Crew": "收銀及服務員",
    "Handled daily transactions accurately and assisted customers at the counter.":
      "準確處理日常交易，並在櫃檯協助顧客。",
    "Delivered quality front-of-house service — order taking and dining-area management.":
      "提供優質的樓面服務——落單與用餐區管理。",
    "Kept a clean, organised workspace to support smooth daily operations.":
      "保持工作環境整潔有序，讓日常運作順暢。",
    "School Media Control Crew": "校園媒體控制組",
    "Ran the stage backstage for school events — operating lighting, sound, and video projection.":
      "負責校園活動的後台運作——操作燈光、音響與影像投影。",
    "Provided real-time audio-visual support during performances, handling cues and transitions.":
      "在演出期間提供即時視聽支援，處理提示與轉場。",
    "Set up, tested, and packed down AV equipment before and after each event.":
      "每次活動前後負責架設、測試與收拾視聽器材。",

    /* education */
    "2025 – Present": "2025 – 至今",
    "Higher Diploma in Digital Media": "數碼媒體高級文憑",
    "Hong Kong Design Institute (HKDI)": "香港知專設計學院（HKDI）",
    "Secondary School": "中學",

    /* skills */
    "Skills & Languages": "技能與語言",
    "Tools": "工具",
    "Adobe Suite — Photoshop, Premiere Pro, After Effects":
      "Adobe 系列 — Photoshop、Premiere Pro、After Effects",
    "Microsoft Office — Word, Excel, PowerPoint":
      "Microsoft Office — Word、Excel、PowerPoint",
    "Languages": "語言",
    "Mandarin": "普通話",
    "Native": "母語",
    "Cantonese": "廣東話",
    "Fluent": "流利",
    "English": "英文",
    "Conversational": "日常會話",
    "Interests": "興趣",
    "Gaming": "遊戲",
    "Film": "電影",

    /* portfolio */
    "Selected Work": "精選作品",
    "All": "全部",
    "VFX": "視覺特效",
    "Motion Graphic": "動態圖形",
    "Retouching": "修圖",
    "The Rhythm of Life in the Alley": "巷弄裡的生活節奏",
    "Warm Moments on a Park Bench": "公園長椅上的溫暖時刻",
    "A 7-Eleven on a Street Corner": "街角的 7-Eleven",
    "Live Stream Backstage": "直播後台",
    "Editing & Motion Design": "剪輯與動態設計",
    "Edit Showreel": "剪輯作品集錦",
    "Visual Effects & Compositing": "視覺特效與合成",
    "Effects Showreel": "特效作品集錦",
    "Landscape Retouch": "風景修圖",
    "Generative Imagery": "生成式影像",
    "Motion Showreel": "動態作品集錦",
    "Logo Animation": "商標動畫",
    "Adobe Suite": "Adobe 系列",

    /* contact */
    "Get in touch": "聯絡我",
    "Have a project, a shoot, or a role in mind?": "有項目、拍攝或職位想談談？",
    "I'm available from 25 May 2026. Let's make something worth looking at twice.":
      "我由 <strong>2026 年 5 月 25 日</strong>起可以到崗。一起做點值得再看一眼的東西。",
    "Email": "電郵",
    "Phone": "電話",
    "Location": "地點",
    "Sha Tin, New Territories, Hong Kong": "香港 新界 沙田",

    /* footer */
    "Designed in black & white — like the city I photograph.":
      "以黑白設計——就像我拍攝的這座城市。"
  };

  /* ---------- copy: reached by key ----------
     Used where the English sentence is split by a dynamic node
     (the footer year) and so cannot be matched as plain text. */
  var KEYS = {
    "footer.rights": "Chan Chun Shing（陳俊丞）。版權所有。"
  };

  /* ---------- document head ---------- */
  var DOC = {
    title: {
      en: "Chan Chun Shing — Digital Media & Photography",
      zh: "陳俊丞 — 數碼媒體與攝影"
    },
    desc: {
      en: "Portfolio and resume of Chan Chun Shing (陳俊丞), Digital Media student at Hong Kong Design Institute and Hong Kong street photographer.",
      zh: "陳俊丞（Chan Chun Shing）的作品集與履歷：香港知專設計學院數碼媒體系學生、香港街頭攝影師。"
    }
  };

  /* ---------- aria-labels / other attributes ---------- */
  var ATTRS = [
    { sel: ".lang-switch", attr: "aria-label", en: "Language", zh: "語言" },
    { sel: ".nav__brand", attr: "aria-label", en: "Home", zh: "首頁" },
    { sel: "#navLinks", attr: "aria-label", en: "Primary", zh: "主選單" },
    { sel: ".nav__toggle", attr: "aria-label", en: "Toggle menu", zh: "切換選單" },
    { sel: ".filters", attr: "aria-label", en: "Portfolio categories", zh: "作品分類" }
  ];

  /* ---------- engine ---------- */
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CANVAS: 1, SVG: 1, VIDEO: 1, IMG: 1 };
  var records = [];   // { el, html, key } — English source of truth
  var current = "en";

  function norm(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function recall(el) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].el === el) return records[i];
    }
    return null;
  }

  function remember(el, key) {
    var rec = recall(el);
    if (!rec) {
      rec = { el: el, html: el.innerHTML, key: key };
      records.push(rec);
    }
    return rec;
  }

  function walk(el, lang) {
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      if (SKIP_TAGS[node.tagName]) continue;
      if (node.classList && node.classList.contains("lang-switch")) continue;

      var attrKey = node.getAttribute("data-i18n");
      var zh = null;
      var key = attrKey;

      if (attrKey) {
        zh = KEYS[attrKey];
      } else {
        var rec = recall(node);
        key = rec ? rec.key : norm(node.textContent);
        if (!key) { walk(node, lang); continue; }
        zh = TEXT[key];
      }

      if (zh == null) { walk(node, lang); continue; }

      var stored = remember(node, key);
      node.innerHTML = lang === "zh" ? zh : stored.html;
    }
  }

  function applyHead(lang) {
    var title = document.getElementsByTagName("title")[0];
    if (title) title.textContent = lang === "zh" ? DOC.title.zh : DOC.title.en;
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", lang === "zh" ? DOC.desc.zh : DOC.desc.en);
  }

  function applyAttrs(lang) {
    ATTRS.forEach(function (item) {
      var el = document.querySelector(item.sel);
      if (el) el.setAttribute(item.attr, lang === "zh" ? item.zh : item.en);
    });
  }

  function syncButtons(lang) {
    var opts = document.querySelectorAll(".lang-switch__opt");
    Array.prototype.forEach.call(opts, function (b) {
      var on = b.getAttribute("data-lang") === lang;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function setLang(lang, persist) {
    current = lang === "zh" ? "zh" : "en";
    document.documentElement.lang = current === "zh" ? "zh-Hant" : "en";
    document.documentElement.setAttribute("data-lang", current);

    applyHead(current);
    applyAttrs(current);
    walk(document.body, current);
    syncButtons(current);

    // Anything that mirrors translated copy (the marquee clones) listens for this.
    try {
      document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: current } }));
    } catch (e) { /* old browser */ }

    if (persist !== false) {
      try { localStorage.setItem(STORAGE, current); } catch (e) { /* private mode */ }
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    var saved = "en";
    try { saved = localStorage.getItem(STORAGE) || "en"; } catch (e) { /* private mode */ }

    // Run once on boot either way: it also seeds the buttons and aria-labels.
    setLang(saved === "zh" ? "zh" : "en", false);

    var sw = document.querySelector(".lang-switch");
    if (sw) {
      sw.addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest(".lang-switch__opt") : null;
        if (!btn) return;
        var lang = btn.getAttribute("data-lang");
        if (lang === current) return;
        setLang(lang);
      });
    }

    /* Mobile menu opens a light full-screen panel: the switch has to invert
       with it, otherwise it disappears into the background. */
    var links = document.getElementById("navLinks");
    if (sw && links && window.MutationObserver) {
      var sync = function () {
        sw.classList.toggle("is-on-light", links.classList.contains("is-open"));
      };
      new MutationObserver(sync).observe(links, { attributes: true, attributeFilter: ["class"] });
      sync();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
