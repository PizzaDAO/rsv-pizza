# margherita-82196: Refactor sponsor intake → partner intake + share form with modal

**Priority**: P2
**Type**: Refactor + Rename (feature premise is already shipped)

## Summary

Rename every user-visible instance of "Sponsor Intake" to "Partner Intake" across the app (route, link text, button labels, page heading) while leaving the DB/Prisma model and internal "sponsor" identifiers untouched. At the same time, delete the ~240 lines of copy-pasted form markup in `SponsorIntakePage` and replace it with the already-existing shared `PartnerForm` component (currently used by `SponsorCRM`, `FlyerGenerator`, and the `PartnerManager` on the underboss dashboard). A new `intake` mode will be added to `PartnerForm` so the public page renders the same fields without the modal chrome or CRM-only sections.

**Note on premise #2 ("add brand description field to intake"):** `brandDescription` is ALREADY present on the intake form, the backend, and the DB. See `frontend/src/pages/SponsorIntakePage.tsx:297-304` and `backend/src/routes/sponsor-intake.routes.ts:201-203`. No new field work is needed; the apparent drift Snax noticed will be resolved automatically as a byproduct of consolidating the two form implementations onto a single source of truth.

## Current state

### Sponsor intake page (public)
- **Route**: `/sponsor-intake/:token` — `frontend/src/App.tsx:57`
- **Component file**: `frontend/src/pages/SponsorIntakePage.tsx` (482 lines; ~240 are hand-rolled form JSX)
- **Fields currently collected**:
  1. `name` (required) — Company / Brand Name — IconInput
  2. `website` — Website — IconInput url
  3. `brandTwitter` — Brand X Handle — IconInput w/ custom XIcon
  4. `brandInstagram` — Brand Instagram Handle — IconInput w/ custom InstagramIcon
  5. `brandDescription` — "1-2 sentences about your brand" — IconInput multiline rows=2 (**already present**)
  6. `contactName` — Contact Name — IconInput
  7. `contactEmail` — Email — IconInput email
  8. `contactPhone` — Phone — IconInput tel
  9. `contactTwitter` — Contact X Handle — IconInput w/ XIcon
  10. `telegram` — Telegram — IconInput w/ TelegramIcon
  11. `sponsorshipType` — Contribution Type — native `<select>` (cash/in-kind/venue/pizza/drinks/other)
  12. `productService` — Product/Service Description — IconInput
  13. `logoUrl` (+ file upload) — Logo — upload button + URL input
  14. `sponsorMessage` — "Any notes or special requests..." — IconInput multiline rows=3
- **Submit endpoint**: `POST /api/sponsor-intake/:token` (public, token-gated) — `backend/src/routes/sponsor-intake.routes.ts:167`
- **Read endpoint**: `GET /api/sponsor-intake/:token` — prefills form from existing sponsor record
- **Where linked from**: via copied URL from `SponsorIntakeButton` (`frontend/src/components/sponsors/SponsorIntakeButton.tsx`), which is rendered inside `SponsorList` (row actions) and `PartnerForm` (CRM mode, inside the "Intake Form" section). There is **no direct nav/sidebar link** to this page — the host generates a token and copies the URL to share with the sponsor manually.
- **Auth**: Public (token-gated). Invalid / revoked token → "Link Not Found" screen.

### "Add sponsor" modal (host-side)
- **Component file**: `frontend/src/components/sponsors/PartnerForm.tsx` (929 lines, already shared)
- **Rendered from**:
  - `frontend/src/components/sponsors/SponsorCRM.tsx:189` ("Add Partner" button — Host Page → Sponsors tab)
  - `frontend/src/components/flyer/FlyerGenerator.tsx:1227` ("Add sponsor" from the flyer generator)
  - `frontend/src/components/underboss/PartnerManager.tsx:250` (underboss-level partner CRM, uses `mode='partner'`)
