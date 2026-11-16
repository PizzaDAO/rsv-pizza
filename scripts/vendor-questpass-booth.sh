#!/usr/bin/env bash
# Vendor the QuestPass Booth build (dist/) at a pinned commit.
# Usage: scripts/vendor-questpass-booth.sh <tag> <expected-commit-sha>
# Never runs npm install or any script from the downloaded repo.
set -euo pipefail

TAG="${1:?usage: $0 <tag> <expected-sha>}"
SHA="${2:?usage: $0 <tag> <expected-sha>}"
REPO="PizzaDAO/questpass-booth"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_BASE="$ROOT/frontend/public/vendor/questpass-booth"

# 1. The tag must resolve to exactly the expected commit.
GOT="$(git ls-remote "https://github.com/$REPO" "refs/tags/$TAG^{}" | awk '{print $1}')"
if [ "$GOT" != "$SHA" ]; then
  echo "FAIL: tag $TAG resolves to '${GOT:-<nothing>}', expected $SHA" >&2
  exit 1
fi
echo "tag $TAG -> $GOT (matches)"

# 2. Download the exact commit into a fresh temp dir and extract it there.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$SHA" -o "$TMP/src.tar.gz"
mkdir "$TMP/src"
tar -xzf "$TMP/src.tar.gz" -C "$TMP/src" --strip-components=1

SRC="$TMP/src"
VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$SRC/package.json")"
[ -n "$VERSION" ] || { echo "FAIL: no version in package.json" >&2; exit 1; }
[ -f "$SRC/dist/questpass-booth.js" ] || { echo "FAIL: dist/questpass-booth.js missing" >&2; exit 1; }

# 3. Copy only the runtime files, replacing any older version directory.
rm -rf "$OUT_BASE"
DEST="$OUT_BASE/$VERSION"
mkdir -p "$DEST/fonts"
cp "$SRC/dist/questpass-booth.js" "$DEST/questpass-booth.js"
cp "$SRC"/dist/fonts/* "$DEST/fonts/"
cp "$SRC/LICENSE" "$DEST/LICENSE"
cp "$SRC/NOTICE" "$DEST/NOTICE"

# 4. vendor.json: sha256 per file plus the SRI hash of the JS.
INTEGRITY="sha384-$(openssl dgst -sha384 -binary "$DEST/questpass-booth.js" | openssl base64 -A)"
VENDOR_JSON="$ROOT/frontend/src/lib/booth/vendor.json"
mkdir -p "$(dirname "$VENDOR_JSON")"
node - "$DEST" "$VERSION" "$SHA" "$INTEGRITY" "$VENDOR_JSON" <<'JS'
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [dest, version, commit, integrity, outFile] = process.argv.slice(2);
const files = {};
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name !== 'SOURCE.md') {
      files[path.relative(dest, p).split(path.sep).join('/')] =
        crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  }
};
walk(dest);
const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
fs.writeFileSync(outFile, JSON.stringify({ version, commit, integrity, files: sorted }, null, 2) + '\n');
JS

# 5. SOURCE.md
cat > "$DEST/SOURCE.md" <<MD
# QuestPass Booth (vendored)

- Repo: https://github.com/$REPO (fork of https://github.com/simarpreetsingh-019/questpass-booth)
- Tag: $TAG
- Commit: $SHA
- Version: $VERSION
- Vendored on: $(date -u +%Y-%m-%d)
- License: Apache-2.0 (see LICENSE and NOTICE in this folder; fonts: fonts/LICENSES.md)

Only \`dist/questpass-booth.js\`, \`dist/fonts/*\`, \`LICENSE\` and \`NOTICE\` are copied.
Do not edit these files by hand: the hashes in \`frontend/src/lib/booth/vendor.json\`
(used for Subresource Integrity) are checked by \`vendorIntegrity.test.ts\`.

## Updating
One PR per bump. Read the CHANGELOG between tags and
\`gh api repos/$REPO/compare/<old>...<new>\` (focus on src/ui, src/core, any new fetch).
Then run \`scripts/vendor-questpass-booth.sh <new-tag> <new-commit-sha>\`, check the URL
list and size it prints, test on the Vercel preview, and merge. Never point at a branch.

## If a Content-Security-Policy is ever added
The booth needs: script-src 'self'; font-src 'self'; connect-src 'self';
img-src 'self' data: blob: https:; media-src blob:. It uses no inline scripts or styles.
MD

# 6. Report.
echo "version: $VERSION"
echo "bundle: $(wc -c < "$DEST/questpass-booth.js") bytes raw, $(gzip -c "$DEST/questpass-booth.js" | wc -c) bytes gzip"
echo "URLs found in the JS:"
grep -oE 'https?://[^"'\'' )]+' "$DEST/questpass-booth.js" | sort -u
