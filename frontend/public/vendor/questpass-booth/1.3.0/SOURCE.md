# QuestPass Booth (vendored)

- Repo: https://github.com/PizzaDAO/questpass-booth (fork of https://github.com/simarpreetsingh-019/questpass-booth)
- Tag: v1.3.0
- Commit: b8c6d9659b617b07bc008ac97c9a80c5fb8cb089
- Version: 1.3.0
- Vendored on: 2026-11-16
- License: Apache-2.0 (see LICENSE and NOTICE in this folder; fonts: fonts/LICENSES.md)

Only `dist/questpass-booth.js`, `dist/fonts/*`, `LICENSE` and `NOTICE` are copied.
Do not edit these files by hand: the hashes in `frontend/src/lib/booth/vendor.json`
(used for Subresource Integrity) are checked by `vendorIntegrity.test.ts`.

## Updating
One PR per bump. Read the CHANGELOG between tags and
`gh api repos/PizzaDAO/questpass-booth/compare/<old>...<new>` (focus on src/ui, src/core, any new fetch).
Then run `scripts/vendor-questpass-booth.sh <new-tag> <new-commit-sha>`, check the URL
list and size it prints, test on the Vercel preview, and merge. Never point at a branch.

## If a Content-Security-Policy is ever added
The booth needs: script-src 'self'; font-src 'self'; connect-src 'self';
img-src 'self' data: blob: https:; media-src blob:. It uses no inline scripts or styles.
