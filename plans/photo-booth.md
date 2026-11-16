# Photo booth (QuestPass Booth) in rsv.pizza

## Goal

Every party gets a phone-first photo booth at `rsv.pizza/<party>/booth`. It works with no setup, using the PizzaDAO theme and the party's name, city and date. Hosts can restyle it from the host dashboard, turn it off, and print a QR code. Guests can choose to add a finished photo to the party gallery (it goes through the normal moderation), so the sizzle reel can use it. By default nothing leaves the phone.

Booth source: `PizzaDAO/questpass-booth` (our fork of `simarpreetsingh-019/questpass-booth`, Apache-2.0).
**Pin: tag `v1.3.0` = commit `b8c6d9659b617b07bc008ac97c9a80c5fb8cb089`.** On 2026-11-16 the fork's `main` was identical to that tag and to upstream.

Facts from the booth repo that the plan depends on:
- `dist/questpass-booth.js`: one ES module, 274 KB raw / 92 KB gzip. It defines `<questpass-booth>` and `<questpass-booth-editor>`. It has no runtime imports and no third-party URLs (the only URLs are its own repo and the t.me/x.com/instagram profile prefixes).
- It loads fonts from `new URL("./fonts/", import.meta.url)`: 18 woff2 files, about 430 KB, all fetched when the booth opens. `dist/fonts/LICENSES.md` holds the OFL licences.
- `questpass:photo` fires on save/share with `detail = { blob, frame, ratio, name }`, just before the native share sheet or download. `questpass:video` fires the same way for MP4s.
- The 1.3.0 Video mode calls `getUserMedia({ video, audio: true })`, so the microphone matters too, not only the camera.
- The editor has a `config` property (load) and emits `change` with `{ config }`. It never saves anything itself.
- The package `exports` has only `.` and `./server`. `dist/config.js` (`normalizeConfig` for Node) is **not exported**, so the backend cannot cleanly `import "questpass-booth/config"`. The backend does its own light validation instead (step 4). The booth re-normalizes every config in the browser anyway.
- `presets/pizzadao.json` is the ready PizzaDAO theme: pizza pack frames first, `pizza-box` as the default frame, red/yellow on black, condensed headings, `logo: ""`.

---

## Files to change / add

**Vendored booth (frontend, static)**
- `frontend/public/vendor/questpass-booth/1.3.0/questpass-booth.js` (copied as-is)
- `frontend/public/vendor/questpass-booth/1.3.0/fonts/*.woff2` + `fonts/LICENSES.md`
- `frontend/public/vendor/questpass-booth/1.3.0/LICENSE`, `NOTICE` (required by Apache-2.0)
- `frontend/public/vendor/questpass-booth/1.3.0/SOURCE.md`: repo, tag, commit sha, date vendored, and how to update
- `frontend/src/lib/booth/vendor.json`: `{ version, commit, integrity: "sha384-…", files: { "<relpath>": "<sha256>" } }`
- `scripts/vendor-questpass-booth.sh`: the only way to update the copy (see section 1)
- Do **not** vendor: `*.map` (1 MB), `dist/types`, `dist/server.js`, `dist/config.js`, `demo/`, `scripts/`.

