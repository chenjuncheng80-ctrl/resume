"""Regenerate data/works.js from data/works.json.

data/works.json is the source of truth. data/works.js is the same payload
wrapped in a script so the grid also renders when the page is opened straight
from disk (file://), where the browser blocks fetch() of a local file.

The admin writes both files on every publish; run this script instead when you
edited data/works.json by hand:

    python tools/build_works_js.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(ROOT, "data", "works.json")
JS_PATH = os.path.join(ROOT, "data", "works.js")

BANNER = """/* Generated from data/works.json — do not edit by hand.
   Loaded with a <script> tag so the Selected Work grid also renders when this
   page is opened straight from disk (file://), where fetch() of a local file
   is blocked by the browser. The admin rewrites this file on every publish;
   to rebuild it by hand run:  python tools/build_works_js.py */
"""


def js_source(data):
    # \u003c keeps a stray "</script>" in a title from closing the tag early.
    body = json.dumps(data, ensure_ascii=False, indent=2).replace("<", "\\u003c")
    return BANNER + "window.PORTFOLIO_WORKS = " + body + ";\n"


def main():
    with open(JSON_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    src = js_source(data)
    with open(JS_PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(src)
    print("wrote", os.path.relpath(JS_PATH, ROOT), len(src), "bytes,", len(data.get("works", [])), "works")


if __name__ == "__main__":
    main()
