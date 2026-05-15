# neapolitan-84274: Add SWC Brazil RSVP opt-in checkbox (swcbr tag)

**Priority:** P2
**Status:** Doing

## Problem

Events tagged `swc`, `swceu`, `swcuk`, `swcau`, and `swccanada` each show a Stand With Crypto opt-in checkbox + info modal on the RSVP form step 1. Events tagged `swcbr` (Stand With Crypto Brazil / "Juntos por Cripto") have no such checkbox — Brazil is the only regional SWC tag that isn't wired up.

`swcbr` already exists in the codebase as a sponsor-logo option in `frontend/src/components/print/PrintTab.tsx:53` (printable flyer), so the tag itself is in use — only the RSVP opt-in is missing.

## Solution

Mirror the existing `swcuk` pattern exactly: add a `swc_br_opt_in` field end-to-end and render an opt-in checkbox + info modal on RSVP step 1 when the event has the `swcbr` tag.

URLs for the modal (provided by Snax):
- Privacy: `https://www.juntosporcripto.org/br/privacy`
- Terms: `https://www.juntosporcripto.org/br/terms-of-service`

## Database migration

Create `supabase/migrations/20260514_add_swc_br_opt_in.sql`:

```sql
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS swc_br_opt_in BOOLEAN NOT NULL DEFAULT false;

-- Column-level SELECT grant (Feb 2026 security audit pattern)
GRANT SELECT (swc_br_opt_in) ON guests TO anon, authenticated;
```

Apply via `mcp__supabase-pizzadao__apply_migration` after PR merge. **Must be applied to prod before the preview will work end-to-end** — see [[architecture_two_patch_field_lists]] / preview-share-prod rule in CLAUDE.md.

