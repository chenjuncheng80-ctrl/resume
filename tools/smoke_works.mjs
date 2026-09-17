/* Smoke test: how the Selected Work grid gets its data, and admin publishing.

   Three page origins are exercised, because each reads a different file:
     - file://   → window.PORTFOLIO_WORKS from data/works.js (fetch is blocked)
     - https://  → fetch data/works.json live, cache-busted
     - https://  → fetch fails → falls back to the works.js payload

   Run: node tools/smoke_works.mjs */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire("C:/Users/chenj/.workbuddy/binaries/node/workspace/package.json");
const { JSDOM, VirtualConsole, requestInterceptor } = require("jsdom");

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

function shell(window, fetchImpl) {
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
  if (fetchImpl) window.fetch = fetchImpl;
}
const quiet = () => {
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  vc.on("error", () => {});
  return vc;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const opened = (window) => new Promise((r) => window.addEventListener("load", r));

/* Serves https://example.org/<anything> out of this repo, so the page can run
   under an http origin without touching the network for its own assets.
   jsdom 30 dropped ResourceLoader in favour of undici interceptors. */
const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml"
};

function repoHostedResources() {
  return {
    interceptors: [
      requestInterceptor((request) => {
        const m = String(request.url).match(/^https:\/\/example\.org\/([^?#]*)$/);
        const miss = new Response("", { status: 404 }); // blocks fonts.googleapis.com too
        if (!m) return miss;
        const rel = decodeURIComponent(m[1]);
        let body;
        try { body = fs.readFileSync(path.join(ROOT, rel)); } catch (e) { return miss; }
        const ext = path.extname(rel);
        return new Response(body, { headers: { "Content-Type": MIME[ext] || "application/octet-stream" } });
      })
    ]
  };
}

/* Assertions shared by every origin: cards, filters, language switching. */
async function assertGrid(dom, works, label) {
  const { window } = dom;
  await opened(window);
  await wait(150);
  const d = window.document;
  const n = works.works.length;

  const cards = d.querySelectorAll("#workGrid .card");
  check(label + ": all " + n + " works rendered (got " + cards.length + ")", cards.length === n);
  check(label + ": first card keeps its title", d.querySelector("#workGrid .card__title").textContent === works.works[0].title);
  if (n > 1) {
    check(label + ": last card matches the data (not the stale file)",
      d.querySelectorAll("#workGrid .card__title")[n - 1].textContent === works.works[n - 1].title);
  }
  check(label + ": card keeps data-category", d.querySelector("#workGrid .card").getAttribute("data-category") === works.works[0].category);
  check(label + ": images stay lazy", d.querySelector("#workGrid img.card__img").getAttribute("loading") === "lazy");
  const vids = d.querySelectorAll("#workGrid video.card__img");
  check(label + ": video cards render as <video> (" + vids.length + ")", vids.length === works.works.filter((w) => w.type === "video").length);

  const filters = d.querySelectorAll("#workFilters .filter");
  check(label + ": filters rebuilt from categories (" + filters.length + ")", filters.length === works.categories.length + 1);
  check(label + ": All is active by default", filters[0].classList.contains("is-active"));

  const photoBtn = d.querySelector('#workFilters .filter[data-filter="photography"]');
  photoBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const shown = Array.prototype.filter.call(d.querySelectorAll("#workGrid .card"), (c) => !c.classList.contains("is-hidden"));
  const expectPhoto = works.works.filter((w) => w.category === "photography").length;
  check(label + ": photography filter narrows the grid (" + shown.length + "/" + expectPhoto + ")", shown.length === expectPhoto);
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
}

/* ====================== file:// ====================== */
async function testFromDisk() {
  console.log("\n— index.html opened from disk (file://) —");
  const works = JSON.parse(read("data/works.json"));
  let fetched = 0;
  const dom = await JSDOM.fromFile(path.join(ROOT, "index.html"), {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    virtualConsole: quiet(),
    beforeParse(window) {
      shell(window, (url) => { fetched++; return Promise.reject(new TypeError("Failed to fetch")); });
    }
  });
  check("index.html loads data/works.js with a script tag", /<script src="data\/works\.js">/.test(read("index.html")));
  await assertGrid(dom, works, "disk");
  check("no network read was needed", fetched === 0, fetched + " fetch call(s)");

  const d = dom.window.document;
  const hint = d.getElementById("localHint");
  check("local-snapshot hint is shown", hint.hidden === false);
  check("hint points at the live site", d.getElementById("localHintText").textContent.indexOf("resume-coral-iota.vercel.app") > 0);
  check("hint says how to sync", d.getElementById("localHintText").textContent.indexOf("sync.bat") > 0);
  d.getElementById("localHintClose").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  check("hint dismisses on click", hint.hidden === true);
  dom.window.close();
}

/* ====================== https, fetch happy path ====================== */
async function testServedOverHttp() {
  console.log("\n— index.html served over https (reads works.json live) —");
  const disk = JSON.parse(read("data/works.json"));
  // Deliberately different from data/works.js: proving the page rendered this
  // payload means it really fetched the JSON and not the script file.
  const served = { categories: disk.categories, works: disk.works.slice(0, 5) };
  const calls = [];
  const dom = new JSDOM(read("index.html"), {
    url: "https://example.org/index.html",
    runScripts: "dangerously", resources: repoHostedResources(), pretendToBeVisual: true,
    virtualConsole: quiet(),
    beforeParse(window) {
      shell(window, (url) => {
        calls.push(String(url));
        return Promise.resolve(res(served));
      });
    }
  });
  await assertGrid(dom, served, "live");
  check("the json was read live", calls.some((u) => u.indexOf("data/works.json") === 0), calls.join(", "));
  check("with a cache-buster", calls.some((u) => /^data\/works\.json\?t=\d+$/.test(u)), calls.join(", "));
  check("only one data request", calls.length === 1, calls.join(", "));
  check("no local-snapshot hint when hosted", dom.window.document.getElementById("localHint").hidden === true);
  dom.window.close();
}

/* ====================== https, fetch broken ====================== */
async function testHttpFetchFails() {
  console.log("\n— index.html served over https, json unreachable —");
  const works = JSON.parse(read("data/works.json"));
  const dom = new JSDOM(read("index.html"), {
    url: "https://example.org/index.html",
    runScripts: "dangerously", resources: repoHostedResources(), pretendToBeVisual: true,
    virtualConsole: quiet(),
    beforeParse(window) {
      shell(window, () => Promise.reject(new TypeError("Failed to fetch")));
    }
  });
  await assertGrid(dom, works, "fallback");
  dom.window.close();
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
  check("file notice stays hidden when served", d.getElementById("fileNotice").hidden === true);

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

  // delete the work again — the admin must push that removal, not just hide it
  const delBtn = d.querySelector("#workRows .row:last-child .btn--danger");
  check("every work row has a Delete button", !!delBtn);
  delBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(40);
  check("work deleted again (" + baseWorks + " rows)", d.querySelectorAll("#workRows .row").length === baseWorks);

  const publishOnce = async () => {
    const mark = calls.length;
    d.getElementById("btnPublish").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await wait(300);
    const tree = calls.slice(mark).find((c) => c.path.endsWith("/git/trees"));
    if (!tree) return { paths: [], removed: [], tree: null };
    const entries = JSON.parse(tree.body).tree;
    return { paths: entries.map((e) => e.path), removed: entries.filter((e) => e.sha === null).map((e) => e.path), tree };
  };
  const isShot = (p) => /^assets\/works\/Shot(-\d+)?\.jpg$/.test(p);

  // replace the resume — always goes through, whatever happens to the works
  const pdf = new window.File(["%PDF-1.4"], "Chan-Chun-Shing-Resume.pdf", { type: "application/pdf" });
  const rinput = d.getElementById("resumePick");
  Object.defineProperty(rinput, "files", { value: [pdf], configurable: true });
  rinput.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(80);

  // Scenario 1: the work was deleted before its media ever shipped.
  const a = await publishOnce();
  check("commit holds the resume + 3 json", a.paths.length === 4, a.paths.join(", "));
  check("resume overwritten in place", a.paths.indexOf("assets/Chan-Chun-Shing-Resume.pdf") >= 0, a.paths.join(", "));
  check("orphan media dropped — never uploaded at all", !a.paths.some(isShot), a.paths.join(", "));
  check("each path appears once", new Set(a.paths).size === a.paths.length, a.paths.join(", "));
  check("works.json included", a.paths.indexOf("data/works.json") >= 0);
  check("works.js included", a.paths.indexOf("data/works.js") >= 0);
  check("files.json included", a.paths.indexOf("data/files.json") >= 0);

  // Scenario 2: a work that stays in the list must still ship its media.
  d.getElementById("btnAddWork").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  d.querySelector('[data-w="title"]').value = "Kept Piece";
  const keep = new window.File(["y"], "Keep.JPG", { type: "image/jpeg" });
  const kinput = d.getElementById("mediaPick");
  Object.defineProperty(kinput, "files", { value: [keep], configurable: true });
  kinput.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(80);
  d.getElementById("btnSaveWork").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(40);
  const b = await publishOnce();
  check("kept work: its media is uploaded", b.paths.some((p) => /^assets\/works\/Keep\.jpg$/.test(p)), b.paths.join(", "));
  check("kept work: no stray delete entry", b.removed.length === 0, b.removed.join(", "));

  const textOf = (p) => {
    const b = blobStore[treePaths[p]];
    return b ? Buffer.from(b.content, "base64").toString() : "";
  };
  const published = JSON.parse(textOf("data/works.json"));
  check("published work list keeps additions (" + (baseWorks + 1) + ")", published.works.length === baseWorks + 1, "got " + published.works.length);
  check("deleted work stays gone from the payload", !published.works.some((w) => w.title === "New Piece"));
  check("kept work made it into the payload", published.works.some((w) => w.title === "Kept Piece"));

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

await testFromDisk();
await testServedOverHttp();
await testHttpFetchFails();
await testAdmin();
await testDataFiles();
console.log("\n" + (fail ? "FAILURES: " + fail : "ALL CHECKS PASSED") + "  (" + pass + " passed)");
process.exit(fail ? 1 : 0);
