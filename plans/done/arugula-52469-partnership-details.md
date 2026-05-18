# arugula-52469 — Rename "Sponsorship Details" to "Partnership Details" + add `community` contribution type

**Priority**: P2 (label rename + small enum extension across frontend + backend allowlists)

## Goal

Two coupled changes shipped together:
1. Rename the user-visible label **"Sponsorship Details"** to **"Partnership Details"** across the partner-intake form and all 7 i18n locales.
2. Add `'community'` as a new contribution type, surfacing in both the partner-intake form (`PartnerForm` intake mode) and the CRM type dropdown (same `TYPE_OPTIONS` array — used by both).

Data-model identifiers (`SponsorshipType`, `sponsorshipType`, `sponsorship_type`, `Sponsor` model, etc.) stay untouched — they are stable identifiers, not user-facing copy. Only UI strings change.

## Audit findings — every "Sponsorship" occurrence in `frontend/src`

| # | Surface | File:line | Current text/key | Decision | Rationale |
|---|---|---|---|---|---|
| 1 | **i18n key + value (en)** | `frontend/src/i18n/locales/en/host.json:302` | `"sponsorshipDetails": "Sponsorship Details"` | **Rename key to `partnershipDetails`** AND update value to `"Partnership Details"` | Snax approved key rename for naming consistency with the new value. |
| 2 | i18n key + value (zh) | `frontend/src/i18n/locales/zh/host.json:302` | `"sponsorshipDetails": "赞助详情"` | **Rename key + value** | Translation |
| 3 | i18n key + value (ja) | `frontend/src/i18n/locales/ja/host.json:302` | `"sponsorshipDetails": "スポンサーシップ詳細"` | **Rename key + value** | Translation |
| 4 | i18n key + value (es) | `frontend/src/i18n/locales/es/host.json:302` | `"sponsorshipDetails": "Detalles del Patrocinio"` | **Rename key + value** | Translation |
| 5 | i18n key + value (fr) | `frontend/src/i18n/locales/fr/host.json:302` | `"sponsorshipDetails": "Détails du parrainage"` | **Rename key + value** | Translation |
| 6 | i18n key + value (de) | `frontend/src/i18n/locales/de/host.json:302` | `"sponsorshipDetails": "Sponsoring-Details"` | **Rename key + value** | Translation |
| 7 | i18n key + value (pt) | `frontend/src/i18n/locales/pt/host.json:302` | `"sponsorshipDetails": "Detalhes do Patrocínio"` | **Rename key + value** | Translation |
| 8 | Section header (rendered) | `frontend/src/components/sponsors/PartnerForm.tsx:757` | `{t('sponsors.sponsorshipDetails')}` | **Update to `t('sponsors.partnershipDetails')`** | Consumer must match the renamed key |
| 9 | Section comment | `frontend/src/components/sponsors/PartnerForm.tsx:752` | `{/* Sponsorship Details — Intake mode only ... */}` | **Update comment** to "Partnership Details" | Keeps inline doc consistent with label |
| 10 | **Test assertion** | `frontend/src/components/sponsors/PartnerForm.test.tsx:59` | `expect(screen.getByText('Sponsorship Details')).toBeInTheDocument();` | **Rename to 'Partnership Details'** | Test will otherwise fail post-rename |
| 11 | TYPE_OPTIONS array | `frontend/src/components/sponsors/PartnerForm.tsx:102-109` | 6 entries | **Add `community`** | Task requirement |
| 12 | Type definition | `frontend/src/types.ts:453` | `'cash' \| 'in-kind' \| 'venue' \| 'pizza' \| 'drinks' \| 'other'` | **Add `'community'`** | Required for type-safety of TYPE_OPTIONS |
| 13 | Schema doc comment | `backend/prisma/schema.prisma:891` | `// cash, in-kind, venue, pizza, drinks, other` | **Append `, community`** | Doc-comment alignment; no migration |
| 14 | Backend allowlist (intake PATCH) | `backend/src/routes/partner-intake.routes.ts:220` | `['cash', 'in-kind', 'venue', 'pizza', 'drinks', 'other']` | **Append `'community'`** | Required so intake submissions with `community` aren't rejected |
| 15 | Backend allowlist (CRM POST) | `backend/src/routes/sponsor.routes.ts:385` | same list | **Append `'community'`** | Required for CRM-created sponsors |
| 16 | Backend allowlist (CRM PATCH) | `backend/src/routes/sponsor.routes.ts:587` | same list | **Append `'community'`** | Required for CRM edits |

### Out-of-scope occurrences (leave as-is, with rationale)