**Frontend**
- `frontend/src/lib/booth/loadBooth.ts`: lazy loader that injects a module `<script>` with SRI
- `frontend/src/lib/booth/pizzadaoPreset.json`: copy of the booth's `presets/pizzadao.json` at the pinned sha, with `brand.logo` set to `"/logo.png"` as an absolute URL at runtime (see buildBoothConfig)
- `frontend/src/lib/booth/buildBoothConfig.ts` (+ `.test.ts`): merges the default, the host's config and the party's details
- `frontend/src/types/questpass-booth.d.ts`: `JSX.IntrinsicElements` declarations for both elements, plus minimal `BoothElement` and `EditorElement` interfaces (`config`, `person`)
- `frontend/src/pages/BoothPage.tsx` (+ `.test.tsx`): the public booth view
- `frontend/src/components/booth/BoothShareConsent.tsx`: the "Add to the party's photos?" card
- `frontend/src/components/booth/BoothTab.tsx`: host setup (toggle, editor, save/reset, QR code, link)
- `frontend/src/components/booth/BoothCredit.tsx`: the credit line, used on the booth page and in the host tab
- `frontend/src/App.tsx`: lazy `BoothPage`, plus `<Route path="/:slug/booth" …>` **above** `/:slug`, next to `/:slug/projects`
- `frontend/src/pages/EventPage.tsx`: a "Photo booth" button when `event.boothEnabled`
- `frontend/src/pages/HostPage.tsx`: add `'booth'` to `TabType` and `ALL_VALID_TABS`, render `<BoothTab>`
- `frontend/src/components/AppsHub.tsx`: add the app entry `{ id: 'photo-booth', name: 'Photo Booth', tab: 'booth', icon: Camera, category: 'day-of', status: 'live' }`
- `frontend/src/lib/appDefinitions.ts`: add `{ id: 'photo-booth', name: 'Photo Booth', tab: 'booth', icon: Camera }` to `PINNABLE_APPS`. Leave `BROADCAST_APPS` alone unless you also add `'booth'` to the backend `BROADCAST_APP_TABS`; the catalog test enforces this.
- `frontend/src/lib/api.ts`: `getBooth(partyId)`, `saveBooth(partyId, body)`, and `boothEnabled?: boolean` on `PublicEvent`
- `frontend/src/i18n/...` (English locale): new strings
- `frontend/vercel.json`: headers (section 5)

**Backend**
- `backend/prisma/schema.prisma`: new `PartyBooth` model, and a `booth PartyBooth?` relation on `Party` (a relation field only, so no new column on `parties`)
- `backend/prisma/migrations/20261117_party_booths/migration.sql`
- `scripts/anon-no-access-tables.json`: add `party_booths`
- `backend/src/lib/boothConfig.ts` (+ `.test.ts`): `sanitizeBoothConfig()`
- `backend/src/routes/booth.routes.ts` (+ `.test.ts`): GET (public) and PUT (host-only)
- `backend/src/index.ts`: a route-level `express.json({ limit: '2mb' })` for `/api/parties/:partyId/booth`, mounted **before** the global `express.json()` the same way `/api/admin/logo-bg-audit` is (the global default is 100 KB, too small for a logo data URL). Also mount `app.use('/api/parties', boothRoutes)`.
- `backend/src/lib/appSettings.ts`: new setting `booth.enabled` (area `features`, min 0, max 1, default 0, failure 0) as the global kill switch and rollout flag
- `backend/src/routes/event.routes.ts`: select `booth: { select: { enabled: true } }` and return `boothEnabled = globalFlag === 1 && (booth?.enabled ?? true) && !cancelledAt`

---

## 1. Supply chain: pinned, self-hosted, with integrity

**Chosen approach:** vendor the built `dist/` files at a pinned commit into `frontend/public/vendor/questpass-booth/<version>/`, and load them with a module `<script>` that carries Subresource Integrity.

`scripts/vendor-questpass-booth.sh <tag> <expected-sha>` should:
1. Run `git ls-remote https://github.com/PizzaDAO/questpass-booth refs/tags/<tag>^{}` and **fail** unless the result equals `<expected-sha>`.
2. Download `https://codeload.github.com/PizzaDAO/questpass-booth/tar.gz/<expected-sha>` into a fresh `mktemp -d`. Extract it there. Never run `npm install` or any of its scripts.
3. Copy only `dist/questpass-booth.js`, `dist/fonts/*`, `LICENSE` and `NOTICE` into `frontend/public/vendor/questpass-booth/<version>/` (version taken from its `package.json`).
4. Write `frontend/src/lib/booth/vendor.json`: a sha256 for each file, plus `integrity = "sha384-" + base64(sha384(questpass-booth.js))` (`openssl dgst -sha384 -binary | openssl base64 -A`).
5. Write `SOURCE.md`. Delete the old version directory.
6. Print the bundle size and `grep -oE 'https?://[^"'\'' )]+'` over the JS, so the reviewer can confirm no new third-party hosts appeared.

