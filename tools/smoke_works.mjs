/* Smoke test: the Selected Work grid now renders from data/works.json,
   and admin.html publishes edits to the repo.
   Run: node tools/smoke_works.mjs */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

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

/* ============================ SITE ============================ */
async function testSite() {
  console.log("\n— index.html (work grid from JSON) —");
  const works = JSON.parse(read("data/works.json"));
  const dom = await JSDOM.fromFile(path.join(ROOT, "index.html"), {
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
  const { window } = dom;
  await new Promise((r) => window.addEventListener("load", r));
  await wait(150);
  const d = window.document;

  const cards = d.querySelectorAll("#workGrid .card");
  check("all 23 works rendered (got " + cards.length + ")", cards.length === works.works.length);
  check("grid is no longer empty markup", d.getElementById("workGrid").children.length === works.works.length);
  check("first card keeps its title", d.querySelector("#workGrid .card__title").textContent === works.works[0].title);
  check("card keeps data-category", d.querySelector("#workGrid .card").getAttribute("data-category") === works.works[0].category);
  check("images stay lazy", d.querySelector("#workGrid img.card__img").getAttribute("loading") === "lazy");
  const vids = d.querySelectorAll("#workGrid video.card__img");
  check("video cards render as <video> (" + vids.length + ")", vids.length === works.works.filter((w) => w.type === "video").length);
  check("poster preserved", vids[0].getAttribute("poster") === works.works.filter((w) => w.type === "video")[0].poster);

  const filters = d.querySelectorAll("#workFilters .filter");
  check("filters rebuilt from categories (" + filters.length + ")", filters.length === works.categories.length + 1);
  check("All is active by default", filters[0].classList.contains("is-active"));

  const videoBtn = d.querySelector('#workFilters .filter[data-filter="video"]');
  videoBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const shown = Array.prototype.filter.call(d.querySelectorAll("#workGrid .card"), (c) => !c.classList.contains("is-hidden"));
  const expectVideo = works.works.filter((w) => w.category === "video").length;
  check("video filter shows only video works (" + shown.length + "/" + expectVideo + ")", shown.length === expectVideo);
  check("clicked filter becomes active", videoBtn.classList.contains("is-active"));
  d.querySelector('#workFilters .filter[data-filter="all"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  check("All restores every card", d.querySelectorAll("#workGrid .card:not(.is-hidden)").length === works.works.length);

  // Chinese: freshly rendered cards must be translated too
  d.querySelector('.lang-switch__opt[data-lang="zh"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(150);
  const zhText = d.querySelector("#workGrid").textContent;
  check("grid translated to Chinese after switch", /[一-鿿]/.test(zhText), zhText.slice(0, 60));
  check("still 23 cards after switching", d.querySelectorAll("#workGrid .card").length === works.works.length);
  d.querySelector('.lang-switch__opt[data-lang="en"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(150);
  check("back to English", d.querySelector("#workGrid .card__title").textContent === works.works[0].title);

  dom.window.close();
}

/* ============================ ADMIN ============================ */
async function testAdmin() {
  console.log("\n— admin.html (publish flow) —");
  const files = { "data/works.json": read("data/works.json"), "data/files.json": read("data/files.json") };
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
  const calls = [];
  const blobStore = {};

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
  await new Promise((r) => window.addEventListener("load", r));
  await wait(150);
  const d = window.document;

  check("connected", d.getElementById("app").hidden === false);
  check("repo defaults to resume", d.getElementById("repoLabel").textContent.indexOf("chenjuncheng80-ctrl/resume") >= 0);
  check("23 work rows", d.querySelectorAll("#workRows .row").length === 23);
  check("resume state shown", d.getElementById("resumeState").textContent.indexOf("assets/Chan-Chun-Shing-Resume.pdf") === 0);
  check("no profile tab", !d.querySelector('[data-tab="profile"]'));

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
  check("work added (24 rows)", d.querySelectorAll("#workRows .row").length === 24);

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
  check("upload + resume + 2 json in one commit", paths.length === 4, paths.join(", "));
  check("resume overwritten in place", paths.indexOf("assets/Chan-Chun-Shing-Resume.pdf") >= 0, paths.join(", "));
  check("new image uploaded", paths.some((p) => p === "assets/works/Shot.jpg"), paths.join(", "));
  check("works.json included", paths.indexOf("data/works.json") >= 0);
  check("files.json included", paths.indexOf("data/files.json") >= 0);

  const blob = calls.slice(before).filter((c) => c.path.endsWith("/git/blobs"))
    .map((c) => JSON.parse(c.body))
    .find((b) => Buffer.from(b.content, "base64").toString().indexOf('"works"') >= 0);
  const published = JSON.parse(Buffer.from(blob.content, "base64").toString());
  check("published 24 works", published.works.length === 24, "got " + published.works.length);
  check("new work points at the upload", published.works[23].src === "assets/works/Shot.jpg", published.works[23].src);

  dom.window.close();
}

await testSite();
await testAdmin();
console.log("\n" + (fail ? "FAILURES: " + fail : "ALL CHECKS PASSED") + "  (" + pass + " passed)");
process.exit(fail ? 1 : 0);
