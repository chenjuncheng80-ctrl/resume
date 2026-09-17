"""Download the Google Fonts this site uses and rewrite the @font-face rules
to point at local copies.

Why: fonts.googleapis.com and fonts.gstatic.com are blocked in mainland China.
The <link> is render-blocking, so a visitor behind a China-routed VPN stares at
a blank page until the request times out. Self-hosting removes that dependency
entirely and also makes the fonts work when index.html is opened from disk.

Usage: python tools/vendor_fonts.py
"""
import os
import re
import ssl
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "fonts")
CSS_OUT = os.path.join(ROOT, "css", "fonts.css")

SOURCE_CSS = os.path.join(ROOT, "gf.css")
KEEP_SUBSETS = ("latin", "latin-ext")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def main():
    if not os.path.exists(SOURCE_CSS):
        url = ("https://fonts.googleapis.com/css2"
               "?family=Archivo:wght@300;500;900"
               "&family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600"
               "&family=Manrope:wght@400;500;600;700"
               "&family=JetBrains+Mono:wght@400;500"
               "&display=swap")
        subprocess.run(["curl", "-sL", "--max-time", "30", "-A", UA, url,
                        "-o", SOURCE_CSS], check=True)

    css = open(SOURCE_CSS, encoding="utf-8").read()
    blocks = re.findall(r"/\*\s*(\S+)\s*\*/\s*@font-face\s*\{(.*?)\}", css, re.S)
    chosen = [(s, b) for s, b in blocks if s in KEEP_SUBSETS]

    os.makedirs(OUT_DIR, exist_ok=True)
    out_rules = []
    total = 0

    for subset, body in chosen:
        fam = re.search(r"font-family:\s*'([^']+)'", body).group(1)
        weight = re.search(r"font-weight:\s*([^;]+);", body).group(1).strip()
        url_m = re.search(r"url\((https://[^)]+)\)", body)
        if not url_m:
            continue
        remote = url_m.group(1)

        slug = fam.lower().replace(" ", "-")
        weight_slug = weight.replace(" ", "-")
        name = "%s-%s-%s.woff2" % (slug, weight_slug, subset)

        target = os.path.join(OUT_DIR, name)
        if not os.path.exists(target):
            subprocess.run(["curl", "-sL", "--max-time", "40", "-A", UA, remote,
                            "-o", target], check=True)
        size = os.path.getsize(target)
        total += size

        keep = re.search(r"(unicode-range:\s*[^;]+;)", body)
        out_rules.append(
            "@font-face {\n"
            "  font-family: '%s';\n"
            "  font-style: normal;\n"
            "  font-weight: %s;\n"
            "  font-display: swap;\n"
            "  src: url('../assets/fonts/%s') format('woff2');\n"
            "  %s\n"
            "}" % (fam, weight, name, keep.group(1) if keep else "")
        )

    header = (
        "/* Self-hosted webfonts — fetched once by tools/vendor_fonts.py.\n"
        "   Serving them locally keeps the site usable where Google Fonts is\n"
        "   unreachable (mainland China) and lets file:// rendering use them too.\n"
        "   Regenerate with: python tools/vendor_fonts.py */\n\n"
    )
    with open(CSS_OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(header + "\n\n".join(out_rules) + "\n")

    print("wrote %d @font-face rules -> css/fonts.css" % len(out_rules))
    print("downloaded %d woff2 files -> assets/fonts/ (%.0f KB total)"
          % (len(os.listdir(OUT_DIR)), total / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
