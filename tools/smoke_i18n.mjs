/* Smoke test: load the site in jsdom, click the language switch, verify that
   the copy flips and that switching back restores the English exactly.
   Run: NODE_PATH=<workspace>/node_modules node tools/smoke_i18n.mjs */
import { JSDOM } from "file:///C:/Users/chenj/.workbuddy/binaries/node/workspace/node_modules/jsdom/lib/api.js";

const URL = "http://127.0.0.1:8080/index.html";
const dom = await JSDOM.fromURL(URL, {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
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

console.log("EN  :", JSON.stringify(en, null, 0).slice(0, 400));
console.log("ZH  :", JSON.stringify(zh, null, 0).slice(0, 400));
let bad = 0;
for (const [k, v] of Object.entries(expect)) {
  if (!v) { bad++; console.log("FAIL", k); }
}
console.log(bad === 0 ? "ALL CHECKS PASSED" : bad + " CHECK(S) FAILED");
dom.window.close();
process.exit(bad === 0 ? 0 : 1);
