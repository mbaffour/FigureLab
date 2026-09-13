#!/usr/bin/env python3
"""Validate FigureLab's exported PDFs with an INDEPENDENT parser.

The Playwright suite checks the PDF bytes against this project's own idea of the
format, which would happily pass a file no real reader accepts. This script runs
pypdf over the same files to confirm they genuinely parse, that the text layer is
extractable, and that each string sits where the figure put it.

    cd tests
    npx playwright test pdf-extract.spec.js     # writes tests/.pdfout/*.pdf
    pip install pypdf
    python validate_pdf.py

Exits non-zero if anything fails.
"""
import os
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("pypdf is required: pip install pypdf")

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".pdfout")
FAILURES = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILURES.append(msg)


def positions(page):
    """[(text, x, y), ...] read from each text-showing operator's text matrix."""
    found = []
    data = page.get_contents().get_data().decode("latin1")
    for m in re.finditer(r"1 0 0 1 ([\d.]+) ([\d.]+) Tm \((.*?)\) Tj", data):
        found.append((m.group(3), float(m.group(1)), float(m.group(2))))
    return found


def main():
    if not os.path.isdir(OUT):
        sys.exit("no %s — run: npx playwright test pdf-extract.spec.js" % OUT)

    print("== labels.pdf : panel letters, a title, and a micron scale bar ==")
    p = PdfReader(os.path.join(OUT, "labels.pdf")).pages[0]
    res = p.get("/Resources", {})
    fonts = {k: str(v.get_object().get("/BaseFont")) for k, v in res.get("/Font", {}).items()}
    text = p.extract_text()
    W, H = float(p.mediabox.width), float(p.mediabox.height)

    check(len(fonts) > 0, "a font resource is present: %s" % fonts)
    check(all("Helvetica" in f or "Times" in f or "Courier" in f for f in fonts.values()),
          "every font is a base-14 face (nothing embedded)")
    check("/Im0" in res.get("/XObject", {}), "the figure image is present as /Im0")
    for letter in "ABCD":
        check(letter in text, "panel letter %s is extractable text" % letter)
    check("µm" in text, "the micron sign survives WinAnsi encoding: %r"
          % [l for l in text.splitlines() if "m" in l][:3])
    check("(n=3)" in text, "parentheses in the title round-trip unescaped")

    pos = positions(p)
    check(len(pos) >= 5, "%d text operators positioned on the page" % len(pos))
    letters = {t: (x, y) for t, x, y in pos if t in "ABCD"}
    if {"A", "B", "C"} <= set(letters):
        ys = [letters[c][1] for c in "ABC"]
        check(max(ys) - min(ys) < 1.0, "A, B and C share a baseline (same grid row)")
        xs = [letters[c][0] for c in "ABC"]
        check(xs == sorted(xs), "A, B, C run left to right")
    if "A" in letters and "D" in letters:
        check(abs(letters["A"][0] - letters["D"][0]) < 1.0, "D is aligned under A (next row)")
        check(letters["D"][1] < letters["A"][1], "D sits lower on the page than A")
    check(all(0 <= x <= W and 0 <= y <= H for _, x, y in pos),
          "every string lands inside the %.0f x %.0f pt page" % (W, H))

    print("== mixed.pdf : a label the font cannot represent must stay raster ==")
    p2 = PdfReader(os.path.join(OUT, "mixed.pdf")).pages[0]
    t2 = p2.extract_text()
    check("GAPDH" in t2, "the ASCII label is live text")
    check("α-tubulin" not in t2,
          "the Greek label is NOT in the text layer (left in the raster, not mangled)")

    print("== multipage.pdf : two lossless pages, lettering continues, row labels follow ==")
    r3 = PdfReader(os.path.join(OUT, "multipage.pdf"))
    check(len(r3.pages) == 2, "the file has two pages")
    w0 = float(r3.pages[0].mediabox.width)
    for i, pg in enumerate(r3.pages):
        res = pg.get("/Resources", {})
        im = res["/XObject"]["/Im0"].get_object()
        check(str(im.get("/Filter")) == "/FlateDecode",
              "page %d image is Flate-compressed (lossless), not JPEG" % (i + 1))
        check(abs(float(pg.mediabox.width) - w0) < 0.01, "page %d is the same width as page 1" % (i + 1))
        fonts = {k: str(v.get_object().get("/BaseFont")) for k, v in res.get("/Font", {}).items()}
        check(len(fonts) > 0 and all("Helvetica" in f or "Times" in f or "Courier" in f for f in fonts.values()),
              "page %d has a base-14 font resource: %s" % (i + 1, fonts))
    s1 = {t for t, _, _ in positions(r3.pages[0])}
    s2 = {t for t, _, _ in positions(r3.pages[1])}
    check({"A", "B"} <= s1 and "C" not in s1, "page 1 letters its panels A, B: %s" % sorted(s1))
    check({"C", "D"} <= s2 and "A" not in s2, "page 2 continues with C, D: %s" % sorted(s2))
    t1, t2 = r3.pages[0].extract_text(), r3.pages[1].extract_text()
    check("mock" in t1 and "treated" not in t1, "page 1 carries the first row's label only")
    check("treated" in t2 and "mock" not in t2, "page 2 carries the second row's label (used to repeat the first)")

    print()
    if FAILURES:
        print("%d check(s) failed" % len(FAILURES))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
