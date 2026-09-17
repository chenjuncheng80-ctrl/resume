/* Portfolio admin — edit the Selected Work grid and the file library,
   then publish everything as a single GitHub commit. */
(function () {
  "use strict";

  var LS_TOKEN = "ccs-portfolio-token";
  var LS_REPO = "ccs-portfolio-repo";
  var RESUME_PATH = "assets/Chan-Chun-Shing-Resume.pdf";

  var S = {
    owner: "chenjuncheng80-ctrl",
    repo: "resume",
    branch: "main",
    works: null,
    files: null,
    uploads: [],
    deletes: [],
    dirty: false
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function toast(msg, kind) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (kind ? " is-" + kind : "");
    t.hidden = false;
    clearTimeout(toast._id);
    toast._id = setTimeout(function () { t.hidden = true; }, 4200);
  }

  function markDirty() {
    S.dirty = true;
    var st = $("#status");
    st.textContent = "Unpublished changes";
    st.className = "bar__status is-dirty";
    $("#btnPublish").disabled = false;
  }

  function markClean(msg) {
    S.dirty = false;
    var st = $("#status");
    st.textContent = msg || "Up to date";
    st.className = "bar__status" + (msg ? " is-ok" : "");
    $("#btnPublish").disabled = true;
  }

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function safeName(name) {
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    base = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    if (!base) base = "file";
    return ext ? base + "." + ext : base;
  }

  function uniquePath(dir, name) {
    var candidate = dir + "/" + safeName(name);
    var taken = {};
    S.uploads.forEach(function (u) { taken[u.path] = 1; });
    (S.files.files || []).forEach(function (f) { taken[f.path] = 1; });
    (S.works.works || []).forEach(function (w) {
      if (w.src) taken[w.src] = 1;
      if (w.poster) taken[w.poster] = 1;
    });
    if (!taken[candidate]) return candidate;
    var dot = candidate.lastIndexOf(".");
    var base = dot > 0 ? candidate.slice(0, dot) : candidate;
    var ext = dot > 0 ? candidate.slice(dot) : "";
    var i = 2;
    while (taken[base + "-" + i + ext]) i++;
    return base + "-" + i + ext;
  }

  function kindOf(name) {
    var ext = (name.split(".").pop() || "").toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].indexOf(ext) >= 0) return "image";
    if (["mp4", "webm", "mov", "m4v"].indexOf(ext) >= 0) return "video";
    return ext || "file";
  }

  function size(bytes) {
    var u = ["B", "KB", "MB", "GB"], i = 0, n = +bytes || 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + " " + u[i];
  }

  /* ================= connect ================= */

  function loadRepoSettings() {
    try {
      var raw = localStorage.getItem(LS_REPO);
      if (raw) {
        var o = JSON.parse(raw);
        if (o.owner) S.owner = o.owner;
        if (o.repo) S.repo = o.repo;
        if (o.branch) S.branch = o.branch;
      }
    } catch (e) {}
    $("#ownerInput").value = S.owner;
    $("#repoInput").value = S.repo;
    $("#branchInput").value = S.branch;
  }

  function connect(token) {
    var err = $("#authErr");
    err.textContent = "Checking…";
    S.owner = $("#ownerInput").value.trim() || S.owner;
    S.repo = $("#repoInput").value.trim() || S.repo;
    S.branch = $("#branchInput").value.trim() || S.branch;
    GH.setToken(token);
    try { localStorage.setItem(LS_TOKEN, token); } catch (e) {}
    try {
      localStorage.setItem(LS_REPO, JSON.stringify({ owner: S.owner, repo: S.repo, branch: S.branch }));
    } catch (e) {}

    return GH.repo(S.owner, S.repo)
      .then(pull)
      .then(function () {
        $("#auth").hidden = true;
        $("#app").hidden = false;
        $("#repoLabel").textContent = S.owner + "/" + S.repo + " · " + S.branch;
        markClean("Connected");
        renderAll();
      })
      .catch(function (e) {
        err.textContent = friendly(e);
      });
  }

  function friendly(e) {
    if (e.status === 401) return "Token rejected (401). Check it is a fine-grained token with Contents: Read and write on this repo.";
    if (e.status === 403) return "Forbidden (403). The token is missing Contents: Read and write, or you hit a rate limit.";
    if (e.status === 404) return "Not found (404). Check owner / repository / branch.";
    if (e.status === 422) return "Out of date (422). This repo moved since you loaded the page — reload and publish again.";
    if (!e.status && location.protocol === "file:") {
      return "A file:// page is not allowed to call api.github.com — open the online admin to publish.";
    }
    return e.message || "Something went wrong.";
  }

  /* Opening admin.html by double-clicking it means a file:// origin, where the
     browser refuses every request to api.github.com. Say so up front instead of
     letting Connect fail with a cryptic "Failed to fetch". */
  var LIVE_ADMIN = "https://resume-coral-iota.vercel.app/admin.html";

  function showFileNotice() {
    var n = $("#fileNotice");
    if (!n || location.protocol !== "file:") return;
    n.hidden = false;
    n.appendChild(document.createTextNode(
      "This page was opened from disk (file://). Previewing the site that way is fine, " +
      "but the browser blocks api.github.com on a file:// page, so Connect and Publish will fail here. " +
      "Publish from "
    ));
    var a = el("a", null, LIVE_ADMIN.replace(/^https:\/\//, ""));
    a.href = LIVE_ADMIN;
    n.appendChild(a);
    n.appendChild(document.createTextNode(" instead."));
  }

  function pull() {
    function get(path) {
      return GH.getFile(S.owner, S.repo, path, S.branch)
        .then(function (f) { return JSON.parse(f.text); })
        .catch(function (e) {
          if (e.status !== 404) throw e;
          return fetch(path, { cache: "no-store" }).then(function (r) { return r.json(); });
        });
    }
    return Promise.all([get("data/works.json"), get("data/files.json")]).then(function (res) {
      S.works = res[0];
      S.files = res[1];
      if (!S.works.categories) S.works.categories = [];
      if (!S.works.works) S.works.works = [];
      if (!S.files.files) S.files.files = [];
    });
  }

  /* ================= works ================= */

  function catLabel(id) {
    var cats = S.works.categories || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i].label;
    return id || "—";
  }

  function renderWorks() {
    var box = $("#workRows");
    box.innerHTML = "";
    $("#worksCount").textContent = "(" + S.works.works.length + ")";
    if (!S.works.works.length) {
      box.appendChild(el("li", "hint", "No works yet — hit “+ Add work”."));
      return;
    }
    S.works.works.forEach(function (w, i) {
      var row = el("li", "row");
      row.draggable = true;
      row.dataset.index = String(i);
      row.appendChild(el("span", "row__grip", "⋮⋮"));

      var thumb = document.createElement(kindOf(w.src || "") === "video" ? "video" : "img");
      thumb.className = "row__thumb";
      thumb.src = w.src || "";
      if (thumb.tagName === "VIDEO") thumb.muted = true;
      row.appendChild(thumb);

      var body = el("div", "row__body");
      body.appendChild(el("div", "row__title", w.title || "(untitled)"));
      body.appendChild(el("div", "row__meta", [catLabel(w.category), w.year, kindOf(w.src || "")].filter(Boolean).join(" · ")));
      row.appendChild(body);

      var ops = el("div", "row__ops");
      ops.appendChild(miniBtn("Edit", function () { openWork(i); }));
      ops.appendChild(miniBtn("Delete", function () { deleteWork(i); }, true));
      row.appendChild(ops);
      box.appendChild(row);
    });
    bindDrag();
  }

  function miniBtn(label, fn, danger) {
    var b = el("button", "btn btn--mini" + (danger ? " btn--danger" : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function bindDrag() {
    var from = -1;
    $$("#workRows .row").forEach(function (row) {
      row.addEventListener("dragstart", function () { from = +row.dataset.index; row.style.opacity = "0.4"; });
      row.addEventListener("dragend", function () { row.style.opacity = ""; });
      row.addEventListener("dragover", function (e) { e.preventDefault(); });
      row.addEventListener("drop", function (e) {
        e.preventDefault();
        var to = +row.dataset.index;
        if (from < 0 || from === to) return;
        var moved = S.works.works.splice(from, 1)[0];
        S.works.works.splice(to, 0, moved);
        markDirty();
        renderWorks();
      });
    });
  }

  var editing = { index: -1, media: null, poster: null };

  function openWork(index) {
    editing = { index: index, media: null, poster: null };
    var w = index >= 0 ? S.works.works[index] : {
      id: uid("w"), title: "",
      category: (S.works.categories[0] && S.works.categories[0].id) || "",
      year: String(new Date().getFullYear()), alt: "", type: "image", src: "", poster: "", link: "#contact"
    };
    $("#workModalTitle").textContent = index >= 0 ? "Edit work" : "Add work";

    var sel = $('[data-w="category"]');
    sel.innerHTML = "";
    S.works.categories.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id; o.textContent = c.label;
      if (c.id === w.category) o.selected = true;
      sel.appendChild(o);
    });

    $$("[data-w]", $("#workModal")).forEach(function (n) {
      var k = n.getAttribute("data-w");
      n.value = w[k] || "";
    });

    $("#mediaName").textContent = w.src || "No file chosen";
    $("#posterName").textContent = w.poster || "No poster";
    renderPreview(w.src, w.type);
    $("#workModal").hidden = false;
  }

  function renderPreview(src, type) {
    var box = $("#mediaPreview");
    box.innerHTML = "";
    if (!src) { box.textContent = "no media"; return; }
    var m = type === "video" ? document.createElement("video") : document.createElement("img");
    if (m.tagName === "VIDEO") m.muted = true;
    m.src = src;
    box.appendChild(m);
  }

  function pickMedia(file, which) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast("That file is over 25 MB — try a smaller export.", "err"); return; }
    GH.readFileBase64(file).then(function (b64) {
      var path = uniquePath("assets/works", file.name);
      var upload = { path: path, content: b64, size: file.size };
      if (which === "poster") editing.poster = upload; else editing.media = upload;
      if (which === "poster") {
        $("#posterName").textContent = path;
      } else {
        $("#mediaName").textContent = path;
        renderPreview(URL.createObjectURL(file), file.type.indexOf("video") === 0 ? "video" : "image");
      }
    });
  }

  function saveWork() {
    var index = editing.index;
    var isNew = index < 0;
    var w = isNew ? { id: uid("w") } : S.works.works[index];

    $$("[data-w]", $("#workModal")).forEach(function (n) {
      w[n.getAttribute("data-w")] = n.value.trim();
    });
    if (editing.media) { S.uploads.push(editing.media); w.src = editing.media.path; }
    if (editing.poster) { S.uploads.push(editing.poster); w.poster = editing.poster.path; }
    if (!w.title) { toast("Give it a title first.", "err"); return; }
    if (!w.src) { toast("Pick an image or video file.", "err"); return; }
    if (isNew) S.works.works.push(w);

    $("#workModal").hidden = true;
    markDirty();
    renderWorks();
    toast(isNew ? "Work added — publish to go live." : "Work updated.", "ok");
  }

  function deleteWork(i) {
    var w = S.works.works[i];
    if (!confirm('Delete “' + (w.title || "untitled") + '”?')) return;
    var dropMedia = confirm("Also delete its media file from the repo (" + (w.src || "—") + ")?");
    S.works.works.splice(i, 1);
    if (dropMedia && /^assets\//.test(w.src || "")) S.deletes.push(w.src);
    if (dropMedia && /^assets\//.test(w.poster || "")) S.deletes.push(w.poster);
    markDirty();
    renderWorks();
  }

  function renderCats() {
    var box = $("#catList");
    box.innerHTML = "";
    S.works.categories.forEach(function (c, i) {
      var li = el("div", "sub__item");
      var a = document.createElement("input"); a.value = c.label; a.placeholder = "Label";
      var b = document.createElement("input"); b.value = c.id; b.className = "is-wide"; b.placeholder = "id";
      a.addEventListener("input", function () { c.label = a.value; markDirty(); renderWorks(); });
      b.addEventListener("input", function () { c.id = b.value.trim(); markDirty(); renderWorks(); });
      li.appendChild(a); li.appendChild(b);
      li.appendChild(miniBtn("Remove", function () {
        var used = S.works.works.filter(function (w) { return w.category === c.id; }).length;
        if (used && !confirm(used + " work(s) use this category. Remove anyway?")) return;
        S.works.categories.splice(i, 1);
        markDirty(); renderCats(); renderWorks();
      }, true));
      box.appendChild(li);
    });
  }

  /* ================= files ================= */

  function resumeEntry() {
    var list = S.files.files || [];
    for (var i = 0; i < list.length; i++) if (list[i].path === RESUME_PATH) return list[i];
    return null;
  }

  function replaceResume(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { toast("The resume has to be a PDF.", "err"); return; }
    GH.readFileBase64(file).then(function (b64) {
      var entry = resumeEntry();
      if (!entry) {
        entry = { id: uid("f"), name: "Chan-Chun-Shing-Resume.pdf", path: RESUME_PATH, kind: "pdf", note: "", resume: true };
        S.files.files.unshift(entry);
      }
      entry.size = file.size;
      entry.added = new Date().toISOString().slice(0, 10);
      // Overwrite the same path so the hero button keeps working untouched.
      S.uploads = S.uploads.filter(function (u) { return u.path !== RESUME_PATH; });
      S.uploads.push({ path: RESUME_PATH, content: b64, size: file.size });
      markDirty();
      renderFiles();
      toast("Resume replaced — publish to upload.", "ok");
    });
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var added = 0, skipped = 0;
    var jobs = files.map(function (f) {
      if (f.size > 25 * 1024 * 1024) { skipped++; return Promise.resolve(); }
      return GH.readFileBase64(f).then(function (b64) {
        var path = uniquePath("assets/files", f.name);
        S.uploads.push({ path: path, content: b64, size: f.size });
        S.files.files.push({
          id: uid("f"), name: safeName(f.name), path: path,
          kind: kindOf(f.name), size: f.size, note: "",
          added: new Date().toISOString().slice(0, 10)
        });
        added++;
      });
    });
    Promise.all(jobs).then(function () {
      markDirty();
      renderFiles();
      toast(added ? "Added " + added + " file(s). Publish to upload." : "Nothing added.", added ? "ok" : "err");
      if (skipped) toast(skipped + " file(s) skipped (over 25 MB).", "err");
    });
  }

  function renderFiles() {
    var box = $("#fileRows");
    box.innerHTML = "";
    var list = S.files.files || [];
    var extra = list.filter(function (f) { return f.path !== RESUME_PATH; });
    $("#filesCount").textContent = "(" + extra.length + ")";
    var r = resumeEntry();
    $("#resumeState").textContent = r
      ? RESUME_PATH + " · " + size(r.size) + " · last replaced " + (r.added || "—")
      : RESUME_PATH + " · not in the file list yet";

    if (!extra.length) {
      box.appendChild(el("li", "hint", "No extra files yet."));
      return;
    }
    extra.forEach(function (f) {
      var row = el("li", "row");
      row.appendChild(el("span", "row__grip", (f.kind || "file").toUpperCase().slice(0, 4)));
      var body = el("div", "row__body");
      body.appendChild(el("div", "row__title", f.name));
      body.appendChild(el("div", "row__meta", size(f.size) + " · " + f.path));
      var note = document.createElement("input");
      note.value = f.note || "";
      note.placeholder = "note (optional)";
      note.style.cssText = "font-size:.78rem;padding:.2rem .45rem;border:1px solid var(--line);border-radius:4px;margin-top:.25rem;width:100%";
      note.addEventListener("input", function () { f.note = note.value; markDirty(); });
      body.appendChild(note);
      row.appendChild(body);

      var ops = el("div", "row__ops");
      ops.appendChild(miniBtn("Copy link", function () {
        var url = location.origin + location.pathname.replace(/admin\.html$/, "") + f.path;
        if (navigator.clipboard) navigator.clipboard.writeText(url);
        toast("Link copied: " + url, "ok");
      }));
      ops.appendChild(miniBtn("Delete", function () {
        if (!confirm("Delete " + f.name + " from the repo?")) return;
        var pending = S.uploads.filter(function (u) { return u.path === f.path; }).length;
        S.uploads = S.uploads.filter(function (u) { return u.path !== f.path; });
        if (!pending) S.deletes.push(f.path);
        S.files.files.splice(S.files.files.indexOf(f), 1);
        markDirty();
        renderFiles();
      }, true));
      row.appendChild(ops);
      box.appendChild(row);
    });
  }

  /* ================= publish ================= */

  /* data/works.js is data/works.json wrapped in a script tag. index.html loads
     it with <script> so the grid still renders when the page is opened from
     disk (file://), where fetch() of a local file is blocked. Both files are
     rewritten together on publish, so they never drift. Keep this in sync with
     tools/build_works_js.py, which produces the same output offline. */
  function worksJsSource(works) {
    return "/* Generated from data/works.json — do not edit by hand.\n" +
      "   Loaded with a <script> tag so the Selected Work grid also renders when this\n" +
      "   page is opened straight from disk (file://), where fetch() of a local file\n" +
      "   is blocked by the browser. The admin rewrites this file on every publish;\n" +
      "   to rebuild it by hand run:  python tools/build_works_js.py */\n" +
      // \u003c keeps a stray "</script>" in a title from closing the tag early.
      "window.PORTFOLIO_WORKS = " + JSON.stringify(works, null, 2).replace(/</g, "\\u003c") + ";\n";
  }

  function publish() {
    var btn = $("#btnPublish");
    btn.disabled = true;
    var st = $("#status");
    st.textContent = "Publishing…";
    st.className = "bar__status";

    var changes = [];
    S.uploads.forEach(function (u) {
      changes.push({ path: u.path, content: u.content, encoding: "base64" });
    });
    S.deletes.forEach(function (p) { changes.push({ path: p, delete: true }); });
    changes.push({ path: "data/works.json", content: GH.b64(JSON.stringify(S.works, null, 2) + "\n"), encoding: "base64" });
    changes.push({ path: "data/works.js", content: GH.b64(worksJsSource(S.works)), encoding: "base64" });
    changes.push({ path: "data/files.json", content: GH.b64(JSON.stringify(S.files, null, 2) + "\n"), encoding: "base64" });

    GH.commit(S.owner, S.repo, S.branch, "Update portfolio content — " + new Date().toISOString().slice(0, 16).replace("T", " "), changes)
      .then(function (res) {
        S.uploads = [];
        S.deletes = [];
        markClean("Published");
        toast("Committed " + (res.sha || "").slice(0, 7) + " — Vercel rebuilds shortly.", "ok");
        return pull();
      })
      .then(renderAll)
      .catch(function (e) {
        markDirty();
        toast(friendly(e), "err");
      });
  }

  /* ================= boot ================= */

  function bind() {
    $("#btnConnect").addEventListener("click", function () {
      var t = $("#tokenInput").value.trim();
      if (!t) { $("#authErr").textContent = "Paste a token first."; return; }
      connect(t);
    });
    $("#tokenInput").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#btnConnect").click(); });

    $$("#tabs .tab").forEach(function (b) {
      b.addEventListener("click", function () {
        $$("#tabs .tab").forEach(function (x) { x.classList.remove("is-on"); });
        b.classList.add("is-on");
        var name = b.getAttribute("data-tab");
        $$(".panel").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== name; });
      });
    });

    $("#btnPublish").addEventListener("click", publish);
    $("#btnSettings").addEventListener("click", function () {
      $("#auth").hidden = false;
      $("#app").hidden = true;
      $("#authErr").textContent = "";
    });

    $("#btnAddWork").addEventListener("click", function () { openWork(-1); });
    $("#btnCats").addEventListener("click", function () { renderCats(); $("#catModal").hidden = false; });
    $("#btnAddCat").addEventListener("click", function () {
      S.works.categories.push({ id: "new-" + S.works.categories.length, label: "New category" });
      markDirty(); renderCats();
    });
    $("#btnSaveWork").addEventListener("click", saveWork);
    $("#btnPickMedia").addEventListener("click", function () { $("#mediaPick").click(); });
    $("#btnPickPoster").addEventListener("click", function () { $("#posterPick").click(); });
    $("#mediaPick").addEventListener("change", function (e) { pickMedia(e.target.files[0], "media"); e.target.value = ""; });
    $("#posterPick").addEventListener("change", function (e) { pickMedia(e.target.files[0], "poster"); e.target.value = ""; });

    $("#btnUpload").addEventListener("click", function () { $("#filePick").click(); });
    $("#filePick").addEventListener("change", function (e) { addFiles(e.target.files); e.target.value = ""; });
    $("#btnResume").addEventListener("click", function () { $("#resumePick").click(); });
    $("#resumePick").addEventListener("change", function (e) { replaceResume(e.target.files[0]); e.target.value = ""; });

    var drop = $("#drop");
    drop.addEventListener("click", function () { $("#filePick").click(); });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); });
    });
    drop.addEventListener("drop", function (e) { addFiles(e.dataTransfer.files); });

    $$("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () {
        var m = b.closest(".modal");
        if (m) m.hidden = true;
      });
    });
    $$(".modal").forEach(function (m) {
      m.addEventListener("click", function (e) { if (e.target === m) m.hidden = true; });
    });

    window.addEventListener("beforeunload", function (e) {
      if (S.dirty) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  function renderAll() {
    renderWorks();
    renderFiles();
  }

  function boot() {
    loadRepoSettings();
    bind();
    var saved = "";
    try { saved = localStorage.getItem(LS_TOKEN) || ""; } catch (e) {}
    if (saved) { $("#tokenInput").value = saved; connect(saved); }
  }

  window.CCSAdmin = { state: S, render: renderAll, publish: publish };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