`loadBooth.ts`:
```ts
import vendor from './vendor.json';
const BASE = `/vendor/questpass-booth/${vendor.version}/`;
let p: Promise<void> | null = null;
export function loadBooth(): Promise<void> {
  p ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.type = 'module'; s.src = BASE + 'questpass-booth.js';
    s.integrity = vendor.integrity; s.crossOrigin = 'anonymous';
    s.onerror = () => { p = null; reject(new Error('booth failed to load')); };
    document.head.appendChild(s);
    customElements.whenDefined('questpass-booth').then(() => resolve());
  });
  return p;
}
```
- Call it only from `BoothPage` and `BoothTab`. Both are reached through `React.lazy`/tab render, so EventPage's bundle is unchanged. Fonts resolve to `/vendor/questpass-booth/1.3.0/fonts/` via `import.meta.url`; no `setFontsBase` needed.
- Vercel serves `public/` before the SPA rewrite, so the files resolve. Verify that `/vendor/questpass-booth/1.3.0/questpass-booth.js` returns `text/javascript` on the preview, not `index.html`.
- `vercel.json` header: `/vendor/questpass-booth/(.*)` gets `Cache-Control: public, max-age=31536000, immutable` (the path is versioned).
- Middleware site gate (white-label previews): `/vendor/` sits behind the gate. That is fine, because a gated visitor already has the cookie. Don't add it to `OPEN_FILES`.

**Updating** (deliberate, one PR per bump): read the CHANGELOG between tags and `gh api repos/PizzaDAO/questpass-booth/compare/<old>...<new>` (focus on `src/ui`, `src/core`, any new `fetch`). Optionally sync the fork from upstream first, then run the script with the new tag/sha. Check the URL grep and the size, test on the preview, and merge. Never point at `@1` or a branch.

**Alternatives considered**
- jsDelivr `@1`: auto-updates, third-party origin. Rejected (the task forbids it).
- jsDelivr `@1.3.0` + SRI: pinned, but still a third-party request per guest, which breaks the booth's "no third-party requests" privacy claim. Rejected.
- npm git dependency `github:PizzaDAO/questpass-booth#<sha>` bundled by Vite: the lockfile pins it, but Vite would relocate the chunk and break the `import.meta.url` font path (it would need `setFontsBase` and copying the fonts anyway), with no real benefit. Rejected.

## 2. Guest experience: `/<party>/booth`

`BoothPage.tsx` (inside `Layout`, mobile-first, `max-w-md mx-auto`):
1. `useParams().slug` → `getEventBySlug(slug)` (same as `HackathonGalleryPage`) → `getBooth(event.id)`.
2. If the booth is off (`!event.boothEnabled` and the viewer is not an editor), show "This party doesn't have a photo booth" with a link back to `/<slug>`. Editors viewing while the global flag is off get a yellow "Preview: not public yet" banner (`GET /booth` returns `canEdit` when it is called with auth).
3. `await loadBooth()`, then render `<questpass-booth ref={ref} />`. In an effect, set `ref.current.config = buildBoothConfig(...)` and `ref.current.person = …`. Hooks go above all early returns (the CI lint gate).
4. Header: party name, then "Photo booth" and a back link. Footer: `<BoothCredit />`. Below the booth: a one-line privacy note ("Photos stay on your phone unless you choose to add them to the party's photos").

