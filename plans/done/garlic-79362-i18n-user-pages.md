# garlic-79362 — i18n L3: Wrap hard-coded English strings in user-facing pages

**Task ID:** `garlic-79362`
**Priority:** P3
**Branch:** `garlic-79362-i18n-user-pages`

## Problem

User-facing pages contain ~40 hard-coded English strings that should be translatable. Pages already import `useTranslation` (most of them) but key strings — placeholders, stat labels, sort options, post-check-in messages, empty states — were never wired into the translation system. Non-English users see mixed UI.

## Scope

**In scope:**
- `frontend/src/pages/AdminPage.tsx` (admin ns)
- `frontend/src/pages/CheckInPage.tsx` (checkin ns)
- `frontend/src/pages/OneSheetPage.tsx` (no current ns — add partner)
- `frontend/src/pages/PartnerDashboardPage.tsx` (partner ns)
- `frontend/src/pages/PartnerIntakePage.tsx` (partner ns)
- `frontend/src/pages/UnderbossDashboard.tsx` (admin ns)
- `frontend/src/pages/DJPage.tsx` (partner ns — `"SoundCloud"` is a brand name, leave untranslated; check for other strings)
- `frontend/src/i18n/locales/{en,es,pt,zh,fr,ja,de}/{admin,checkin,partner}.json`

**Out of scope:** Underboss admin components (handled by `jalapeno-45711`).

## DB changes

None.

## File changes

### A. AdminPage.tsx (namespace `admin`)

Hard-coded strings at lines 599, 609, 630-633, 713, 723, 743-745, 810, 820, 863-867, 994, 1004, 1014, 1035-1039, 1141, 1161, 1206. Re-grep before editing — line numbers drift.

Approach:
- Identify all `placeholder="..."`, `title="..."`, table-header strings, and empty-state text.
- Add a new section to `admin.json`:
```json
"page": {
  "placeholders": { ... },
  "tableHeaders": { "email": "Email", "name": "Name", "role": "Role", "added": "Added", ... },
  "emptyStates": { "noChecklist": "No checklist items found. Items are created when a GPP host first views their checklist." }
}
```
- Wire each location with `t('page.tableHeaders.email')` etc.

### B. CheckInPage.tsx (namespace `checkin`)

Hard-coded strings at lines 219, 236, 249-250, 261, 389, 401, 414-415: `"Thanks for attending!"`, `"Discount Claimed!"`, `"Discount Unavailable"`, `"Show Your QR Code"`, etc.

Add to `checkin.json`:
```json
"postCheckIn": {
  "thanks": "Thanks for attending!",
  "discountClaimed": "Discount Claimed!",
  "discountUnavailable": "Discount Unavailable",
  "showQrCode": "Show Your QR Code"
}
```
Note: some of these may already exist under a different key in `checkin.json`. Read the file first to find duplicates.

### C. OneSheetPage.tsx (currently NO useTranslation)

Add `import { useTranslation } from 'react-i18next'` and `const { t } = useTranslation('partner')` (OneSheet is partner-related).

Hard-coded strings at lines 112-113, 186, 191, 196, 203, 247, 254, 259, 266, 275, 282. Examples: `"Event Not Found"`, `"The event you're looking for doesn't exist or has been removed."`, `"RSVPs"`, `"Page Views"`, `"Partners"`, `"Thank you!"`, `"Interested in Partnering?"`, intake form placeholders.

Add to `partner.json`:
```json
"oneSheet": {
  "eventNotFound": "Event Not Found",
  "eventNotFoundDesc": "The event you're looking for doesn't exist or has been removed.",
  "stats": { "rsvps": "RSVPs", "pageViews": "Page Views", "partners": "Partners" },
  "thankYou": "Thank you!",
  "interestedInPartnering": "Interested in Partnering?",
  "intake": { ... placeholders ... }
}
```

### D. PartnerDashboardPage.tsx (namespace `partner`)

Lines 597-672, 702, 715-718, 1030, 1035, 1045, 1142, 1145.

Add to `partner.json`:
```json
"dashboard": {
  "stats": { "events": "Events", "totalRsvps": "Total RSVPs", "impressions": "Impressions", "partnerLinkClicks": "Partner Link Clicks", "withVenue": "With Venue", "withBudget": "With Budget", "completion": "Completion", "venue": "Venue", "budget": "Budget" },
  "searchPlaceholder": "Search events, hosts, venues...",
  "sort": { "newest": "Newest first", "oldest": "Oldest first", "mostRsvps": "Most RSVPs", "mostClicks": "Most clicks" },
  "rsvps": "RSVPs",
  "invited": "Invited",
  "photos": "Photos",
  "loadingPhotos": "Loading photos...",
  "noPhotos": "No photos found"
}
```

### E. PartnerIntakePage.tsx (namespace `partner`)

Line 151: `"Powered by"`. Add to `partner.json` → `"intake.poweredBy": "Powered by"`.

### F. UnderbossDashboard.tsx (namespace `admin`)

Lines 500, 510, 518: name/email placeholders, `"Regions"`. Add under `admin.dashboard.*` or `admin.page.*`.

### G. DJPage.tsx (namespace `partner`)

Line 322: `"SoundCloud"` — brand name, leave hard-coded. Scan rest of file for any other hard-coded English; if none, this file is a no-op.

## Translation strategy

All new English keys get machine-translated values for es, pt, zh, fr, ja, de. Keep brand names (`Underboss`, `SoundCloud`, `Telegram`, `MetaMask`) untranslated.

## Implementation steps

1. Create worktree: `git worktree add ../rsvpizza-garlic-79362 -b garlic-79362-i18n-user-pages`
2. cd into worktree.
3. For each page file, re-grep current line numbers (the audit may be slightly stale) and confirm hard-coded strings still exist.
4. For each namespace (`admin`, `partner`, `checkin`): add new keys to en JSON, then translate to the other 6 locales.
5. Edit each page to add or extend `useTranslation` and replace hard-coded strings with `t(...)` calls.
6. Build: `cd frontend && npm run build`.
7. Manual smoke-check in dev: load each page, switch to `?lang=es`, verify strings translate.
8. Commit: `fix(garlic-79362): i18n hard-coded strings in user-facing pages`
9. Push, open draft PR, verify Vercel deploy.

## Verification

- [ ] All listed pages render in English with no regressions
- [ ] `?lang=de` switches all newly-wired strings to German
- [ ] No TypeScript errors
- [ ] Vercel preview deploys
- [ ] CheckInPage post-check-in flow tested end-to-end on preview

## Risks

- CheckInPage flow is critical — wrong key in a status message could confuse users. Smoke-test carefully.
- OneSheetPage doesn't currently import i18n at all — adding `useTranslation` requires React Suspense to be already configured (it is, per `i18n/index.ts:191` `useSuspense: true`).
- Re-check actual line numbers before editing; the audit was a snapshot.
- This PR depends on `jalapeno-45711` only if both touch the same partner.json sections — but they should be in disjoint subsections (`oneSheet`, `dashboard`, `intake.poweredBy` for L3 vs `cities`, `funnel`, `telegram`, `eventRow`, `partnerManager` for L2). Merging order: L2 first, then rebase L3.

## Dependencies / merge order

1. Merge `jalapeno-45711` first (smaller, fixes the user-visible bug).
2. Rebase `garlic-79362` onto master after L2 merges (low conflict risk since they touch different sections).