- **Current modes**: `'crm' | 'partner'` (driven by `mode` prop)
- **Fields in CRM mode** (in order): name, website, brandTwitter, brandInstagram, **brandDescription** (multiline, placeholder `"1-2 sentence description"`), pointPerson, contactName, contactEmail, contactPhone, contactTwitter, telegram, status, lastContactedAt, amount, sponsorshipType, productService, logoUrl (+upload), (sponsorMessage read-only if already submitted), intakeToken widget, notes
- **Brand description field specifics** (`PartnerForm.tsx:495-503`):
  - Field name: `brandDescription`
  - Component: `IconInput` with `icon={FileText}` `multiline rows={2}`
  - Placeholder: `"1-2 sentence description"`
  - No length validation on the frontend; backend stores as nullable `String?` (no cap).
- **Submit endpoint** (CRM mode): `POST /api/parties/:partyId/sponsors` (create) / `PATCH /api/parties/:partyId/sponsors/:sponsorId` (update) — `backend/src/routes/sponsor.routes.ts`
- **Submit endpoint** (partner mode via underboss): `POST /api/partners` etc. — `backend/src/routes/user.routes.ts` area
- **Chrome**: fixed backdrop + modal card + close button (`PartnerForm.tsx:393-414`)

### Sponsor DB model
- **File**: `backend/prisma/schema.prisma:816-866`
- **Current fields** (summary): `id`, `partyId`, `name`, `website`, `brandTwitter`, `brandInstagram`, **`brandDescription`** (line 826), `pointPerson`, `contactName`, `contactEmail`, `contactPhone`, `contactTwitter`, `telegram`, `status`, `amount`, `sponsorshipType`, `productService`, `logoUrl`, `sortOrder`, `notes`, `lastContactedAt`, `intakeToken`, `intakeSubmittedAt`, `sponsorMessage`, `createdAt`, `updatedAt`.
- **`brandDescription` exists**: YES — column `brand_description` on `sponsors` table, added in migration `supabase/migrations/20260325_sponsor_intake_fields.sql`.
- **No DB changes needed. No Prisma changes needed. The 6-places gotcha does NOT apply** (sponsor is a distinct model, not a Party column).

## Proposed shared component

### Decision: extend `PartnerForm`, don't create a new component

`PartnerForm.tsx` already has `mode: 'crm' | 'partner'` and cleanly conditionalizes sections. Adding a third mode (`'intake'`) is less churn than extracting a new sub-component. Also keeps a single place to evolve the sponsor form schema.

### New mode: `mode: 'crm' | 'partner' | 'intake'`

In `intake` mode, `PartnerForm` will:
1. Skip the modal wrapper (`fixed inset-0 bg-black/60 ...`) and render a plain `<form>` designed to be embedded in a page layout.
2. Show only intake-appropriate sections: Company Info (incl. brandDescription), Contact Info, Sponsorship Details (sponsorshipType + productService), Logo, Sponsor Message ("Message to Host").
3. Hide: pointPerson, pipeline (status + lastContactedAt), amount, intake link widget, notes (notes is the host-side CRM notes, NOT sponsorMessage), automation (partner-only), co-host profile (partner-only), account/tag (partner-only).
4. Hide the modal close button. The submit button is full-width and uses the intake copy ("Submit" / "Update Information" / "Submitting...").
5. Initialize from a new `intakeData` prop (type = result of `getSponsorIntake`) instead of `sponsor` or `partnerData`.
6. Accept a different submit handler signature via the same `onSubmit(data: PartnerFormData)` contract — the intake page wraps `submitSponsorIntake(token, ...)` in a function that matches it.

### Component API (revised `PartnerFormProps`)

```tsx
interface PartnerFormProps {
  mode?: 'crm' | 'partner' | 'intake';
  onSubmit: (data: PartnerFormData) => Promise<void>;
  onClose?: () => void;           // optional in intake mode (no modal)
  isLoading?: boolean;
  defaultStatus?: SponsorStatus;  // CRM only

  // CRM mode
  sponsor?: Sponsor | null;
  partyId?: string;
  onSponsorUpdate?: (sponsor: Sponsor) => void;

  // Partner mode (unchanged)
  partnerData?: SponsorUser | null;
  syncMessage?: string | null;

  // Intake mode (new)
  intakeInitialData?: SponsorIntakeResponse['sponsor'] | null;
  eventName?: string;             // for header / copy
  submitLabel?: string;           // override button text (optional)
  wasPreviouslySubmitted?: boolean;
}
```