`buildBoothConfig({ preset, hostConfig, event, origin })` is pure and unit-tested. The merge order is the PizzaDAO preset (or the white-label brand, see below), then the host's saved config (a deep merge; the host's values win), then the party's details **only for fields the host left empty**:
- `title` = party name, cut to 40 characters
- `place` = `event.city` (or the first part of the address), cut to 30
- `dates` = `event.date` formatted in `event.timezone`, e.g. `Sat 22 May 2027`, cut to 40
- `share.link` = `${origin}/${event.customUrl || event.inviteCode}`. It must be https; leave it empty on http dev.
- `share.text` = `Pizza the Planet at {party name} {link}` when empty
- `brand.logo` = `${origin}/logo.png` (same-origin https PNG, so CORS is fine; the booth does not accept SVG)
- Always set `credit: true` and `packs: ["pizza"]`. If the host's `frames.allow` excludes `frames.default`, the booth itself fixes it.
- White-label build (`BRAND` is not the default / `IS_SERIES_SCOPED`): use the preset colours, but `brand.name` = `BRAND.name` and the brand's logo PNG, and skip the "Pizza the Planet" copy.

Logged-in guest (`useAuth().user`): `person = { name: user.name, handle: user.twitter ? stripAt(user.twitter) : undefined, network: user.twitter ? 'x' : undefined, avatar }`. For `avatar`, fetch `user.profilePictureUrl` into a Blob in the page (`fetch(url, { credentials: 'omit' })`); pass nothing if that fails. The guest can still edit everything. Mafia names: rsv.pizza has none today, so v1 relies on the preset's 🎲 `person.suggest` lists (see the open questions).

EventPage entry: a "Photo booth" button (lucide `Camera`), shown when `event.boothEnabled`, placed next to the Photos section header, linking to `/${slug}/booth`.

QR code: in `BoothTab`, use the existing `components/QRCode.tsx` (local, no third party) for `https://<origin>/<slug>/booth`, plus "Download PNG" (the same data URL) and "Print" (a print-only card: party name, "Scan for the photo booth 📸", the QR code, and the short link). Also add a "Show QR full-screen" button (a modal, `z-50`, click outside to close) for a phone or laptop at the party.

## 3. Host setup

**Schema** (a separate table so a 1.5 MB logo data URL never gets loaded by the many `prisma.party.findUnique` calls that select every column):
```sql
-- backend/prisma/migrations/20261117_party_booths/migration.sql
CREATE TABLE IF NOT EXISTS party_booths (
  party_id   uuid PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  enabled    boolean NOT NULL DEFAULT true,
  config     jsonb,                       -- null = PizzaDAO default
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
ALTER TABLE party_booths ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON party_booths FROM anon, authenticated;
```
Prisma: `model PartyBooth { partyId String @id @db.Uuid @map("party_id"); enabled Boolean @default(true); config Json?; updatedAt DateTime @default(now()) @updatedAt @map("updated_at"); updatedBy String? @map("updated_by"); party Party @relation(fields:[partyId], references:[id], onDelete: Cascade); @@map("party_booths") }`. Match `Party.id`'s actual type and annotation. No row means enabled with the default config.
Apply it to prod **before** merging (CLAUDE.md rule), then run `check:schema-drift`. Add `party_booths` to `scripts/anon-no-access-tables.json`.

**Endpoints** (`booth.routes.ts`, mounted at `/api/parties`):
- `GET /api/parties/:partyId/booth` (`optionalAuth`): `{ enabled, config, updatedAt, canEdit }`.
  - `enabled = globalFlag && (row?.enabled ?? true) && !party.cancelledAt`
  - `config` is the stored sanitized JSON or `null`
  - `canEdit` comes from `canUserEditParty`
  - Send `Cache-Control: public, max-age=60` when there is no auth header, and `private, no-store` otherwise.
  - Return 404 for an unknown party. It returns nothing private (no `updatedBy`).
- `PUT /api/parties/:partyId/booth` (`requireAuth`): body `{ enabled?: boolean, config?: object | null }`.
  - Return 403 unless `canUserEditParty(partyId, req.userId, req.userEmail)`, and 410 if the party is cancelled.
  - `config: null` resets to the default. Upsert the row and set `updatedBy = req.userId`.
  - Returns the same shape as GET.

