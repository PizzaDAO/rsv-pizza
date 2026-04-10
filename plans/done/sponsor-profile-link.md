# Sponsor Profile Link

## Summary
Show sponsor info on the user's `/account` page when their email matches `contactEmail` in the `sponsors` table. Only shows entries where the sponsor completed the intake flow (`intakeSubmittedAt IS NOT NULL`).

## No DB Changes Needed
Queries existing `sponsors` table by `contactEmail` — no migrations.

## Backend
### New endpoint: `GET /api/user/sponsorships`
- Added to existing `user.routes.ts` (already mounted, no index.ts change)
- Uses `requireAuth`, looks up user email
- Queries `sponsors WHERE contactEmail = user.email AND intakeSubmittedAt IS NOT NULL`
- Includes party data (name, date, slug, image) for context
- Returns array of sponsorship entries

## Frontend

### API (`api.ts`)
- `UserSponsorshipEntry` interface
- `getUserSponsorships()` function

### AccountPage (`AccountPage.tsx`)
New "Sponsorships" section (read-only), only renders if entries exist:
- Logo + brand name
- Event name (linked to event page)
- Sponsorship type badge (cash, in-kind, venue, pizza, drinks, other)
- Status badge (color-coded: paid=green, yes=blue, billed=yellow, stuck=red)
- Amount (if cash)
- Brand description
- Submission date

### Types (`types.ts`)
Add missing `brandInstagram` and `brandDescription` to `Sponsor` interface.

## Files to Modify
| File | Change |
|------|--------|
| `backend/src/routes/user.routes.ts` | Add `GET /sponsorships` endpoint |
| `frontend/src/lib/api.ts` | Add `UserSponsorshipEntry` + `getUserSponsorships()` |
| `frontend/src/types.ts` | Fix missing fields on `Sponsor` |
| `frontend/src/pages/AccountPage.tsx` | Add sponsorships section |

## Implementation Order
1. Backend endpoint (add to user.routes.ts)
2. Frontend types + API function
3. AccountPage sponsorships section
4. Deploy backend to prod
