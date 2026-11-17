# neapolitan-93690: Print Widget: Nametag Widget, Table Tent Widget (P2)

TASKS.md note: "print/stickers app shipped in #228; nametag/table-tent widgets not built".
Planned against `origin/master` @ the press-release merge (#1336, 5631d650).

## Decisions (Snax, answers to the open questions)

1. Builders are sections inside the existing Print app (tab `print`), not new apps.
2. Guest-list source requires BOTH `print` and `guests` tab access. Print-only co-hosts get blank badges plus typed-in names.
3. Layouts: Avery 5395, plain Letter 8-up, plain A4 8-up. Avery 5395 dimensions must be checked against Avery's
   official template (see "Implementation notes").
4. Default guest set: everyone going.
5. Pronouns: typed per badge in the builder, in memory only (no new DB field).
6. Keep the existing static TMNT/PizzaDAO PDFs as "ready-made templates".
7. Badge header: event name (not "HELLO my name is").
8. No per-event saving of builder settings.

Implementation notes (Phase 1):
- Avery 5395 margins: label size matches Avery's product page, but the margins (0.55in top/bottom, 0.6875in sides,
  0.375in/0.19in gaps) come from a third-party page (filesplice.com) because Avery's official template could not be
  fetched. They are self-consistent but unverified; hosts get the alignment test page. The plan's original
  0.594in / 0.167in vertical figures were also unverified, and were replaced.
- Pronouns are done in Phase 1 (per-badge input, in memory). Sponsor grid, wifi-join QR, "pick guests" checklist,
  first/last split, QR on badges, Avery 5392 stay in Phase 2.

## Goal

Hosts can print, from the Print app:

- **(a) Name badges** filled in from the guest list: pick which guests, show their name (plus an
  optional role line), event branding/logo, an optional QR code, on common label sizes, with extra
  blank badges for walk-ins, an on-screen print preview, and exact-size browser printing.
- **(b) Table tent cards**: a folded Letter/A4 sheet with the top half upside down. Shows event name,
  a QR code (RSVP/event page, wifi, custom link), host-written headline/body text, wifi line, and
  sponsor logos.

All rendering happens in the browser. Nothing new is sent to the backend. Emails are never printed.

## What exists today (investigation)

- `frontend/src/components/print/PrintTab.tsx`: static gallery of downloadable files under
  `/public/print-assets/**` (stickers, SWC, flyers, `TABLE_TENTS` = one PizzaDAO PDF, `NAME_TAGS` =
  TMNT PDF, shirts). GPP events also get `PosterGenerator`/`RollupGenerator` (canvas, from
  `components/generative/`). Strings are hardcoded English (no i18n yet). `PrintMaterials` (same
  content, no party) is reused on `/shipping`. **The new builders must not show up there.**
- How print works today: download a PDF, or canvas → PNG (generative flyers). The only in-app
  `window.print()` is `components/booth/BoothTab.tsx` (`body.booth-printing` + `@media print`
  visibility trick, `afterprint` cleanup). `pages/InvoicePage.tsx` uses `@media print` too. No
  `@page` rule exists anywhere yet.
- QR: `components/QRCode.tsx` (local `qrcode` lib → data URL `<img>`, has a test),
  `generative/flyerQr.ts` `flyerEventUrl(party)` → `brandUrl(customUrl || inviteCode)` (tested in
  `flyerQr.test.ts`). `qrcode` is already a dependency. No PDF-generation library (only `pdfjs-dist`,
  which reads PDFs).
- Guests: `usePizza().guests` (excludes `approved === false`). Loaded from `GET /api/parties/:id/guests`,
  gated by `getPartyWithOwnershipCheck` (owner / super admin / GPP editors / co-host `canEdit`). It is
  **not** gated per tab, so any editor's browser already holds the list. Fields we can use: `name`,
  `roles[]` (legacy `ROLE_OPTIONS` + TMNT `TURTLES` values), `approved` (null/true/false),
  `status` (CONFIRMED / WAITLISTED; INVITED is filtered out server-side), `checkedInAt`, `email`
  (only used to match co-hosts, **never rendered**). **No pronouns, handles or custom questions exist.**