### Fields rendered (intake mode, in order)

1. `name` — required — IconInput — placeholder "Company / Brand Name"
2. `website` — IconInput url — "Website"
3. `brandTwitter` — IconInput + XIcon — "Brand X Handle"
4. `brandInstagram` — IconInput + InstagramIcon — "Brand Instagram Handle"
5. `brandDescription` — IconInput multiline rows=2 — "1-2 sentence description" (or the conversational intake variant)
6. `contactName` — IconInput — "Contact Name"
7. `contactEmail` — IconInput email — "Email"
8. `contactPhone` — IconInput tel — "Phone"
9. `contactTwitter` — IconInput + XIcon — "Contact X Handle"
10. `telegram` — IconInput + TelegramIcon — "Telegram"
11. `sponsorshipType` — native select — "Contribution Type"
12. `productService` — IconInput — "Product/Service Description"
13. `logoUrl` (+ upload) — logo upload block (shared code with CRM logo block)
14. `sponsorMessage` — IconInput multiline rows=3 — "Any notes or special requests for the event organizer..." (labeled "Message to Host" in section header, different from CRM `notes`)

### Fields unique to each mode

| Field | crm | partner | intake |
|---|---|---|---|
| name, website, brandTwitter, brandInstagram, brandDescription, logoUrl | yes | yes | yes |
| contactName, contactEmail, contactPhone, contactTwitter, telegram | yes | — | yes |
| pointPerson, status, lastContactedAt, amount | yes | — | — |
| sponsorshipType, productService | yes | — | yes |
| sponsorMessage (writable) | read-only display | — | yes (writable) |
| notes (host CRM notes) | yes | yes | — |
| email, tag, contactPersonName, coHostAvatarUrl | — | yes | — |
| autoCoHost, autoSponsor, coHost* permissions | — | yes | — |
| intake link widget | yes | — | — |

### Where the component lives
No move needed. Stays at `frontend/src/components/sponsors/PartnerForm.tsx`.

## Data model changes
- [ ] DB migration — **not needed** (brandDescription already exists)
- [ ] Prisma schema — not needed
- [ ] Backend POST/PATCH handler — not needed (sponsor-intake.routes.ts already accepts brandDescription)
- [ ] `updateParty` field list — N/A (sponsor is a separate model)
- [ ] `dbPartyToParty` mapper — N/A
- [ ] `DbParty` interface — N/A
- [ ] `safeColumns` — N/A

## Files to create
None. No new component files. This is pure refactoring + renaming.

## Files to modify

### Frontend — naming changes (URL + label)

- `frontend/src/App.tsx`
  - Add route `/partner-intake/:token` pointing at the (possibly renamed) intake page component.
  - Add redirect route `/sponsor-intake/:token` → wrapper that reads `useParams().token` and returns `<Navigate to={`/partner-intake/${token}`} replace />`. Inline component definition in `App.tsx` is fine.

- `frontend/src/pages/SponsorIntakePage.tsx`
  - **Rename to** `frontend/src/pages/PartnerIntakePage.tsx` (use git mv to preserve history). Export renamed to `PartnerIntakePage`. Import in `App.tsx` updated.
  - Delete the ~240 lines of hand-rolled form JSX. Keep only: `token` param, `loadData` effect, `eventName`, `previouslySubmitted`, loading/notFound/submitted state screens, page header, `<PartnerForm mode="intake" ... />`, and the wrapper `div` + footer.
  - `handleSubmit` becomes a simple wrapper around `submitSponsorIntake(token, { ...formData })`. Logo upload is moved INTO `PartnerForm` (already handled there for CRM mode).
  - Update the "Link Not Found" copy from "sponsor intake link" → "partner intake link".
  - Update the "Thank You!" body copy to say "partner information".

