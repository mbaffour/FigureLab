#!/usr/bin/env python3
"""Validate FigureLab's LZW TIFF export with an INDEPENDENT decoder.

feature-export.spec.js round-trips the LZW TIFF through FigureLab's own reader, which
would pass an encoder that shares the reader's bugs. This script opens the same files
with Pillow (libtiff underneath) and checks that the compressed file really is LZW,
carries 300 dpi, and decodes to exactly the pixels of the uncompressed twin.

    cd tests
    npx playwright test feature-export.spec.js   # writes tests/.tiffout/*.tif
    pip install pillow numpy
    python validate_tiff.py

Exits non-zero if anything fails.
"""
import os
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("Pillow and numpy are required: pip install pillow numpy")

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".tiffout")
FAILURES = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILURES.append(msg)


def main():
    lzw_path = os.path.join(OUT, "figure_lzw.tif")
    raw_path = os.path.join(OUT, "figure_raw.tif")
    if not (os.path.exists(lzw_path) and os.path.exists(raw_path)):
        sys.exit("No TIFFs in tests/.tiffout — run: npx playwright test feature-export.spec.js")
    lzw = Image.open(lzw_path)
    lzw.load()
    raw = Image.open(raw_path)
    raw.load()
    print(f"{lzw_path}: {lzw.size[0]}x{lzw.size[1]} {lzw.mode}, {os.path.getsize(lzw_path)} bytes "
          f"(uncompressed twin {os.path.getsize(raw_path)} bytes)")
    check(lzw.info.get("compression") == "tiff_lzw", f"compression is tiff_lzw (got {lzw.info.get('compression')})")
    check(raw.info.get("compression") == "raw", f"the twin is uncompressed (got {raw.info.get('compression')})")
    dpi = tuple(round(v) for v in lzw.info.get("dpi", (0, 0)))
    check(dpi == (300, 300), f"dpi is (300, 300) (got {dpi})")
    check(lzw.mode == "RGB", f"mode is RGB (got {lzw.mode})")
    a, b = np.asarray(lzw), np.asarray(raw)
    check(a.shape == b.shape, f"same shape {a.shape} vs {b.shape}")
    same = a.shape == b.shape and np.array_equal(a, b)
    check(same, "every pixel identical to the uncompressed export")
    if FAILURES:
        sys.exit(f"{len(FAILURES)} check(s) failed")
    print("all checks passed")


if __name__ == "__main__":
    main()
