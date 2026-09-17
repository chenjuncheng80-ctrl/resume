/* Smoke test: load the site in jsdom, click the language switch, verify the copy
   flips and that switching back restores the English exactly.

   The page is opened as a local file, which is also how it reads its data:
   window.PORTFOLIO_WORKS from data/works.js. jsdom has no fetch and no
   matchMedia, so those get stubbed for the scripts that would otherwise throw.
   Run: node tools/smoke_i18n.mjs */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire("C:/Users/chenj/.workbuddy/binaries/node/workspace/package.json");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const vc = new VirtualConsole();
vc.on("jsdomError", () => {});

const dom = await JSDOM.fromFile(path.join(ROOT, "index.html"), {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.fetch = (url) => {
      const rel = decodeURIComponent(String(url).split("?")[0]);
      try { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"))) }); }
      catch (e) { return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error("no " + rel)) }); }
    };
  }
});
const { window } = dom;
await new Promise((r) => setTimeout(r, 1500));
const doc = window.document;

const probe = () => ({
  link1: doc.querySelector(".nav__link").textContent,
  heroSub: doc.querySelector(".hero__sub").textContent.replace(/\s+/g, " ").trim(),
  about: doc.querySelector(".about__big").textContent.replace(/\s+/g, " ").trim().slice(0, 30),
  contact: doc.querySelector(".contact__big").textContent,
  role: doc.querySelector(".timeline__role").textContent,
  card: doc.querySelector(".card__title").textContent,
  cat: doc.querySelector(".card__cat").textContent,
  filter: doc.querySelector(".filter").textContent,
  footer: doc.querySelector('[data-i18n="footer.rights"]').textContent,
  title: doc.title,
  lang: doc.documentElement.lang,
  active: doc.querySelector(".lang-switch__opt.is-active").dataset.lang,
});

const en = probe();
doc.querySelector('.lang-switch__opt[data-lang="zh"]').click();
await new Promise((r) => setTimeout(r, 200));
const zh = probe();
doc.querySelector('.lang-switch__opt[data-lang="en"]').click();
await new Promise((r) => setTimeout(r, 200));
const back = probe();

const expect = {
  EN_ACTIVE: en.active === "en",
  EN_LANG: en.lang === "en",
  ZH_ACTIVE: zh.active === "zh",
  ZH_LANG: zh.lang === "zh-Hant",
  ZH_NAV: zh.link1 === "關於",
  ZH_HERO: zh.heroSub.includes("香港"),
  ZH_ABOUT: zh.about.includes("陳俊丞"),
  ZH_CONTACT: zh.contact.includes("項目"),
  ZH_ROLE: zh.role === "直播後台助理",
  ZH_CARD: zh.card === "巷弄裡的生活節奏",
  ZH_CAT: zh.cat === "攝影",
  ZH_FILTER: zh.filter === "全部",
  ZH_FOOTER: zh.footer.includes("版權所有"),
  ZH_TITLE: zh.title.includes("陳俊丞"),
  RESTORE_NAV: back.link1 === en.link1,
  RESTORE_ABOUT: back.about === en.about,
  RESTORE_CARD: back.card === en.card,
  RESTORE_FOOTER: back.footer === en.footer,
  RESTORE_TITLE: back.title === en.title,
};

console.log("EN  :", JSON.stringify(en).slice(0, 300));
console.log("ZH  :", JSON.stringify(zh).slice(0, 300));
let bad = 0;
for (const [k, v] of Object.entries(expect)) {
  if (!v) { bad++; console.log("FAIL", k); }
}
console.log(bad === 0 ? "ALL CHECKS PASSED" : bad + " CHECK(S) FAILED");
dom.window.close();
process.exit(bad === 0 ? 0 : 1);