| Surface | File:line | Why we leave it |
|---|---|---|
| `SponsorshipType` exported type name | `frontend/src/types.ts:453` | Stable identifier, not user-facing. Renaming would cascade to ~50 import sites across `api.ts`, `PartnerForm.tsx`, etc., for zero user-visible benefit. |
| `sponsorshipType` field on Sponsor / form / API | `types.ts:484`, `api.ts:793,1097,1115,3100`, `PartnerForm.tsx:44,80,145,186,728,729,763,764`, `PartnerIntakePage.tsx:21`, etc. | Same: stable field identifier. Renaming would require a DB column rename (`sponsorship_type`) + migration + every consumer. Not in scope. |
| `sponsorship_type` DB column / Prisma `@map` | `backend/prisma/schema.prisma:891` | Same: column rename is invasive; doc comment is the only thing we touch (item 13). |
| Backend route handlers' use of `sponsorshipType` | `backend/src/routes/{partner-intake,sponsor,user,underboss}.routes.ts` | Field identifier; not UI copy. |
| `profile.sponsorships` ("Your Sponsorships") section on AccountPage | `frontend/src/pages/AccountPage.tsx:674`, plus values in all 7 `account.json` locales (`"sponsorships"` key) | This is a **different section header** ("Your Sponsorships" — a listing of past sponsorships for a user). Task says rename "Sponsorship Details" specifically. Renaming "Your Sponsorships" → "Your Partnerships" is a separate decision; leaving for Snax to confirm in a future ticket. **Not changed in this PR.** |
| `AppsHub.tsx:72` description: `'Manage event partners and sponsorships'` | `frontend/src/components/AppsHub.tsx:72` | Generic description for the partners app tile, not the "Sponsorship Details" label. Could optionally be flipped to "Manage event partners and partnerships" — recommend leaving (the word "sponsorships" still accurately describes the funded-partnership concept and is not the renamed label). Flag for Snax. |
| `EventTable.tsx:427` "Suggested sponsorship for ..." banner | `frontend/src/components/underboss/EventTable.tsx:427` | Different concept (a pricing-tier suggestion banner driven by `calculateTagSponsorshipTotal`). Not a "details" label. Out of scope. |
| `SponsorList.tsx:337` `'Funds'` literal | `frontend/src/components/sponsors/SponsorList.tsx:337` | Type-cell renderer; remains. No "Sponsorship" word in text. |
| `AccountPage.tsx:687-694` `typeLabels` map | `frontend/src/pages/AccountPage.tsx:687` | Renders type as "Cash", "In-Kind", "Venue", "Pizza", "Drinks", "Other". **Must extend to add `community: 'Community'`** so the new type renders correctly on the user's account listing. (Added to step list below — flagged here as a non-rename change.) |
| `frontend/src/utils/sponsorshipPricing.ts` (filename, function names) | n/a | Pricing-algorithm util, no user-visible copy. Filename rename out of scope. |
| Backend file `backend/src/routes/sponsor.routes.ts` (filename) | n/a | Route module name; data identifier. Out of scope. |

### Key rename — DECIDED

i18n key renames from `sponsors.sponsorshipDetails` → `sponsors.partnershipDetails`:
- All 7 `host.json` locales rename the key (line 302) AND update the string value.
- `PartnerForm.tsx:757` consumer updates to `t('sponsors.partnershipDetails')`.
- Grep the entire `frontend/src` tree for any other consumer of `sponsorshipDetails` before merging — there should be exactly one (line 757). If more exist (unlikely), update them too.

## DB / migration considerations

`Sponsor.sponsorshipType` is `String?` in `backend/prisma/schema.prisma:891` (free-text, no enum, no constraint). **No migration needed** to accept `community` as a value. The validation allowlists in the three backend route handlers (items 14, 15, 16) are the only DB-write gates. The Prisma model's inline doc comment (line 891) is updated for accuracy but is just a comment — no schema change.

## Files to modify

### Frontend types
1. `frontend/src/types.ts:453` — add `'community'` to `SponsorshipType` union.

### Frontend components
2. `frontend/src/components/sponsors/PartnerForm.tsx`
   - Line 102–109: add `{ value: 'community', labelKey: 'sponsors.communityType' }` to `TYPE_OPTIONS` (place after `'drinks'`, before `'other'`).
   - Line 752: update the JSX comment from `Sponsorship Details` to `Partnership Details`.
   - Line 757: change `t('sponsors.sponsorshipDetails')` → `t('sponsors.partnershipDetails')` to match the renamed key.

3. `frontend/src/components/sponsors/PartnerForm.test.tsx:59`
   - Update assertion: `expect(screen.getByText('Partnership Details')).toBeInTheDocument();`

4. `frontend/src/pages/AccountPage.tsx:687-694`
   - Extend `typeLabels` record with `community: 'Community'` so user-account listing renders the new type label correctly when a sponsor's `sponsorshipType === 'community'`.

