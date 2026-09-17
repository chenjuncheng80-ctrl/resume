"""Sanity check for js/i18n.js: every dictionary key must match the normalised
textContent of some element in index.html (order preserved), and vice versa we
list English copy that is still untranslated."""
import re
from html.parser import HTMLParser

SRC = "index.html"
JS = "js/i18n.js"


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


def collect(n, out, skip_head=False):
    t = n.text()
    if t and n.tag not in ("script", "style"):
        out.add(t)
    for kind, val in n.content:
        if kind == "el":
            collect(val, out)


p = P()
p.feed(open(SRC, encoding="utf-8").read())
texts = set()
collect(p.root, texts)

js = open(JS, encoding="utf-8").read()
# dictionary keys are the strings followed by a colon
raw_keys = re.findall(r'"((?:[^"\\]|\\.)*)"\s*:', js)
stop = {"en", "zh", "title", "desc", "sel", "attr"}
keys = [k for k in raw_keys if k not in stop and not k.startswith("footer.")]

missing = [k for k in keys if k not in texts]
print("dictionary keys:", len(keys))
print("unmatched keys:", len(missing))
for m in missing:
    print("   MISSING:", repr(m))
    # show the closest element texts to help fix the key
    core = re.sub(r"[^a-zA-Z ]", "", m)[:40]
    for t in texts:
        if core[:20] and core[:20] in t:
            print("      page has:", repr(t[:150]))
