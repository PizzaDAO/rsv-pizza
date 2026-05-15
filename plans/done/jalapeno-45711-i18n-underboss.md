# jalapeno-45711 — i18n L1+L2: Fix missing `eventTable.hide` + wrap underboss admin UI strings

**Task ID:** `jalapeno-45711`
**Priority:** P2
**Branch:** `jalapeno-45711-i18n-underboss`

## Problem

1. **Critical bug:** `t('eventTable.hide')` is called at `frontend/src/components/underboss/EventTable.tsx:488` but the `hide` key does not exist in any locale's `partner.json`. Result: the bulk-action dropdown on `/underboss` shows the literal string `eventTable.hide` instead of "Hide". Visible in the screenshot Snax shared.

2. **Untranslated admin UI:** Roughly 35 hard-coded English strings across the `underboss/` component tree never get translated. Underbosses using non-English locales see mixed English/translated UI. Some keys are already defined in `partner.json` (e.g., `eventTable.tableHeaders.event`) but the components don't consume them.

## Root cause

- `partner.json` was extended for some `eventTable.*` keys but the `hide` action was missed when the dropdown got a Hide button.
- Most `underboss/` components were written without `useTranslation` and have never been internationalized. `EventTable.tsx` started a partial migration (header keys exist but aren't wired up).

## Scope

**In scope (this plan):**
- `frontend/src/components/underboss/EventTable.tsx`
- `frontend/src/components/underboss/CitiesTable.tsx`
- `frontend/src/components/underboss/FunnelTab.tsx`
- `frontend/src/components/underboss/TelegramBroadcast.tsx`
- `frontend/src/components/underboss/EventRow.tsx`
- `frontend/src/components/underboss/EventCard.tsx`
- `frontend/src/components/underboss/PartnerManager.tsx`
- `frontend/src/components/underboss/PartnerCitiesFlyer.tsx`
- `frontend/src/i18n/locales/{en,es,pt,zh,fr,ja,de}/partner.json`

**Out of scope (deferred to garlic-79362):**
- All `frontend/src/pages/*.tsx` files
- Non-underboss components

## DB changes

None.

## File changes

### A. Add missing key to partner.json — all 7 locales

In `frontend/src/i18n/locales/en/partner.json`, inside the `eventTable` object (after line 97 `"sendTelegram"`):

```json
"hide": "Hide",
```

Add machine translations for the other 6 locales:
- es: `"Ocultar"`
- pt: `"Ocultar"`
- fr: `"Masquer"`
- de: `"Ausblenden"`
- ja: `"非表示"`
- zh: `"隐藏"`

### B. Wire existing keys in `EventTable.tsx`

`EventTable.tsx` already uses `useTranslation('partner')`. Replace hard-coded strings with existing keys (no JSON changes needed for these — keys are in place):

| Line | Hard-coded | Replace with |
|------|------------|--------------|
| 469 | `Approve` (Reject is line 473) | `{t('eventTable.approve')}` / wire Reject if needed |
| 815 | `title="Select all"` | `title={t('eventTable.selectAll')}` |
| 820 | `>Event<` | `>{t('eventTable.tableHeaders.event')}<` |
| 823 | `>Country<` | `>{t('eventTable.tableHeaders.country')}<` |
| 827 | `>Host<` | `>{t('eventTable.tableHeaders.host')}<` |
| 830 | `>Location<` | `>{t('eventTable.tableHeaders.location')}<` |
| 832 | `>RSVPs<` | `>{t('eventTable.tableHeaders.rsvps')}<` |
| 834 | `>Photos<` | `>{t('eventTable.tableHeaders.photos')}<` |
| 836 | `>Progress<` | `>{t('eventTable.tableHeaders.progress')}<` |

Verify lines 469/473 — if "Approve"/"Reject" are already wired, skip; otherwise wire to `eventTable.approve` / add `eventTable.reject`.

### C. New keys to add under `partner.json`

Add new namespaced sections (English shown; translate for all 6 other locales):

```json
"cities": {
  "loading": "Loading cities...",
  "searchPlaceholder": "Search cities, countries, underbosses...",
  "statusAll": "All Statuses",
  "statusCreated": "Created",
  "statusTodo": "To Do",
  "statusSkip": "Skip",
  "noCitiesMatch": "No cities match your filters",
  "noCitiesSelected": "No cities selected",
  "tableHeaders": {
    "status": "Status",
    "city": "City",
    "country": "Country",
    "underboss": "Underboss",
    "region": "Region",
    "actions": "Actions"
  },
  "telegramGroup": "Telegram group",
  "noPhotos": "No photos found"
},
"funnel": {
  "loadFailed": "Failed to load funnel data.",
  "overallTitle": "Overall RSVP Funnel",
  "perEventTitle": "Per-Event Breakdown",
  "openRate": "Open rate:",
  "completion": "Completion:",
  "noData": "No funnel data yet.",
  "tableHeaders": {
    "event": "Event",
    "city": "City",
    "views": "Views",
    "opened": "Opened",
    "step1": "Step 1",
    "submitted": "Submitted"
  }
},
"telegram": {
  "broadcastMessage": "Broadcast Message",
  "loading": "Loading Telegram groups...",
  "duplicatesDetected": "Duplicate Telegram groups detected",
  "messagePlaceholder": "Type your message here...",
  "messageLabel": "Message",
  "formatPlain": "Plain Text",
  "formatHtml": "HTML",
  "formatMarkdown": "Markdown",
  "sent": "Sent",
  "failed": "Failed",
  "searchPlaceholder": "Search city, country, or underboss...",
  "tableHeaders": {
    "city": "City",
    "country": "Country",
    "underboss": "Underboss",
    "test": "Test"
  }
},
"eventRow": {
  "notesPlaceholder": "Underboss notes...",
  "saving": "Saving...",
  "noVenue": "No venue",
  "loadingPhotos": "Loading photos...",
  "noPhotos": "No photos found",
  "selectEvent": "Select event",
  "addTag": "Add tag",
  "statusApproved": "Approved",
  "statusRejected": "Rejected",
  "statusHidden": "Hidden",
  "statusCommunityListed": "Community Listed",
  "telegramGroup": "Telegram group",
  "expectedGuests": "Expected guests"
},
"partnerManager": {
  "generateFlyer": "Generate partner flyer",
  "editPartner": "Edit partner",
  "deactivatePartner": "Deactivate partner",
  "deactivateConfirm": "Deactivate this partner? This will remove their co-host entries from all events.",
  "resetDefaults": "Reset to defaults"
}
```

### D. Wire new keys in each component

For each underboss component that doesn't yet import `useTranslation`, add:
```tsx
import { useTranslation } from 'react-i18next';
// ...
const { t } = useTranslation('partner');
```

Then replace each hard-coded string per the inventory in the audit. Specific files:

- **CitiesTable.tsx** — lines 372, 430, 439-442, 493, 511-522, 538, 553, 812, 846, 849, 1008, 1011
- **FunnelTab.tsx** — lines 56, 66, 72-73, 79, 83-89, 109
- **TelegramBroadcast.tsx** — lines 302, 318, 339, 388, 458-462, 536, 546-548, 556, 603, 608
- **EventRow.tsx** — lines 209/248/249, 410/494/505/506/509/512/515/545/564, 573, 642, 668, 705, 708
- **EventCard.tsx** — lines 209, 402/410/413/416/419, 462, 471, 541, 544
- **PartnerManager.tsx** — lines 160 (confirm), 289, 297, 305
- **PartnerCitiesFlyer.tsx** — line 502
- **EventTable.tsx** — also line 488 (`eventTable.hide`), 603 (`customTagPlaceholder` already exists), 626 (`noTagsToRemove` already exists)

## Implementation steps

1. Create worktree: `git worktree add ../rsvpizza-jalapeno-45711 -b jalapeno-45711-i18n-underboss`
2. cd into worktree.
3. Edit `frontend/src/i18n/locales/en/partner.json`: add `eventTable.hide` + all new sections (`cities`, `funnel`, `telegram`, `eventRow`, `partnerManager`).
4. Repeat step 3 for each of `es, pt, zh, fr, ja, de` with machine-translated values. Maintain identical key structure.
5. For each underboss component file: ensure `useTranslation('partner')` is imported and `const { t } = useTranslation('partner')` is in the function body, then wire every hard-coded string per the table above.
6. Sanity-build: `cd frontend && npm run build` — verify no TS errors.
7. Manual smoke-check in dev: load `/underboss`, switch language via `?lang=es`, confirm dropdown shows "Ocultar" (or appropriate) instead of `eventTable.hide`, table headers translate, etc.
8. Commit with message: `fix(jalapeno-45711): add missing eventTable.hide key and i18n underboss admin UI`
9. Push branch, open draft PR: `gh pr create --draft --title "jalapeno-45711: i18n underboss admin UI" --body "..."`
10. Wait for Vercel deploy, verify build succeeds via `gh pr checks <num>`.

## Verification

- [ ] `/underboss` events tab → select an event → click Actions dropdown → "Hide" renders (not `eventTable.hide`)
- [ ] Switch language to es/de/fr via `?lang=` → all underboss table headers translate
- [ ] No TypeScript errors in `npm run build`
- [ ] Vercel preview deploys successfully
- [ ] Smoke-check CitiesTable / FunnelTab / TelegramBroadcast on preview in non-English locale

## Risks

- Existing keys like `tableHeaders.event` may already be wired in EventTable through a code path I missed — diff carefully before bulk-replacing.
- Machine translation quality for terms like "Underboss" (proprietary jargon) — leave as "Underboss" untranslated in all locales.
- File line numbers may have shifted since the audit; re-grep before each edit.