(Note: the existing 5 `swc_*_opt_in` columns aren't visible in `supabase/migrations/`, so the `guests` grants for them may already be table-level. Confirm during implementation whether the column-level grant is needed; if `guests` still uses table-level SELECT, the explicit `GRANT SELECT (col)` is harmless but optional. Mirror whatever pattern the existing 5 columns use.)

## Files to modify

### Backend

**`backend/prisma/schema.prisma`** (around line 224, in the `Guest` model)
Add after `swcUkOptIn`:
```prisma
swcBrOptIn          Boolean  @default(false) @map("swc_br_opt_in")
```

**`backend/src/routes/rsvp.routes.ts`** — 3 spots (mirror `swcUkOptIn`)
- Destructure from `req.body` (around line 260)
- Add to the update payload (around line 420)
- Add to the create payload (around line 484)

### Frontend

**`frontend/src/lib/supabase.ts`** — 4 spots (mirror `swcUkOptIn` / `swc_uk_opt_in`)
- Add `swc_br_opt_in?: boolean;` to the `Guest` row interface (around line 697)
- Add `swcBrOptIn?: boolean,` parameter to `addGuestToParty` signature (around line 1246)
- Add `swcBrOptIn: swcBrOptIn || false,` to the API payload (around line 1275)
- Add `swc_br_opt_in: swcBrOptIn || false,` to the Supabase fallback insert (around line 1308)

**`frontend/src/hooks/useRSVPForm.ts`** — mirror every `swcUkOptIn` reference:
- State (line 126–127): `const [swcBrOptIn, setSwcBrOptIn] = useState(false);` + `const [showSwcBrInfoModal, setShowSwcBrInfoModal] = useState(false);`
- Computed flag (line 163): `const isSwcBrEvent = (eventData.eventTags || []).includes('swcbr');`
- Pass to `addGuestToParty` (line 410): add `swcBrOptIn || undefined,` after `swcUkOptIn`
- Dependency array (line 452): add `swcBrOptIn`
- Return object: add `swcBrOptIn`, `setSwcBrOptIn`, `showSwcBrInfoModal`, `setShowSwcBrInfoModal`, and `isSwcBrEvent`

**`frontend/src/components/RSVPFormStep1.tsx`** — add a new `{form.isSwcBrEvent && (...)}` block immediately after the SWC UK block (which ends ~line 514, before the ETHConf block at line 516). Copy the SWC UK markup verbatim and swap:
- `isSwcUkEvent` → `isSwcBrEvent`
- `swcUkOptIn` / `setSwcUkOptIn` → `swcBrOptIn` / `setSwcBrOptIn`
- `showSwcUkInfoModal` / `setShowSwcUkInfoModal` → `showSwcBrInfoModal` / `setShowSwcBrInfoModal`
- Privacy URL → `https://www.juntosporcripto.org/br/privacy`
- Terms URL → `https://www.juntosporcripto.org/br/terms-of-service`
- Translation keys → `swcBrModal.title`, `swcBrModal.description`, `swcBrModal.privacyPolicy`, `swcBrModal.termsOfService` (the checkbox label reuses the existing `step1.swcNotify` key — same as UK/EU/AU/CA)

### i18n (all 7 locales)

Add a `swcBrModal` block after `swcUkModal` in each of:
- `frontend/src/i18n/locales/en/rsvp.json`
- `frontend/src/i18n/locales/de/rsvp.json`
- `frontend/src/i18n/locales/es/rsvp.json`
- `frontend/src/i18n/locales/fr/rsvp.json`
- `frontend/src/i18n/locales/ja/rsvp.json`
- `frontend/src/i18n/locales/pt/rsvp.json`
- `frontend/src/i18n/locales/zh/rsvp.json`

**English template** (model others on this — translate the description body, keep URLs and title sensible per locale):
```json
"swcBrModal": {
  "title": "Stand with Crypto Brazil",
  "description": "By checking the box, you consent to receive communications from Stand with Crypto about future events and advocacy efforts in Brazil. You understand that SWC and its vendors may collect and use your personal information. To learn more, visit",
  "privacyPolicy": "SWC Brazil Privacy Policy",
  "termsOfService": "Terms of Service"
}
```

For pt-BR specifically, use natural Brazilian Portuguese branding (the SWC Brazil chapter is "Juntos por Cripto"). Suggested:
```json
"swcBrModal": {
  "title": "Juntos por Cripto",
  "description": "Ao marcar a caixa, você consente em receber comunicações da Juntos por Cripto sobre eventos futuros e ações de advocacy no Brasil. Você entende que a SWC e seus parceiros podem coletar e utilizar suas informações pessoais. Para saber mais, acesse",
  "privacyPolicy": "Política de Privacidade",
  "termsOfService": "Termos de Serviço"
}
```

For the other 5 locales, translate consistently with how each of those files translates the existing `swcUkModal` entry (same translator voice).

No `step1.*` keys need to change — the checkbox reuses `step1.swcNotify` ("Notify me about future Stand With Crypto events.") which is already shared by UK/EU/AU/CA.

## Step-by-step

1. Migration file + apply via MCP after merge.
2. Prisma schema edit.
3. Backend route: destructure + 2 payload spots.
4. `supabase.ts`: 4 edits.
5. `useRSVPForm.ts`: state, flag, submit args, deps, return.
6. `RSVPFormStep1.tsx`: clone SWC UK block, swap names + URLs.
7. Add `swcBrModal` to all 7 rsvp.json locales (translated appropriately).
8. Run `npm run build` in `frontend/` to confirm no TS errors.
9. Commit, push, draft PR, verify Vercel deploy.

## Verification

1. Vercel preview builds.
2. On the preview, open an event whose `eventTags` includes `"swcbr"` (or temporarily add it to a test event). The SWC Brazil checkbox + info button should appear between SWC UK (won't show unless also tagged) and ETHConf.
3. Click the info button → modal opens with the Juntos por Cripto title, description, and two links (privacy + terms) pointing to `juntosporcripto.org/br/...`. Both links open in a new tab.
4. Toggle the checkbox, RSVP, then check the DB: `guests.swc_br_opt_in` should be `true` for that row. (Note: backend route + DB column only land in master, so step 4 must be tested against master/prod after merge + migration apply + backend deploy.)
5. Confirm events **without** the `swcbr` tag do **not** show the checkbox.
6. Confirm all other SWC checkboxes (US/CA/AU/EU/UK) still render and submit correctly — regression check.
7. Switch language to pt — modal copy should be the Brazilian Portuguese translation.

## Post-merge tasks (manual)

- Apply migration via `mcp__supabase-pizzadao__apply_migration`.
- Deploy backend: `cd backend && vercel --prod --scope pizza-dao` (touches `backend/`).
- (Optional) Add `swcbr` sponsor row / equivalent logic to any other places where SWC chapters are enumerated (e.g., sponsor lookups in `EventPage.tsx:1154`) — flag as out-of-scope follow-up if not in scope.

## Out of scope

- Adding a sponsor description for SWC Brazil to `event.json` (would parallel `sponsorDescription.swcEu`).
- Wiring `swcbr` into the EventPage sponsor recognition lookup at `EventPage.tsx:1154`.
- Sending the opt-in data to any SWC Brazil API — currently all SWC opt-ins are passive flags on the guest row; nothing pushes them externally.
