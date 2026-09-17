"""One-off: turn the hard-coded #work cards in index.html into data/works.json."""
import html as htmlmod
import json
import re

SRC = "index.html"
OUT = "data/works.json"

html = open(SRC, encoding="utf-8").read()
start = html.index('<section class="section" id="work"')
end = html.index("</section>", start)
block = html[start:end]

CATEGORIES = [
    ("photography", "Photography"),
    ("video", "Video Editing"),
    ("vfx", "VFX"),
    ("motion", "Motion Graphic"),
    ("retouch", "Retouching"),
    ("adobeai", "Adobe AI"),
]

cards = re.findall(r'<a class="card reveal".*?</a>', block, re.S)
print("cards found:", len(cards))


def grab(pattern, text, default=""):
    m = re.search(pattern, text, re.S)
    return htmlmod.unescape(m.group(1)).strip() if m else default


works = []
for i, card in enumerate(cards, 1):
    category = grab(r'data-category="([^"]+)"', card)
    link = grab(r'<a class="card reveal"[^>]*href="([^"]*)"', card) or "#contact"
    img = re.search(r'<img class="card__img"[^>]*>', card)
    vid = re.search(r'<video class="card__img"[^>]*>', card)
    if vid:
        tag = vid.group(0)
        kind = "video"
        src = grab(r'src="([^"]+)"', tag)
        poster = grab(r'poster="([^"]+)"', tag)
        alt = ""
    else:
        tag = img.group(0) if img else ""
        kind = "image"
        src = grab(r'src="([^"]+)"', tag)
        poster = ""
        alt = grab(r'alt="([^"]*)"', tag)
    works.append({
        "id": "w-%02d" % i,
        "title": grab(r'<h3 class="card__title"[^>]*>(.*?)</h3>', card),
        "category": category,
        "year": grab(r'<span class="card__year"[^>]*>(.*?)</span>', card),
        "type": kind,
        "src": src,
        "poster": poster,
        "link": link,
        "featured": False,
        **({"alt": alt} if alt else {}),
    })

for w in works:
    if not w["title"] or not w["src"]:
        print("  suspicious:", w)

data = {
    "categories": [{"id": cid, "label": label} for cid, label in CATEGORIES],
    "works": works,
}
json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
open(OUT, "a", encoding="utf-8").write("\n")
print("wrote", OUT, "with", len(works), "works")