### Frontend i18n (all 7 locales, both `host.json` edits per locale)
For each locale: **rename the key** `sponsorshipDetails` → `partnershipDetails` at line 302 AND update its string value. Add new key `communityType` after `drinksType` (line 350), before `otherType` (line 351). Maintain JSON-valid commas.

5. `frontend/src/i18n/locales/en/host.json` — `partnershipDetails: "Partnership Details"`, `communityType: "Community"`.
6. `frontend/src/i18n/locales/zh/host.json` — `partnershipDetails: "合作详情"`, `communityType: "社区"`.
7. `frontend/src/i18n/locales/pt/host.json` — `partnershipDetails: "Detalhes da Parceria"`, `communityType: "Comunidade"`.
8. `frontend/src/i18n/locales/ja/host.json` — `partnershipDetails: "パートナーシップ詳細"`, `communityType: "コミュニティ"`.
9. `frontend/src/i18n/locales/fr/host.json` — `partnershipDetails: "Détails du partenariat"`, `communityType: "Communauté"`.
10. `frontend/src/i18n/locales/es/host.json` — `partnershipDetails: "Detalles de la Asociación"`, `communityType: "Comunidad"`.
11. `frontend/src/i18n/locales/de/host.json` — `partnershipDetails: "Partnerschaftsdetails"`, `communityType: "Community"`.

### Backend
12. `backend/src/routes/partner-intake.routes.ts:220` — extend `validTypes` to include `'community'`.
13. `backend/src/routes/sponsor.routes.ts:385` (POST) — same extension.
14. `backend/src/routes/sponsor.routes.ts:587` (PATCH) — same extension.
15. `backend/prisma/schema.prisma:891` — update inline doc comment to read `// cash, in-kind, venue, pizza, drinks, community, other`.

## Proposed translations (Snax: sanity-check)

### "Partnership Details" (replaces "Sponsorship Details")

| Locale | Current value | Proposed value |
|---|---|---|
| en | Sponsorship Details | **Partnership Details** |
| zh | 赞助详情 | **合作详情** |
| pt | Detalhes do Patrocínio | **Detalhes da Parceria** |
| ja | スポンサーシップ詳細 | **パートナーシップ詳細** |
| fr | Détails du parrainage | **Détails du partenariat** |
| es | Detalles del Patrocinio | **Detalles de la Asociación** |
| de | Sponsoring-Details | **Partnerschaftsdetails** |

### "Community" (new `communityType` option label)

| Locale | Proposed value | Notes |
|---|---|---|
| en | **Community** | |
| zh | **社区** | Matches tone of other short labels (`资金`, `场地`, `披萨`) |
| pt | **Comunidade** | |
| ja | **コミュニティ** | Katakana loanword; matches `ドリンク` / `スポンサーシップ` register |
| fr | **Communauté** | |
| es | **Comunidad** | |
| de | **Community** | German tech contexts commonly use the English word; alternative: `Gemeinschaft` |

## Implementation order

One PR. Both backend allowlist + frontend changes ship together on merge to `master`. Backend auto-deploys; frontend Vercel-deploys. Window where frontend has the option but backend rejects is theoretically zero on a clean master merge — call out the coupling in the PR description anyway.

## Verification (Vercel preview)

Preview URL pattern: `https://rsvpizza-git-arugula-52469-partnership-details-pizza-dao.vercel.app`

1. **Partner intake form** — open `/partner-intake/{token}` for any existing token. Confirm:
   - Section header reads **"Partnership Details"** (not "Sponsorship Details").
   - Contribution type dropdown includes **"Community"** in correct position (after Drinks, before Other).
   - Selecting "Community" and submitting → POST succeeds.
   - Re-opening the intake loads the saved value as "Community".
2. **CRM dropdown** — as a host viewing a party with sponsors, open `Edit Partner` → Fundraising → Contribution Type. Confirm "Community" appears. Save → reload → value persists.
3. **Locale switching** — switch to each of zh / pt / ja / fr / es / de. Reopen `/partner-intake/{token}`. Confirm both the section header and the "Community" option render per translations table.
4. **Account page** — backfill a test sponsor with `sponsorshipType='community'` via Supabase MCP; sign in as that sponsor's contact email; open `/account` → confirm type badge reads "Community" (not raw `community`).
5. **Regression** — all 6 existing types still work; `cd frontend && npm test -- PartnerForm.test` passes.
6. **Backend allowlist** — POST/PATCH with `sponsorshipType: "community"` → 200; with garbage → 400.

## Notes

- Preview frontends talk to **production backend**. Once master is merged, backend allowlists + frontend ship together. Order risk negligible.
- No migration. Existing sponsors untouched.
- i18n key renamed `sponsorshipDetails` → `partnershipDetails` for naming consistency.
- Data-model identifiers (`SponsorshipType`, `sponsor_*` columns, `/sponsors` routes) all stay.