- `frontend/src/components/sponsors/PartnerForm.tsx`
  - Add `mode='intake'` branch (see "New mode" section above).
  - Add `intakeInitialData` / `eventName` / `wasPreviouslySubmitted` props.
  - When `mode='intake'`: return a non-modal `<form>` (no `fixed inset-0` wrapper, no close button, no modal card chrome).
  - Initialize `formData` from `intakeInitialData` instead of `sponsor`/`partnerData`.
  - Section conditionals: show Company Info, Contact Info, Sponsorship Details (sponsorshipType + productService), Logo, Message to Host. Hide everything else.
  - Submit button: full-width, intake copy. Use `submitLabel` prop override if provided.
  - Update user-visible "sponsor" → "partner" wording inside the CRM intake-link widget (lines 869-871): "Partner has submitted their intake form" / "Waiting for partner to fill out intake form" / "Generate a link for the partner to fill out their details".
  - Section title "Intake Form" (line 858) → "Partner Intake Form".

- `frontend/src/components/sponsors/SponsorIntakeButton.tsx`
  - Rename file to `PartnerIntakeButton.tsx` (git mv). Update component name and prop interface.
  - Update generated URL: `https://rsv.pizza/sponsor-intake/${token}` → `https://rsv.pizza/partner-intake/${token}` (line 18).
  - Update title attribute "Generate intake form link" → "Generate partner intake form link".
  - Update imports in `SponsorList.tsx` and `PartnerForm.tsx` and `components/sponsors/index.ts`.

- `frontend/src/components/sponsors/SponsorList.tsx`
  - Update import of `SponsorIntakeButton` → `PartnerIntakeButton` (line 7, line 328).

- `frontend/src/components/sponsors/index.ts`
  - Add export for `PartnerIntakeButton`.

- `frontend/src/lib/api.ts`
  - **Leave as-is**. `SponsorIntakeData`, `getSponsorIntake`, `submitSponsorIntake`, `generateSponsorIntakeToken`, `revokeSponsorIntakeToken` are internal names matching the backend route. Renaming cascades into backend + forces a backend-redeploy-before-frontend dance. (Open question.)

### Frontend — no-op files (intentionally NOT touched)

- `frontend/src/components/underboss/PartnerManager.tsx` — already uses `PartnerForm` in partner mode.
- `frontend/src/components/flyer/FlyerGenerator.tsx` — already uses `PartnerForm` in crm mode.
- `frontend/src/components/sponsors/SponsorCRM.tsx` — already uses `PartnerForm` in crm mode; the "Add Partner" button and "Partners" heading are already correctly named.

### Backend — naming changes

**Default: leave backend paths and filenames alone.** Renaming `/api/sponsor-intake/*` → `/api/partner-intake/*` means modifying the backend route file, updating `backend/src/index.ts`, updating all four functions in `frontend/src/lib/api.ts`, and **redeploying the backend to master before the frontend PR can work on preview** (per CLAUDE.md: preview deploys share production backend). Zero user-visible value since nobody sees `/api/*` paths.

### Tests
- No existing tests for `SponsorIntakePage`, `PartnerForm`, `SponsorIntakeButton`, or the `/sponsor-intake` backend route. Nothing to update.

## Step-by-step implementation

1. **Extend `PartnerForm`** to support `mode='intake'`:
   - Add `'intake'` to the mode type.
   - Add `intakeInitialData`, `eventName`, `wasPreviouslySubmitted`, `submitLabel` props.
   - Add an `intakeDataToFormData(intakeInitialData)` init helper modeled on `sponsorToFormData`.
   - Add an `isIntake` conditional path that renders "Message to Host" as an editable input (intake writes `sponsorMessage`).
   - Wrap the `<form>` in either the modal chrome (crm/partner) OR a plain container (intake), driven by `isIntake`.
   - Submit button: full-width on intake, intake copy.

