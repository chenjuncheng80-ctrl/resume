"""Sanity check for js/i18n.js: every dictionary key must match the normalised
textContent of some element in index.html, or a string that the page renders at
runtime from data/works.json (work titles and category labels — those are no
longer in the markup). Catches typos in a key before they silently leave a
block untranslated.

    python tools/check_i18n.py
"""
import json
import os
import re
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
JS = os.path.join(ROOT, "js", "i18n.js")
WORKS = os.path.join(ROOT, "data", "works.json")

# Rendered by js/works.js, not present in index.html.
RUNTIME_LABELS = {"All"}

# Elements whose text never reaches the user as copy.
SKIP_TAGS = ("script", "style", "head", "title", "meta", "link")


class Node:
    def __init__(self, tag, cls):
        self.tag = tag
        self.cls = cls
        self.content = []  # ordered: ("text", str) | ("el", Node)

    def text(self):
        out = []
        for kind, val in self.content:
            out.append(val if kind == "text" else val.text())
        return re.sub(r"\s+", " ", "".join(out)).strip()


class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.root = None

    def _push(self, tag, attrs):
        n = Node(tag, dict(attrs).get("class", ""))
        if self.stack:
            self.stack[-1].content.append(("el", n))
        elif self.root is None:
            self.root = n
        return n

    def handle_starttag(self, tag, attrs):
        n = self._push(tag, attrs)
        if tag not in ("img", "br", "meta", "link", "input", "source", "hr"):
            self.stack.append(n)

    def handle_startendtag(self, tag, attrs):
        self._push(tag, attrs)

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1].tag == tag:
            self.stack.pop()

    def handle_data(self, d):
        if self.stack:
            self.stack[-1].content.append(("text", d))


def collect(n, out):
    # A <script> inside <head>/<body> would otherwise bleed into its parent's text.
    if n.tag in SKIP_TAGS:
        return
    # html/body hold every descendant's text; only their children are worth checking.
    if n.tag not in ("html", "body"):
        t = n.text()
        if t:
            out.add(t)
    for kind, val in n.content:
        if kind == "el":
            collect(val, out)


def runtime_strings():
    out = set(RUNTIME_LABELS)
    with open(WORKS, encoding="utf-8") as fh:
        data = json.load(fh)
    for c in data.get("categories", []):
        if c.get("label"):
            out.add(c["label"])
    for w in data.get("works", []):
        if w.get("title"):
            out.add(w["title"])
    return out


def dictionary_keys():
    with open(JS, encoding="utf-8") as fh:
        js = fh.read()
    # Dictionary entries start a line ("key": "value"); anchoring to ^ keeps
    # unrelated inline strings such as the `? "zh-Hant" : "en"` ternary out.
    raw = re.findall(r'^\s*"((?:[^"\\]|\\.)*)"\s*:', js, re.M)
    stop = {"en", "zh", "title", "desc", "sel", "attr"}
    return [k for k in raw if k not in stop and not k.startswith("footer.")]


def main():
    p = P()
    with open(SRC, encoding="utf-8") as fh:
        p.feed(fh.read())
    texts = set()
    collect(p.root, texts)
    runtime = runtime_strings()
    keys = dictionary_keys()

    missing = [k for k in keys if k not in texts and k not in runtime]
    from_json = [k for k in keys if k not in texts and k in runtime]

    print("dictionary keys:", len(keys))
    print("  matched in index.html:", len(keys) - len(missing) - len(from_json))
    print("  matched via data/works.json:", len(from_json))
    print("unmatched keys:", len(missing))
    for m in missing:
        print("   MISSING:", repr(m))
        core = re.sub(r"[^a-zA-Z ]", "", m)[:40]
        for t in texts:
            if core[:20] and core[:20] in t:
                print("      page has:", repr(t[:150]))
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