- Hosts: `party.coHosts[]` (`name`, `email`, `showOnEvent`, `allowedTabs`, `isPartner`),
  `party.hostName`, `party.userId`.
- Sponsors: `getSponsors(partyId)` (`lib/api.ts`). The backend checks `canUserAccessTab(..., 'partners')`
  and returns 403 otherwise. `autoRegenPrint.ts` filters to `logoUrl && status in ('yes','paid')`. Reuse
  that filter.
- Wifi: `party.wifiInfo` (free text, `day-of/LogisticsCard.tsx`).
- Tab permissions: frontend `HostPage.tsx` works out `allowedTabs` (`'all' | string[]`) from
  `isOwnerOrAdmin` and `party.allowedTabs`. The backend has `VALID_TAB_IDS` in
  `backend/src/helpers/partyAccess.ts`.
- Wiring a new app (press-release #1336): `AppsHub.tsx` entry, `appDefinitions.ts` (`PINNABLE_APPS`,
  `BROADCAST_APPS`), `tabPermissions.ts` (`TabId`, `ALL_HOST_TABS`), `HostPage.tsx` (`TabType`,
  `ALL_VALID_TABS`, render branch), backend `VALID_TAB_IDS` and `BROADCAST_APP_TABS`
  (`broadcastAppCatalog.test.ts` enforces frontend⊆backend), plus i18n in 8 `host.json` files.
- Brand: `frontend/src/config/brand.ts` (`BRAND.name/domain/url/logoUrl/isBranded`, `brandUrl()`).
  `.github/workflows/brand-check.yml` fails new code that hardcodes `rsv.pizza`/`RSV.Pizza`.
- i18n: 8 locales (de, en, es, fr, ja, ko, pt, zh), namespace `host`. `i18n-keys.test.ts` checks
  every literal `t('...')` key exists in `en`.
- No earlier plans in `plans/` about nametags or table tents.

## Approach

### Decision: sections inside the Print app, not separate apps

Recommended: add **"Name Badges"** and **"Table Tents"** builder sections at the top of `PrintTab`.
The existing static Name Tags / Table Tents downloads move into a "Ready-made templates" sub-row.

Why:
- The Print app is already called "Print / Nametags" (AppsHub id `print-nametags`, broadcast name
  "Print / Nametags"). Hosts already look there.
- No tab-ID changes, so no edits to `tabPermissions.ts`, `VALID_TAB_IDS`, `BROADCAST_APP_TABS`,
  `HostPage` tab lists, or co-host permission UIs. That is less to get wrong and no backend deploy.
- Both builders share one print mechanism and the same layout/QR helpers.

Alternative considered: separate `nametags` and `table-tents` tabs, wired like press-release.
- Pros: a separate co-host permission per widget, and pinnable on their own.
- Cons: about 7 more files plus a backend change, and it splits up "print stuff".
- The privacy concern is handled anyway by also checking the `guests` tab (below), so separate tabs
  aren't needed for that.
- If Snax wants them pinnable on their own later, add `PINNABLE_APPS` entries that deep-link to
  `print` with a hash anchor (`#nametags`). No new tab ID needed.

### Decision: HTML/CSS + browser print with `@page`, not PDF or canvas

- **Browser print (chosen):**
  - The browser lays out real text in mm/in units, so it stays sharp.
  - Every script works with no font embedding, including Japanese/Chinese/Korean names.
  - No new dependency. "Save as PDF" in the print dialog also gives hosts a PDF.
- **Client PDF (pdf-lib/jsPDF), rejected:**
  - Exact geometry, but fonts must be embedded for Japanese/Chinese/Korean and other non-Latin names
    (multi-MB fonts).
  - Adds a dependency and a bigger bundle.
- **Canvas → PNG (like the generative flyers), rejected:**
  - Raster text.
  - Images get resized when printed, which breaks label alignment.

