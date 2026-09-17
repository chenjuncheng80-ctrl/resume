/* Smoke test: the Selected Work grid renders from data/works.js (script tag,
   works on file://) with data/works.json as the fetch fallback, and admin.html
   publishes edits to the repo.
   Run: node tools/smoke_works.mjs */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire("C:/Users/chenj/.workbuddy/binaries/node/workspace/package.json");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  → " + extra : "")); }
};

const res = (body, status = 200) => {
  const txt = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status < 400, status, statusText: "OK", text: () => Promise.resolve(txt), json: () => Promise.resolve(JSON.parse(txt)) };
};

function shell(window) {
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
  window.URL.createObjectURL = () => "blob:mock";
  window.confirm = () => true;
  const store = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => {}
    }
  });
}
const quiet = () => {
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  vc.on("error", () => {});
  return vc;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const opened = (window) => new Promise((r) => window.addEventListener("load", r));

/* Shared assertions for a fully booted index.html. */
async function assertGrid(dom, works, label) {
  const { window } = dom;
  await opened(window);
  await wait(150);
  const d = window.document;

  const cards = d.querySelectorAll("#workGrid .card");
  const n = works.works.length;
  check(label + ": all " + n + " works rendered (got " + cards.length + ")", cards.length === n);
  check(label + ": grid is not empty markup", d.getElementById("workGrid").children.length === n);
  check(label + ": first card keeps its title", d.querySelector("#workGrid .card__title").textContent === works.works[0].title);
  check(label + ": last card is the newest one", d.querySelectorAll("#workGrid .card__title")[n - 1].textContent === works.works[n - 1].title);
  check(label + ": card keeps data-category", d.querySelector("#workGrid .card").getAttribute("data-category") === works.works[0].category);
  check(label + ": images stay lazy", d.querySelector("#workGrid img.card__img").getAttribute("loading") === "lazy");
  const vids = d.querySelectorAll("#workGrid video.card__img");
  check(label + ": video cards render as <video> (" + vids.length + ")", vids.length === works.works.filter((w) => w.type === "video").length);
  check(label + ": poster preserved", vids[0].getAttribute("poster") === works.works.filter((w) => w.type === "video")[0].poster);

  const filters = d.querySelectorAll("#workFilters .filter");
  check(label + ": filters rebuilt from categories (" + filters.length + ")", filters.length === works.categories.length + 1);
  check(label + ": All is active by default", filters[0].classList.contains("is-active"));

  const videoBtn = d.querySelector('#workFilters .filter[data-filter="video"]');
  videoBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const shown = Array.prototype.filter.call(d.querySelectorAll("#workGrid .card"), (c) => !c.classList.contains("is-hidden"));
  const expectVideo = works.works.filter((w) => w.category === "video").length;
  check(label + ": video filter shows only video works (" + shown.length + "/" + expectVideo + ")", shown.length === expectVideo);
  check(label + ": clicked filter becomes active", videoBtn.classList.contains("is-active"));
  d.querySelector('#workFilters .filter[data-filter="all"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  check(label + ": All restores every card", d.querySelectorAll("#workGrid .card:not(.is-hidden)").length === n);

  d.querySelector('.lang-switch__opt[data-lang="zh"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(150);
  check(label + ": grid translated to Chinese after switch", /[一-鿿]/.test(d.querySelector("#workGrid").textContent));
  check(label + ": still " + n + " cards after switching", d.querySelectorAll("#workGrid .card").length === n);
  d.querySelector('.lang-switch__opt[data-lang="en"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(150);
  check(label + ": back to English", d.querySelector("#workGrid .card__title").textContent === works.works[0].title);

  dom.window.close();
}

/* ============================ SITE ============================ */
async function testSiteFromDisk() {
  console.log("\n— index.html, opened from disk (no fetch at all) —");
  const works = JSON.parse(read("data/works.json"));
  let fetched = 0;
  const dom = await JSDOM.fromFile(path.join(ROOT, "index.html"), {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    virtualConsole: quiet(),
    beforeParse(window) {
      shell(window);
      // A file:// page cannot fetch local files — make that failure loud so the
      // test proves the grid came from the <script> payload instead.
      window.fetch = (url) => { fetched++; return Promise.reject(new TypeError("Failed to fetch")); };
    }
  });
  check("index.html loads data/works.js with a script tag", /<script src="data\/works\.js">/.test(read("index.html")));
  await assertGrid(dom, works, "disk");
  check("no network read was needed", fetched === 0, fetched + " fetch call(s)");
}

async function testSiteFetchFallback() {
  console.log("\n— index.html, data/works.js missing (fetch fallback) —");
  const works = JSON.parse(read("data/works.json"));
  const html = read("index.html").replace(/\s*<script src="data\/works\.js"><\/script>/, "");
  const dom = new JSDOM(html, {
    url: pathToFileURL(path.join(ROOT, "index.html")).href,
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    virtualConsole: quiet(),
    beforeParse(window) {
      shell(window);
      window.fetch = (url) => {
        const key = String(url).split("?")[0];
        if (key === "data/works.json") return Promise.resolve(res(works));
        return Promise.resolve(res({ error: key }, 404));
      };
    }
  });
  await assertGrid(dom, works, "fetch");
}

/* ============================ ADMIN ============================ */
async function testAdmin() {
  console.log("\n— admin.html (publish flow) —");
  const files = { "data/works.json": read("data/works.json"), "data/files.json": read("data/files.json") };
  const baseWorks = JSON.parse(files["data/works.json"]).works.length;
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
  const calls = [];
  const blobStore = {};
  const treePaths = {};

  const dom = await JSDOM.fromFile(path.join(ROOT, "admin.html"), {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    virtualConsole: quiet(),
    beforeParse(window) {
      shell(window);
      window.localStorage.setItem("ccs-portfolio-token", "ghp_test");
      window.fetch = (url, init) => {
        const u = String(url);
        const m = u.match(/^https:\/\/api\.github\.com(.*)$/);
        if (!m) {
          const key = u.split("?")[0];
          return Promise.resolve(res(files[key] ? JSON.parse(files[key]) : { error: key }, files[key] ? 200 : 404));
        }
        const p = m[1].split("?")[0];
        calls.push({ method: (init && init.method) || "GET", path: p, body: init && init.body });
        if (p === "/repos/chenjuncheng80-ctrl/resume") return Promise.resolve(res({ full_name: "chenjuncheng80-ctrl/resume" }));
        if (/^\/repos\/.*\/contents\/data\//.test(p)) {
          const name = p.split("/contents/")[1];
          return Promise.resolve(res({ content: b64(files[name]), sha: "sha-" + name, path: name }));
        }
        if (p === "/repos/chenjuncheng80-ctrl/resume/git/ref/heads/main") return Promise.resolve(res({ object: { sha: "parentsha" } }));
        if (p === "/repos/chenjuncheng80-ctrl/resume/git/commits/parentsha") return Promise.resolve(res({ tree: { sha: "basetree" } }));
        if (p.endsWith("/git/blobs")) {
          const body = JSON.parse(init.body);
          const sha = "blob-" + calls.length;
          blobStore[sha] = body;
          return Promise.resolve(res({ sha }));
        }
        if (p.endsWith("/git/trees")) {
          JSON.parse(init.body).tree.forEach((e) => {
            treePaths[e.path] = e.sha;
            if (e.sha === null) { delete files[e.path]; return; }
            const b = blobStore[e.sha];
            if (b && /^data\//.test(e.path)) files[e.path] = Buffer.from(b.content, "base64").toString();
          });
          return Promise.resolve(res({ sha: "newtree" }));
        }
        if (p.endsWith("/git/commits")) return Promise.resolve(res({ sha: "newcommitsha" }));
        if (p.startsWith("/repos/chenjuncheng80-ctrl/resume/git/refs/")) return Promise.resolve(res({ sha: "newcommitsha" }));
        return Promise.resolve(res({ message: "unmocked " + p }, 404));
      };
    }
  });
  const { window } = dom;
  await opened(window);
  await wait(150);
  const d = window.document;

  check("connected", d.getElementById("app").hidden === false);
  check("repo defaults to resume", d.getElementById("repoLabel").textContent.indexOf("chenjuncheng80-ctrl/resume") >= 0);
  check(baseWorks + " work rows", d.querySelectorAll("#workRows .row").length === baseWorks);
  check("resume state shown", d.getElementById("resumeState").textContent.indexOf("assets/Chan-Chun-Shing-Resume.pdf") === 0);
  check("no profile tab", !d.querySelector('[data-tab="profile"]'));
  check("file notice stays hidden on http(s)", d.getElementById("fileNotice").hidden === true);

  // add a work
  d.getElementById("btnAddWork").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  d.querySelector('[data-w="title"]').value = "New Piece";
  const file = new window.File(["x"], "Shot.JPG", { type: "image/jpeg" });
  const input = d.getElementById("mediaPick");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(80);
  d.getElementById("btnSaveWork").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(40);
  check("work added (" + (baseWorks + 1) + " rows)", d.querySelectorAll("#workRows .row").length === baseWorks + 1);

  // replace the resume
  const pdf = new window.File(["%PDF-1.4"], "Chan-Chun-Shing-Resume.pdf", { type: "application/pdf" });
  const rinput = d.getElementById("resumePick");
  Object.defineProperty(rinput, "files", { value: [pdf], configurable: true });
  rinput.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(80);

  const before = calls.length;
  d.getElementById("btnPublish").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(250);

  const tree = calls.slice(before).find((c) => c.path.endsWith("/git/trees"));
  const paths = tree ? JSON.parse(tree.body).tree.map((t) => t.path) : [];
  check("one commit holds upload + resume + 3 json", paths.length === 5, paths.join(", "));
  check("resume overwritten in place", paths.indexOf("assets/Chan-Chun-Shing-Resume.pdf") >= 0, paths.join(", "));
  check("new image uploaded", paths.some((p) => p === "assets/works/Shot.jpg"), paths.join(", "));
  check("works.json included", paths.indexOf("data/works.json") >= 0);
  check("works.js included", paths.indexOf("data/works.js") >= 0);
  check("files.json included", paths.indexOf("data/files.json") >= 0);

  const textOf = (p) => {
    const b = blobStore[treePaths[p]];
    return b ? Buffer.from(b.content, "base64").toString() : "";
  };
  const published = JSON.parse(textOf("data/works.json"));
  check("published " + (baseWorks + 1) + " works", published.works.length === baseWorks + 1, "got " + published.works.length);
  check("new work points at the upload", published.works[baseWorks].src === "assets/works/Shot.jpg", published.works[baseWorks].src);

  const jsText = textOf("data/works.js");
  const marker = "window.PORTFOLIO_WORKS = ";
  const embedded = JSON.parse(jsText.slice(jsText.indexOf(marker) + marker.length).replace(/;\s*$/, ""));
  check("works.js mirrors works.json exactly", JSON.stringify(embedded) === JSON.stringify(published));
  check("no raw </script> in the payload", jsText.indexOf("</script") === -1);
  check("no raw < in the payload", !/<(?!\/\*)/.test(jsText.slice(jsText.indexOf(marker))));

  dom.window.close();
}

/* ============================ DATA FILES ============================ */
function testDataFiles() {
  console.log("\n— data/works.js vs data/works.json —");
  const jsonText = read("data/works.json");
  const jsText = read("data/works.js");
  const marker = "window.PORTFOLIO_WORKS = ";
  check("works.js carries the payload", jsText.indexOf(marker) > 0);
  const embedded = JSON.parse(jsText.slice(jsText.indexOf(marker) + marker.length).replace(/;\s*$/, ""));
  check("committed works.js matches works.json", JSON.stringify(embedded) === JSON.stringify(JSON.parse(jsonText)),
    "run: python tools/build_works_js.py");
}

await testSiteFromDisk();
await testSiteFetchFallback();
await testAdmin();
await testDataFiles();
console.log("\n" + (fail ? "FAILURES: " + fail : "ALL CHECKS PASSED") + "  (" + pass + " passed)");
process.exit(fail ? 1 : 0);