2. **Rename `SponsorIntakeButton.tsx` → `PartnerIntakeButton.tsx`** (git mv). Update component name, interface name, generated URL (`partner-intake`), title attribute, and imports in `SponsorList.tsx`, `PartnerForm.tsx`, `components/sponsors/index.ts`.

3. **Rename `SponsorIntakePage.tsx` → `PartnerIntakePage.tsx`** (git mv). Strip the hand-rolled form JSX. Replace the `<form>` block with `<PartnerForm mode="intake" intakeInitialData={...} eventName={eventName} wasPreviouslySubmitted={previouslySubmitted} onSubmit={...} />`.
   - Add a small helper `partnerFormDataToIntakeData(data): SponsorIntakeData` (inline in the page, or next to `extractSponsorData` in `PartnerForm.tsx`).
   - Update "Link Not Found" and "Thank You!" body copy to say "partner".

4. **Update `App.tsx`**:
   - Import renamed `PartnerIntakePage`.
   - Add route `<Route path="/partner-intake/:token" element={<PartnerIntakePage />} />`.
   - Add legacy redirect wrapper for `/sponsor-intake/:token` that forwards the token param.

5. **Update user-visible "sponsor intake" text in `PartnerForm.tsx`** (lines 869-871, 858) → "partner" wording.

6. **Grep audit pass** after code is written:
   - `grep -rn "sponsor-intake" frontend/src` → only `lib/api.ts` (internal) and the legacy redirect in `App.tsx` should remain.
   - `grep -rn "Sponsor Intake" frontend/src` → no matches expected.
   - `grep -rn "SponsorIntakeButton" frontend/src` → no matches.
   - `grep -rn "SponsorIntakePage" frontend/src` → no matches.

7. **Build + lint + typecheck** locally (`npm run build` in frontend).

8. **Manual QA** on Vercel preview.

9. **Ship as draft PR**. Backend doesn't need to redeploy (no backend changes).

## Verification steps

- Host page → Partners tab → click "Add Partner" → modal opens with brandDescription field → fill out → save → persists.
- Same Partners tab row → click "Intake Link" → token generated. Click "Open Link" → new tab with intake page at `/partner-intake/{token}`.
- Old URL `/sponsor-intake/{token}` should redirect to `/partner-intake/{token}`. Test both.
- Intake page displays: header "Thanks for partnering with {eventName}!", form with company info (incl. brandDescription), contact info, sponsorship details, logo, message to host, full-width Submit button.
- Fill brandDescription, upload logo, submit. Confirm:
  - Success screen renders.
  - Re-opening the intake URL shows the submitted data prefilled.
  - Host CRM → edit the sponsor → brandDescription is populated with the intake submission's value.
- Underboss `/underboss` → Partners → Edit → confirm brandDescription is present (partner mode already supported this; confirming no regression).
- Mobile-width (< 768px) layout test for intake page.
- Legacy `/sponsor-intake/:token` redirect doesn't break existing copied URLs.

## Decisions (locked in 2026-04-11 with Snax)

