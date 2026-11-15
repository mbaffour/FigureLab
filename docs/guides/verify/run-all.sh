#!/bin/sh
# Re-verify every guide against the current figure_lab.html. Run from anywhere.
# Needs Playwright with Chromium (the repo's tests/node_modules) and `unzip`.
cd "$(dirname "$0")/../../.." || exit 1
NODE_PATH="${NODE_PATH:-$(pwd)/tests/node_modules}"; export NODE_PATH
status=0
for s in quickstart western-blot fluorescence phage-and-microbiology charts journal-submission freeform tips; do
  echo "== $s"
  node "docs/guides/verify/$s.verify.js" || status=1
done
exit $status
