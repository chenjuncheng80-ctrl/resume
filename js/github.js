/* Minimal GitHub client for the studio admin.
   Writes go through the Git Data API (blob -> tree -> commit -> ref) so a
   publish is a single commit with all changed files at once — one Vercel
   build instead of one per file. */
(function () {
  "use strict";

  var API = "https://api.github.com";
  var token = null;

  function setToken(t) { token = (t || "").trim(); }
  function getToken() {
    if (token) return token;
    try { token = (localStorage.getItem("ccs-studio-token") || "").trim(); } catch (e) {}
    return token;
  }
  function hasToken() { return !!getToken(); }

  function headers(extra) {
    var h = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    var t = getToken();
    if (t) h.Authorization = "Bearer " + t;
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function req(method, path, body) {
    var init = { method: method, headers: headers(body ? { "Content-Type": "application/json" } : null) };
    if (body) init.body = JSON.stringify(body);
    return fetch(API + path, init).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var msg = (data && data.message) || r.statusText || ("HTTP " + r.status);
          var err = new Error(msg);
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  /* ---------- utf-8 safe base64 ---------- */
  function b64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64FromArrayBuffer(buf) {
    var bytes = new Uint8Array(buf);
    var chunk = 0x8000, bin = "";
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function readFileBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var out = String(fr.result).split(",")[1] || "";
        resolve(out);
      };
      fr.onerror = function () { reject(new Error("Could not read " + file.name)); };
      fr.readAsDataURL(file);
    });
  }

  /* ---------- reads ---------- */
  function whoami() { return req("GET", "/user"); }

  function repo(owner, name) { return req("GET", "/repos/" + owner + "/" + name); }

  function getFile(owner, name, path, ref) {
    return req("GET", "/repos/" + owner + "/" + name + "/contents/" + path + (ref ? "?ref=" + encodeURIComponent(ref) : ""))
      .then(function (d) {
        var raw = (d.content || "").replace(/\n/g, "");
        var text = "";
        try {
          var bin = atob(raw);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          text = new TextDecoder("utf-8").decode(bytes);
        } catch (e) { text = atob(raw); }
        return { text: text, sha: d.sha, path: d.path, size: d.size };
      });
  }

  function fileExists(owner, name, path, ref) {
    return req("GET", "/repos/" + owner + "/" + name + "/contents/" + path + (ref ? "?ref=" + encodeURIComponent(ref) : ""))
      .then(function () { return true; })
      .catch(function (e) { if (e.status === 404) return false; throw e; });
  }

  /* ---------- writes ---------- */
  function baseRef(owner, name, branch) {
    return req("GET", "/repos/" + owner + "/" + name + "/git/ref/heads/" + branch);
  }

  function createBlob(owner, name, content, encoding) {
    return req("POST", "/repos/" + owner + "/" + name + "/git/blobs", {
      content: content,
      encoding: encoding || "base64"
    });
  }

  function createTree(owner, name, baseTree, entries) {
    return req("POST", "/repos/" + owner + "/" + name + "/git/trees", {
      base_tree: baseTree,
      tree: entries
    });
  }

  function createCommit(owner, name, message, treeSha, parentSha) {
    return req("POST", "/repos/" + owner + "/" + name + "/git/commits", {
      message: message,
      tree: treeSha,
      parents: [parentSha]
    });
  }

  function updateRef(owner, name, branch, sha) {
    return req("PATCH", "/repos/" + owner + "/" + name + "/git/refs/heads/" + branch, { sha: sha });
  }

  /* Publish a batch of changes as one commit.
     changes: [{ path, content, encoding, delete }]
       - content: string (utf-8) or base64 string; encoding "utf-8" | "base64"
       - delete: true removes the path */
  function commit(owner, name, branch, message, changes) {
    if (!changes.length) return Promise.resolve({ skipped: true });
    return baseRef(owner, name, branch).then(function (ref) {
      var parentSha = ref.object.sha;
      return req("GET", "/repos/" + owner + "/" + name + "/git/commits/" + parentSha).then(function (c) {
        var baseTree = c.tree.sha;
        return Promise.all(changes.map(function (ch) {
          if (ch.delete) return Promise.resolve({ path: ch.path, mode: "100644", type: "blob", sha: null });
          return createBlob(owner, name, ch.content, ch.encoding || "base64").then(function (b) {
            return { path: ch.path, mode: "100644", type: "blob", sha: b.sha };
          });
        })).then(function (entries) {
          return createTree(owner, name, baseTree, entries);
        }).then(function (tree) {
          return createCommit(owner, name, message, tree.sha, parentSha);
        }).then(function (cm) {
          return updateRef(owner, name, branch, cm.sha).then(function () { return cm; });
        });
      });
    });
  }

  window.GH = {
    setToken: setToken,
    getToken: getToken,
    hasToken: hasToken,
    whoami: whoami,
    repo: repo,
    getFile: getFile,
    fileExists: fileExists,
    commit: commit,
    b64: b64,
    b64FromArrayBuffer: b64FromArrayBuffer,
    readFileBase64: readFileBase64
  };
})();
