# truffle-90229: Clarify funding language on rejected and listed GPP dashboard callouts

**Priority:** P3
**Type:** Copy change

## Problem
On the GPP dashboard, the rejected-status and listed-status callouts both refer to the "list without funding" path, but neither makes the funding/no-funding distinction explicit. Hosts have to infer it from the surrounding sentence. Tightening the copy on both callouts removes ambiguity.

## Files modified
- `frontend/src/components/gpp-dashboard/GPPDashboardTab.tsx`

## Changes
1. **Rejected callout primary button** (line 189): rename `List My Event` → `List My Event Without Funding`.
2. **Listed callout body** (line 225): append `These are self funded events that will not be funded by PizzaDAO.` after the existing `Your event is listed as a Community event on the site.`

No handler, styling, or routing changes.

## Verification
1. Vercel preview builds
2. On the GPP dashboard for an event with `underbossStatus = 'rejected'`, primary button now reads "List My Event Without Funding"; clicking it still flips status to `listed`
3. After it flips, the listed callout shows both sentences