1. **Backend route rename** `/api/sponsor-intake` → `/api/partner-intake`: **YES**
2. **`lib/api.ts` internal function names** → partner-named: **YES** (follows #1)
3. **File renames** `SponsorIntakePage.tsx` → `PartnerIntakePage.tsx`, `SponsorIntakeButton.tsx` → `PartnerIntakeButton.tsx`: **YES** (use `git mv`)
4. **`SponsorIntakeButton` visible label** "Intake Link": **KEEP** (already generic)
5. **`PartnerForm` CRM-mode section title** "Intake Form" → "Partner Intake Form": **YES**
6. **`brandDescription` placeholder**: **STANDARDIZE** to `"1-2 sentence description"` everywhere
7. **PartnerForm smoke test** for intake mode: **YES** — use existing vitest + React Testing Library infra. Reference `frontend/src/components/RSVPModal.test.tsx` for component-test patterns. Test should render `PartnerForm mode="intake"` with a stub `intakeInitialData`, assert intake-specific fields are present (name, brandDescription, sponsorMessage writable), assert non-intake sections are hidden (status, amount, notes, intake link widget, partner/automation), and call `onSubmit` with a shaped payload.

## Deploy strategy: TWO PRs

Because backend renames require master-deploy before preview frontends can hit them:

### PR #1 (backend-only)
- Branch: `margherita-82196-backend-rename` off `master`
- Scope:
  - Rename `backend/src/routes/sponsor-intake.routes.ts` → `partner-intake.routes.ts` (`git mv`)
  - Rename exported router var if any (`sponsorIntakeRoutes` → `partnerIntakeRoutes`)
  - Update `backend/src/index.ts` to mount `/api/partner-intake` (and KEEP `/api/sponsor-intake` as an ALIAS mounting the same handler, so in-flight frontend on master still works during the brief window between PR #1 merge and PR #2 merge)
  - Update `frontend/src/lib/api.ts`:
    - Rename types: `SponsorIntakeData` → `PartnerIntakeData`, `SponsorIntakeResponse` → `PartnerIntakeResponse`
    - Rename functions: `getSponsorIntake` → `getPartnerIntake`, `submitSponsorIntake` → `submitPartnerIntake`, `generateSponsorIntakeToken` → `generatePartnerIntakeToken`, `revokeSponsorIntakeToken` → `revokePartnerIntakeToken`
    - Update hardcoded fetch paths from `/api/sponsor-intake` → `/api/partner-intake`
    - Re-export old names as deprecated aliases pointing to the new ones to avoid breaking the frontend callsites that ship in PR #2
  - Update any frontend callsites that break from the type renames — should be ONLY `SponsorIntakePage.tsx` since that's the one consumer of these helpers. Minimal churn: just swap import names.
- Merge PR #1 to master → manually deploy backend (`cd backend && vercel --prod --scope pizza-dao`) → verify `/api/partner-intake` returns 200 on prod.
- Legacy alias `/api/sponsor-intake` stays in backend code for now; removed in a follow-up.

### PR #2 (frontend refactor)
- Branch: `margherita-82196-partner-intake` off `master` (after PR #1 is merged + deployed)
- Scope: everything else in this plan — file renames, routes, `PartnerForm` intake mode, redirect, smoke test, copy updates.

## Open questions
All resolved. See Decisions section above.

## Gotchas

- **Premise 2 is already shipped**: `brandDescription` is already present on the intake page, in `SponsorIntakeData`, in the backend handler, and in the Prisma schema. Added in migration `20260325_sponsor_intake_fields.sql`. Satisfied purely as a side-effect of deduplicating onto `PartnerForm`.
- **`PartnerForm` is already shared**: used by `SponsorCRM`, `FlyerGenerator`, `PartnerManager`. The refactor makes the intake page the fourth callsite, not an extraction from scratch.
- **`PartnerForm.tsx` is 929 lines.** Adding a third mode will push it larger. Consider a follow-up refactor (split `PartnerForm` into mode-specific sub-components) out of scope here.
- **`notes` vs `sponsorMessage`**: different DB columns. `notes` = host CRM notes. `sponsorMessage` = message from sponsor to host. Intake writes `sponsorMessage`; CRM shows it read-only. Don't conflate.
- **react-router-dom `<Navigate>` doesn't forward path params.** Legacy redirect needs a wrapper component that reads `useParams().token` and builds the target URL.
- **Hardcoded `sponsor-intake` URL in `SponsorIntakeButton.tsx:18`** — easy to miss.
- **Backend `sponsor-intake.routes.ts:58 and :72`** still returns an URL containing `/sponsor-intake/` in the generate-token response. The frontend ignores this and builds its own at `SponsorIntakeButton.tsx:17-19`. Dormant drift — note in PR for follow-up.
- **Intake page has duplicate inline X/Instagram/Telegram SVG components** that also exist in `PartnerForm.tsx`. Deleted automatically as part of the consolidation.