How it prints (new shared helper `print/printSheet.tsx`):
- A `PrintPortal` renders the sheet pages into a `div#print-root` attached to `document.body`
  (outside HostPage's overflow/transform containers).
- `printSheets({ pageSize })`:
  1. Inject a `<style id="print-page-style">` with
     `@page { size: 8.5in 11in | 210mm 297mm; margin: 0 }` and
     `@media print { body > *:not(#print-root) { display: none !important } #print-root { display: block } }`.
  2. Add `body.print-sheets`.
  3. Wait for every `<img>` in the root to `decode()`, and for `document.fonts.ready`.
  4. Call `window.print()`.
  5. Remove the style and class on `afterprint` (with a timeout fallback for iOS).
- Use `display:none`, not BoothTab's `visibility:hidden`. Hidden-but-laid-out app content would add
  blank pages.
- Each page is a fixed `width/height` box in inches/mm with `break-after: page`, a white background,
  black text, and `print-color-adjust: exact`. Labels are absolutely positioned from a layout spec, so
  the printed geometry never depends on flow layout.
- **Preview:** the same page components rendered on screen inside a scaled wrapper
  (`transform: scale(fitWidth / pageWidth)`), with page 1..N pagination (render at most about 3 pages
  on screen; the print root renders all). On screen, show a light dashed outline of each label/cut line.
  It's toggleable for print ("Print cut lines", on for plain paper, off for label stock).
- Print instructions next to the button (i18n): "Scale: 100% / Actual size, Margins: None. Turn off
  headers and footers." Plus a **"Print alignment test"** button that prints one page with only label
  outlines and a 1-inch / 25 mm ruler, so hosts can check it against their label sheet before using
  label stock.

### Layout specs (`print/layouts.ts`, pure data, unit-tested)

```
interface SheetLayout { id; labelKey; page: 'letter'|'a4'; unit: 'in'|'mm';
  pageW; pageH; cols; rows; labelW; labelH; marginTop; marginLeft; gapX; gapY;
  kind: 'label-stock'|'plain-paper'; }
```
Phase 1 badge layouts (the implementer must check every number against the manufacturer's template
PDF and note the source in a comment):
- `avery-5395`: Letter. 2 cols x 4 rows. Label 3.375in x 2.333in. marginTop about 0.594in,
  marginLeft 0.6875in, gapX 0.375in, gapY about 0.167in. Check: 2*0.6875 + 2*3.375 + 0.375 = 8.5in.
- `letter-8up-plain`: Letter, same grid as 5395, with cut lines, so hosts without labels get
  badge-holder-friendly cards.
- `a4-8up-plain`: A4, 2 x 4, label 90 x 60 mm, centred, cut lines.

Phase 2: `avery-5392` (4in x 3in inserts, 2 x 3 on Letter, margins about 1in top / 0.25in side), and
the A4 label stock Snax picks (Q3).

Table tent layouts:
- `tent-letter`: 8.5 x 11 portrait, fold line at 5.5in.
- `tent-a4`: 210 x 297, fold at 148.5 mm.
- The top panel is rotated 180°, so both halves read correctly once folded and stood on a table.
  A dashed fold line and optional light crop ticks.
- Content stays out of a 0.3in / 8 mm safe area from page edges (most printers have unprintable
  margins), and 0.25in / 6 mm either side of the fold.

Validation unit test: for every layout, `marginLeft*2 + cols*labelW + (cols-1)*gapX ≈ pageW` (±0.02)
and the same vertically (or "fits within the page" for centred plain layouts).

### (a) Name badge builder (`print/nametags/`)

**Files:**
- `NametagBuilder.tsx`: the controls.
- `NametagSheet.tsx`: renders the pages from `badges[]` and a layout.
- `Badge.tsx`: one label.
- `nametagData.ts`: pure helpers.
- `fitText.ts`: font-size fitting.

**Data (pure, tested) `buildBadges(guests, coHosts, opts)`:**
- **Source** (radio):
  - "Everyone going" (default): `status !== 'WAITLISTED'` and `approved !== false`.
  - "Approved only": `approved === true`.
  - "Checked in": `checkedInAt` set.
  - "Pick guests": a searchable checklist, starting from "Everyone going".
  - Optional "Include waitlist" toggle.
- Dedupe by guest id. Trim names. Skip empty names.
- **Sort:** by name (locale-aware `Intl.Collator(i18n.language)`) or by RSVP time.
- **Role line** (toggle, off by default):
  - "Co-host" if the guest's email (case-insensitive) matches a `party.coHosts[].email`.
  - "Host" if it matches `party.hostName`, or the viewing user is the owner and it's their own guest
    row.
  - Otherwise, optionally the guest's RSVP role (`roles[0]`, e.g. Dev / Leonardo).
  - The email is used only for this comparison, inside a pure function. It is never put into the
    `Badge` model. The `Badge` type has no email field, so it can't leak into the DOM.
  - Partner co-hosts (`isPartner`) show as "Partner".
- **Name display:**
  - "Full name" (default), or "First name big, rest small".
  - Splitting: on the first space for Latin script. CJK names (no spaces) are left whole.
- **Blank badges:** a number box (0–48, default 0, or round up to fill the last sheet with a "Fill
  sheet" checkbox). Blank = header and branding with an empty name area plus a write-in line.
- **Manual names:** a textarea, one per line. Always available. This is how co-hosts without the guests
  tab make badges.

**Badge content (top → bottom):**
- Header band: event logo plus event name (or the brand name).
  - Logo source, in order: `party.eventImageUrl` (if the host picks "event image"), else
    `BRAND.logoUrl`. A "No logo" option saves ink.
  - Images need `crossOrigin` only for canvas, not for `<img>` printing, so Supabase storage URLs work
    as-is.
- Name: `fitText` picks the biggest font size (from 40pt down to 14pt) that fits the label width,
  using a canvas `measureText` with the print font stack. It wraps to 2 lines before shrinking below
  20pt. The font stack includes system CJK fonts.
- Optional role line.
- Optional QR (Phase 2) in the bottom corner, about 0.8in, with a small caption.
- **Colours:** black on white by default. Optional accent colour for the header band (brand red on
  rsv.pizza; on branded builds use the theme's accent, or black).

**Privacy gates:**
- `PrintTab` gets a `canViewGuests` prop from `HostPage`:
  `allowedTabs === 'all' || allowedTabs.includes('guests')`.
- If false, the Source radio shows only "Blank badges" and "Type names". The guest checklist is not
  rendered, and `usePizza().guests` is not read in the builder.
- Builder state is not saved to localStorage or URL params, and is not uploaded. Print happens only on
  the device.
- No emails anywhere in rendered output. Unit test: render the sheet with guests that have emails and
  assert no `@` addresses appear in `container.textContent`.

### (b) Table tent builder (`print/tents/`)

**Files:**
- `TableTentBuilder.tsx`
- `TableTentSheet.tsx`
- `tentPresets.ts`
- `wifiQr.ts`

**Controls:**
- Paper: Letter / A4. Default from the browser locale: Letter for `en-US`/`en-CA`/`es-MX`, A4
  otherwise. Show the default, don't hide the choice.
- Preset (fills in the fields, all editable):
  - "Scan to RSVP / check in" (QR = `flyerEventUrl(party)`).
  - "WiFi" (headline "WiFi", body = `party.wifiInfo`, QR optional).
  - "Sponsors" ("Thanks to our sponsors" + logo grid).
  - "Custom".
- Fields: headline (max ~40 chars), body text (max ~200 chars), event name (on/off, default on),
  date/venue line (on/off, formatted with `getDateTimeInTimezone(party.date, party.timezone)` the way
  the flyers do).
- QR target:
  - None.
  - Event page (default; `flyerEventUrl` → `brandUrl(slug)`).
  - Photo booth (`brandUrl(\`${slug}/booth\`)`).
  - Wifi join code (Phase 2: SSID + password + security inputs, encoded by `wifiQr.ts` as
    `WIFI:T:WPA;S:<ssid>;P:<pw>;;` with `\ ; , : "` escaped. The password is never saved).
  - Custom URL (must be `http(s)://`, validated).
  - The QR caption defaults to the short URL (`BRAND.domain/slug`).
- QR rendering: a `qrcode` data-URL `<img>` at about 2.5in / 64 mm, error correction M, 4-module quiet
  zone. Reuse `QRCode.tsx`, passing `margin={4}`, and give a large `size` so it stays sharp when printed.
- Sponsor logos:
  - Shown only when `canViewSponsors` (`allowedTabs` includes `partners`, or `'all'`).
  - Fetched with `getSponsors(party.id)` and filtered like `autoRegenPrint.ts` (`logoUrl` and status
    yes/paid).
  - The host can untick logos. Grid of up to 8, `object-fit: contain`.
  - On 403 or no sponsors, show a hint ("Add sponsors in Partners") instead of an error.
- Both sides: "Same on both sides" (default) or Phase 2 "Different back" (second content set).
- Copies: 1–20 tents. The same tent repeats one per page.

**Sheet:**
- Page = two panels.
- The top panel (`transform: rotate(180deg)`) and the bottom panel render the same `TentFace`
  component.
- Fold line is dashed grey.

### Shared pieces

- `print/printSheet.tsx`: `PrintPortal`, `usePrintSheets()` (described above), and
  `PrintPreview` (scaled on-screen pages, pagination, a "Show cut lines" toggle).
- `print/useBrandLogo.ts` (or an inline helper): returns `BRAND.logoUrl` and the event image choice.
- No hardcoded domains. All URLs come from `brandUrl()` / `flyerEventUrl()`. No PizzaDAO-specific
  art in the builders, so branded builds look neutral.

### Wiring changes

- `frontend/src/pages/HostPage.tsx`: `<PrintTab canViewGuests={...} canViewSponsors={...} />`, computed
  from the existing `allowedTabs` memo (owners/admins → `'all'`).
- `frontend/src/components/print/PrintTab.tsx`:
  - New optional props (default `false`, so `/shipping`'s `PrintMaterials` never shows guest data).
  - Render `<NametagBuilder>` and `<TableTentBuilder>` only inside `PrintTab` (needs `party`), never in
    `PrintContent`.
  - Move the static NAME_TAGS / TABLE_TENTS cards under "Ready-made templates" inside each builder
    section, or leave them in `PrintContent` (Q6).
- `frontend/src/components/AppsHub.tsx`: update the print app description (e.g. "Name badges, table
  tents, stickers & flyers").
- `frontend/src/lib/appDefinitions.ts`: no change (the names already say Print / Nametags).
- **No change** to `tabPermissions.ts`, `partyAccess.ts` `VALID_TAB_IDS`, `broadcastApps.ts`, the
  Prisma schema, or migrations. No backend change at all.

### i18n

- New keys in `frontend/src/i18n/locales/{de,en,es,fr,ja,ko,pt,zh}/host.json` under
  `print.nametags.*`, `print.tents.*`, `print.sheet.*`:
  - UI labels.
  - Print instructions.
  - Preset defaults ("Scan to RSVP", "WiFi", "Thanks to our sponsors", "Co-host", "Host", "Partner").
  - The "write your name" line.
- Printed default text uses the **UI language** and is always editable. Role labels are translated.
  RSVP role values (`Dev`, `Leonardo`) print as stored.
- Use literal `t('print.nametags.x')` keys so `i18n-keys.test.ts` covers them. No template-literal
  keys.
- The existing hardcoded English in `PrintTab` (stickers etc.) is out of scope. It could be a small
  follow-up.
- CJK: test that `fitText` measures CJK strings properly in the preview (ja/zh/ko). Use a font stack
  like `"Inter", system-ui, "Hiragino Sans", "Noto Sans CJK JP", "Microsoft YaHei", sans-serif`.

## Phasing (smallest useful first)

**Phase 1 (one PR, frontend only):**
- Shared `printSheet` portal/preview/print, `layouts.ts`.
- Name badges:
  - Source: Everyone going / Approved / Checked in / Type names / Blanks only.
  - Name plus optional role line, event name and logo header.
  - Layouts: Avery 5395, Letter 8-up plain, A4 8-up plain.
  - Blank badges, preview, alignment test page.
- Table tents:
  - Letter/A4, both sides the same.
  - Presets RSVP and WiFi-as-text plus Custom.
  - QR to the event page / booth / custom URL, editable text.
- Privacy gates, i18n (8 locales), tests.

**Phase 2:**
- QR on badges (event page).
- Avery 5392 4"x3" inserts, plus the A4 label stock.
- "Pick guests" checklist with search.
- Per-badge text edits (pronouns/handle, kept in memory only).
- First/last split.
- Tent sponsor logo grid, different back side, wifi join QR.

**Phase 3 (each needs a separate OK):**
- Per-guest check-in QR on badges (`brandUrl(\`checkin/${inviteCode}/${guestId}\`)`, as in
  `CheckInQRDisplay`). Off by default. Needs Snax's OK because it is a guest-specific link.
- Volunteer/staff badges from Staffing (`staff` tab gate).
- Save builder settings per event.
- A pronouns RSVP field (own task).
- A menu tent from the pizza order.

## Files to change (Phase 1)

New:
- `frontend/src/components/print/printSheet.tsx` (PrintPortal, usePrintSheets, PrintPreview)
- `frontend/src/components/print/layouts.ts` (+ `layouts.test.ts`)
- `frontend/src/components/print/fitText.ts` (+ `fitText.test.ts`)
- `frontend/src/components/print/nametags/NametagBuilder.tsx`
- `frontend/src/components/print/nametags/NametagSheet.tsx`
- `frontend/src/components/print/nametags/nametagData.ts` (+ `nametagData.test.ts`)
- `frontend/src/components/print/nametags/NametagSheet.test.tsx`
- `frontend/src/components/print/tents/TableTentBuilder.tsx`
- `frontend/src/components/print/tents/TableTentSheet.tsx`
- `frontend/src/components/print/tents/tentPresets.ts` (+ `tentPresets.test.ts`)
- (Phase 2) `frontend/src/components/print/tents/wifiQr.ts` (+ test)

Edited:
- `frontend/src/components/print/PrintTab.tsx`
- `frontend/src/components/print/index.ts` (export the builders if needed)
- `frontend/src/pages/HostPage.tsx` (pass `canViewGuests` / `canViewSponsors`)
- `frontend/src/components/AppsHub.tsx` (description)
- `frontend/src/i18n/locales/{de,en,es,fr,ja,ko,pt,zh}/host.json`

## Tests

Vitest (jsdom; mock `qrcode` as `QRCode.test.tsx` does):
- `layouts.test.ts`: every layout's grid fits its page (numbers above). Avery 5395 slot positions
  match the spec. Paginating N badges gives `ceil(N / perPage)` pages.
- `nametagData.test.ts`:
  - Each source filter: waitlisted excluded, `approved===false` excluded, checked-in, approved-only.
  - Locale sorting. Dedupe. Empty-name skip.
  - Co-host/host/partner role matching (case-insensitive email).
  - The resulting badges have **no** email property.
  - Blank padding / "fill sheet" maths.
  - CJK names not split.
- `NametagSheet.test.tsx`:
  - Rendered output has no email strings (no `@` text).
  - With `canViewGuests=false` the builder never shows guest names from context, only typed names and
    blanks.
- `fitText.test.ts`: font size goes down as the name gets longer, clamped to min/max. Stub
  `measureText`.
- `tentPresets.test.ts`:
  - The QR URL for the event page equals `flyerEventUrl(party)`, with `BRAND.url` as the prefix (no
    hardcoded domain).
  - The booth URL is right.
  - Custom URLs are rejected unless http(s).
- Builders and the PrintTab render: `PrintMaterials` (shipping) renders no builder.
- `i18n-keys.test.ts` passes (literal keys).
- Existing `broadcastAppCatalog.test.ts` and `partyAccess.test.ts` still pass (unchanged).
- `npm run build` / `tsc` and lint pass. `brand-check` CI is green (no `rsv.pizza` in new code).

## Verification on the Vercel preview

1. `/ship` → preview URL. Sign in as the owner of a test event with at least 10 guests (some checked in,
   one waitlisted, one rejected, one co-host guest, a long name, a Japanese name).
2. `/host/<code>/print`:
   - The builders show. The preview paginates. Blanks add up. The role line shows Co-host on the right
     guest.
   - No emails visible anywhere.
3. Chrome → Print → "Save as PDF", Margins None, Scale 100%. Open the PDF and check:
   - The page is exactly 8.5x11in / A4.
   - Label positions match the Avery 5395 template (overlay the Avery template PDF, or print on plain
     paper and hold it against a label sheet). Same for the alignment test page.
   - Images and QR codes are present (not blank).
   - No app chrome, and no blank extra pages.
4. Repeat in Safari and Firefox; note any `@page size` quirks. On an iPhone, print/share from Safari
   (`/mobile-check` for the builder UI on a small screen).
5. Scan the tent QR code with a phone: it opens the event page on the preview's brand domain.
6. Co-host check:
   - A co-host restricted to `print` only: guest-source options are hidden, typed names and blanks
     work.
   - A co-host with `print` + `guests`: the full list shows.
   - Without `partners`: the sponsor grid shows the hint, no error toast.
7. Switch the UI language to ja and de: the UI is translated, the printed defaults are translated, CJK
   names fit.
8. White-label: a local build with `VITE_BRAND_DOMAIN=example.test VITE_BRAND_NAME=Test` (or a branded
   preview project): the QR caption and URL use that domain, and the header uses `BRAND.logoUrl`.
9. `/shipping` still shows only the static materials.

## Risks

- **Browser print scaling / margins:**
  - Chrome may default to "Fit to page", and some drivers add margins. That is what breaks label
    alignment.
  - Mitigations: `@page margin:0`, fixed-size pages, clear instructions, the alignment test page.
  - It's still the biggest support risk.
- **`@page size` support** varies (Safari has historically ignored or limited it).
  - Mitigation: we also size the page boxes ourselves. If Safari's paper setting doesn't match, the
    output is still at 100% scale with the right label geometry, as long as the host picks the right
    paper.
- **Printer non-printable margins** (about 0.125–0.25in): Avery 5395's 0.59in top margin is safe. Plain
  layouts are centred with a safe area. Tents keep content 0.3in in from the edges.
- **Images not loaded at print time** (logos, QR codes): await `img.decode()` and `document.fonts.ready`
  before `window.print()`. QR codes are data URLs.
- **Large guest lists** (500+ guests = 60+ pages): the on-screen preview renders only about 3 pages. The
  print root renders everything only while printing (mount on demand).
- **Dark theme leaking into print**: force `background:#fff; color:#000` in the print root, and render
  outside the themed containers via the portal.
- **Privacy:** guest names are already in any editor's browser (the API isn't tab-gated). The new gate is
  UI-only, the same as other tabs. That's acceptable because it creates no new exposure. If Snax wants
  it strict, a follow-up could tab-gate `GET /:id/guests` server-side (big blast radius; out of scope).
- **Avery numbers off by a fraction:** the implementer must check them against the official templates and
  cite the source in `layouts.ts`.
- **iOS `afterprint`** fires unreliably: add a fallback cleanup timeout and also clean up on unmount.

## Repo conventions the implementer must follow (CLAUDE.md)

- All text inputs and textareas go through `IconInput` (`multiline` for the manual-names box and tent
  body). All toggles go through `Checkbox`. No raw `<input>`, `<textarea>` or checkboxes.
- Use placeholders, not `<label>` elements. Helper text goes below in `text-xs text-white/40` only
  where needed. The radio-style choices (source, layout, paper, preset) should be segmented buttons,
  like the existing pill toggles.
- Branch `neapolitan-93690-print-widgets` (no `feature/` prefix). Default branch is `master`.
- Previews share the prod backend/DB. This plan needs no backend or DB changes, so previews work as-is.
- The CI lint gate is `react-hooks/rules-of-hooks`: keep every hook above any early return (e.g. the
  `!party` guard in the builders).

## Out of scope

- Server-side PDF generation.
- New DB fields (pronouns/handles/custom questions).
- Translating the existing static PrintTab strings.
- Changing the co-host permission model.
- Changing the static PDF assets.