**`sanitizeBoothConfig(input)`** (backend; defence in depth, since the booth re-normalizes client-side):
- Input must be a plain object, with `JSON.stringify` ≤ 1.8 MB (else 413). Body limit: 2 MB route-level.
- Allowlisted top-level keys only: `version, title, place, dates, brand, showBrand, credit, frames, packs, person, words, video, share, camera, maxPhotos`. Drop the rest. Force `version: 1`, `credit: true`.
- `brand.logo` must be `""`, `^data:image/(png|jpeg|webp|gif);base64,` (reuse `lib/uploadSniff.ts` on the decoded bytes if convenient), or an `https://` URL. Anything else, SVG included, becomes `""`.
- `share.link` must be https, otherwise `""`. Colours must match `#RRGGBB`, otherwise drop them. `person.names` gets at most 5000 entries.
- Strings: strip C0 control characters and bidi overrides (U+202A–202E, U+2066–2069).

**Global flag:** read `booth.enabled` through the existing `appSettings` resolver. That gives it the admin UI and an audit trail for free.

**Per-party default: ON.** The booth is on-device and adds no new upload path, so it is low-risk, and zero setup is the point. The global flag ships at 0, so turning the switch on is the rollout.

**`BoothTab.tsx`** (host dashboard, `/host/:inviteCode/booth`; HostPage already enforces host auth and co-host `allowedTabs`):
1. `Checkbox` "Photo booth on for this party" → `saveBooth({ enabled })` right away.
2. Link plus QR code block (section 2), and an "Open booth" link.
3. "Customize": `await loadBooth()`, then `<questpass-booth-editor>` with `editor.config = buildBoothConfig(...)` (the effective config, so the host sees the party's details). Listen to `change` and keep the latest `e.detail.config` in a ref; the event fires on every edit, so don't save on each one. Buttons: "Save" (PUT `{ config }`, toast, "Saved" state), "Unsaved changes" hint, and "Reset to PizzaDAO default" (confirm, then PUT `{ config: null }`, then reload the editor).
4. No `brand-endpoint` attribute, so "Fill in from website" stays hidden and hosts upload a logo. `<BoothCredit />` at the bottom.

## 4. Optional sharing to the party gallery

In `BoothPage`, listen for `questpass:photo` on the element:
- If `!event.photosEnabled`, or the guest tapped "Don't ask again" this visit (React state only; no storage), do nothing.
- Otherwise show `BoothShareConsent`, a small bottom card that doesn't block the share sheet: "Add this photo to {party}'s photos?" with **Add** and **No thanks**, plus a "Don't ask again" checkbox. Nothing uploads until the guest taps **Add**.
- On Add: `const file = new File([blob], detail.name, { type: blob.type || 'image/jpeg' })`, then `uploadEventPhoto(file, partyId)` (the existing `event-photos` bucket path), then `uploadPhoto(partyId, { …result, uploaderName: user?.name, uploaderEmail: user?.email, tags: ['booth'], caption: undefined })`.
- Show "Added. The host will review it" (or "Added" for hosts, whose uploads are auto-approved). Surface `err.message` from the API: `PHOTO_LIMIT_REACHED`, `PHOTOS_DISABLED`, `EVENT_CANCELLED`, size.
- This reuses the existing `POST /api/parties/:partyId/photos` unchanged. Every rule keeps applying: guest uploads are `pending` until a host approves, the per-user cap (`getOperationalLimits().photoPerUserPerEvent`), the 25 MB image limit, dedup, and the cancelled-event 410. There is no new upload surface.
- Sizzle reel: `reelSelection.isReelEligible` already takes approved images, so approved booth photos flow in automatically. The `booth` tag lets the host filter them in the Photos tab.
- Videos (`questpass:video`): **not offered in v1** (the reel skips videos anyway). Ignore the event.
- Update the page's privacy note. Nothing is sent to the server except the tapped photo, plus the name/email of a logged-in uploader (which the existing uploader already sends).

## 5. Browser security, camera and embedding

- `vercel.json`: add a global header `{ "source": "/(.*)", "headers": [{ "key": "Permissions-Policy", "value": "camera=(self), microphone=(self)" }] }`. It has to be global: in the SPA, the policy comes from the first document loaded, so a guest who goes from `/<slug>` to `/<slug>/booth` keeps the first page's header. These values match the browser default for same-origin use, so nothing breaks (the CheckInPage QR scanner also uses the camera). Never set `camera=()` anywhere.
- CSP: there is no CSP on the frontend today, so nothing is needed. If one is added later, the booth needs `script-src 'self'`, `font-src 'self'`, `connect-src 'self'`, `img-src 'self' data: blob: https:` (the avatar and logo), `media-src blob:`. No inline scripts or styles (the booth uses shadow roots and constructed styles). Put this note in `SOURCE.md`.
- No iframe: the booth is a custom element in our own page. Don't offer embedding the booth on other sites in v1. If it's wanted later, a dedicated route with `frame-ancestors` and documentation of `<iframe allow="camera; microphone">`.
- `avatar-endpoint` (the Telegram/X picture lookup): omit. It would add an unofficial fxtwitter dependency and outbound requests from our backend. Guests upload a picture, or logged-in users get their profile picture.
- `brand-endpoint`: omit (it is SSRF surface on our backend for a one-time convenience). If it's wanted later, mount the booth's `nodeBrandHandler` from the pinned package behind `requireAuth` + host check, with `allowOrigins: ['https://rsv.pizza']` and `callerOf` set to the Vercel `x-forwarded-for` (use `lib/normalizeIp.ts`).
- Camera needs https: Vercel previews and prod are https. On `localhost` dev, it works because localhost is a secure context.

## 6. Credit

- `BoothCredit.tsx`: "Photo booth by [Simarpreet Singh](https://x.com/simarpreet_019) · [QuestPass Booth](https://github.com/simarpreetsingh-019/questpass-booth) (open source, Apache-2.0)". Small text, `text-xs text-white/40`, links `target="_blank" rel="noopener noreferrer"`. Show it on the booth page footer and in the host tab.
- Keep the in-frame "QuestPass · @simarpreet_019" line and the "Made with QuestPass" video end card. Never patch them, and don't add a config field to hide them (the sanitizer forces `credit: true`).
- `LICENSE` and `NOTICE` live in the vendored folder (served publicly with the JS), and `SOURCE.md` points to them.

## 7. Tests, rollout, verification

**Unit / route tests** (vitest; follow `hackathon.routes.test.ts`, which mocks Prisma, `canUserEditParty` and the JWT):
- `booth.routes.test.ts`:
  - anon GET returns 200 with `config: null`, `enabled: true` when there is no row and the flag is 1
  - flag 0 → `enabled: false`; cancelled party → `enabled: false`; unknown party → 404
  - anon PUT → 401; non-editor → 403; editor → 200 with an upsert; `config: null` resets
  - an oversized body → 413; GET never returns `updatedBy`
- `boothConfig.test.ts`: unknown keys dropped, SVG/`javascript:`/http logos removed, `credit:false` → true, bad colours dropped, bidi characters stripped, the 5000-names cap.
- `buildBoothConfig.test.ts`: the merge order (the host overrides the preset; party details only fill blanks), the 40/30/40 caps, date formatting in the party timezone, https-only `share.link`, the white-label brand branch.
- `vendorIntegrity.test.ts`: recompute the sha256 of every file under `public/vendor/questpass-booth/<version>/` and compare it to `vendor.json`; check `integrity` against the sha384 of the JS; check that `LICENSE` and `NOTICE` exist.
- `BoothPage.test.tsx` (mock `loadBooth`, which defines a stub element): dispatching `questpass:photo` shows the consent card. Nothing uploads without a click. **Add** calls `uploadEventPhoto` and `uploadPhoto` with `tags: ['booth']`. **No thanks** and "Don't ask again" suppress later prompts. `photosEnabled: false` → no card. The page renders the off state when the booth is disabled.
- Run `npm --prefix frontend run test`, `npm --prefix backend test`, the frontend type-check, and the rules-of-hooks lint config (`frontend/eslint.hooks.config.js`).

**Rollout**
1. PR 1 (backend + migration): apply the migration to prod first (`pizzadao-db`/Supabase, dry run first), then merge. The `booth.enabled` setting stays at its default 0, so nothing is public.
2. PR 2 (frontend): the preview uses the prod backend. Hosts and super-admins can test `/<slug>/booth` (the preview banner) and the Booth tab while the flag is 0.
3. Snax flips `booth.enabled` to 1 in the admin settings UI when he's happy. Flip it back to 0 as the kill switch.

**Vercel preview checks** (`https://rsvpizza-git-<branch>-pizza-dao.vercel.app`)
- `/vendor/questpass-booth/1.3.0/questpass-booth.js` returns 200 `text/javascript` with the immutable cache header. Response headers on any page include the `Permissions-Policy`.
- The EventPage network tab shows **no** request for the booth JS or fonts. On `/<slug>/booth`, it's about 92 KB gzip JS plus about 430 KB fonts, all from the rsv.pizza origin; no third-party requests from the booth.
- iOS Safari and Android Chrome:
  - camera opens and turns off; Video mode asks for the microphone
  - pizza frames appear first, with party name/city/date on the frames
  - save and share work; the credit line is on the frame
- Logged in: the name and picture are pre-filled. Logged out: the fields are blank, with 🎲.
- Consent: tap **Add**, and the photo shows as pending (tag `booth`) in the host Photos tab. Approve it, and it shows in the gallery and is eligible in the Reel maker. **No thanks** uploads nothing (the network tab confirms it).
- Host tab: the toggle hides the EventPage button and the booth page shows the off state. Editor → change colours → Save → reload the booth page and the colours stick. Reset restores the default. The QR code scans to the right URL, and Print and Download work.
- A co-host without the `booth` tab permission doesn't see the tab.

## Risks

- **Body size / perf:** logo data URLs can reach about 1.5 MB per config. This is handled by the separate table, the route-level 2 MB limit and the short public cache. If that's still too heavy, a follow-up moves logos to storage (`/cdn/...`, same origin).
- **The SRI hash must match byte-for-byte.** Vercel doesn't re-encode `public/` files, but if a CDN transform ever changes them, the booth fails to load (fail closed). The `vendorIntegrity` test catches local drift.
- **Prisma field-add ordering:** a `PartyBooth` model merged before its table exists breaks `include`/`select` of `booth` on events. Apply the migration first (CI drift check).
- **Gallery spam:** no new path, but booth photos make uploads easier. The existing pending moderation and per-user cap cover it.
- **iOS share-sheet timing:** `questpass:photo` fires just before `navigator.share`. The consent card must not take focus or call anything that eats the user gesture, so render it without `focus()`.
- **Upstream changes** within 1.x can change layouts or wording. Because of the pin, that only happens when we bump on purpose.
- **Unexported `dist/config.js`:** backend validation is ours, not the booth's. It's acceptable because the booth normalizes in the browser. Optionally ask the author to add `"./config"` to `exports`.

## Open questions for the owner (with recommendations)

1. **Booth on by default per party?** Recommend **yes** (zero setup), with the global flag as rollout and kill switch.
2. **Allow videos into the gallery?** Recommend **not in v1** (the reel ignores videos, and they're large). Revisit after GPP.
3. **Mafia names:** pull members' mafia names from pizzadao.org (the crew sheet/API) for logged-in users? Recommend **later**. v1 uses the rsv.pizza profile name and the 🎲 generator.
4. **Telegram/X picture lookup and "Fill in from website"?** Recommend **omit** (backend outbound requests and SSRF surface for little gain).
5. **Booth photos in the sizzle reel:** recommend **yes, after host approval** (current behaviour). The `booth` tag allows excluding them later if the framed shots look odd in the reel.
