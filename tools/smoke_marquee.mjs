/* Marquee smoke test: jsdom has no layout, so .hero__marquee-group is stubbed
   to a fixed width and window.innerWidth to a desktop viewport. Verifies that
   the track clones to an even number of copies wide enough to cover two
   viewports, that every copy stays identical, and that the clones follow the
   language switcher. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire("C:/Users/chenj/.workbuddy/binaries/node/workspace/package.json");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const vc = new VirtualConsole();
vc.on("jsdomError", () => {});

const GROUP_WIDTH = 700;
const VIEWPORT = 1920;
const SPEED = 28;

// Opened as a local file, like the real workflows — no dev server required.
const dom = await JSDOM.fromFile(path.join(ROOT, "index.html"), {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    Object.defineProperty(window, "innerWidth", { value: VIEWPORT, configurable: true });
    window.Element.prototype.getBoundingClientRect = function () {
      const w = this.classList && this.classList.contains("hero__marquee-group") ? GROUP_WIDTH : 0;
      return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0 };
    };
  },
});
const { window } = dom;
await new Promise((r) => setTimeout(r, 1200));
const doc = window.document;
const track = doc.querySelector(".hero__marquee-track");
const groups = () => Array.from(track.children);
const texts = () => groups().map((g) => g.textContent.replace(/\s+/g, " ").trim());

const n = track.children.length;
const expected = Math.max(2, Math.ceil((VIEWPORT * 2) / GROUP_WIDTH));
const expectedEven = expected % 2 ? expected + 1 : expected;
const duration = parseFloat(track.style.animationDuration);

const checks = {
  EVEN_COPIES: n % 2 === 0,
  COVERS_TWO_VIEWPORTS: n * GROUP_WIDTH >= VIEWPORT * 2,
  EXPECTED_COUNT: n === expectedEven,
  IDENTICAL_COPIES: new Set(texts()).size === 1,
  HAS_WORDS: /Photography/.test(texts()[0]),
  DURATION_SANE: Math.abs(duration - (n * GROUP_WIDTH) / 2 / SPEED) < 0.01,
};

// flip to Chinese: the clones must follow group 1
doc.querySelector('.lang-switch__opt[data-lang="zh"]').click();
await new Promise((r) => setTimeout(r, 200));
const zhTexts = texts();
checks.ZH_SYNCED = new Set(zhTexts).size === 1 && /攝影/.test(zhTexts[0]);
doc.querySelector('.lang-switch__opt[data-lang="en"]').click();
await new Promise((r) => setTimeout(r, 200));
checks.EN_SYNCED = new Set(texts()).size === 1 && /Photography/.test(texts()[0]);

console.log({ copies: n, expectedEven, durationSeconds: duration, en: texts()[0].slice(0, 40) });
let bad = 0;
for (const [k, v] of Object.entries(checks)) if (!v) { bad++; console.log("FAIL", k); }
console.log(bad === 0 ? "MARQUEE CHECKS PASSED" : bad + " CHECK(S) FAILED");
dom.window.close();
process.exit(bad === 0 ? 0 : 1);
