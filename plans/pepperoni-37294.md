# pepperoni-37294 — Replace post-save loadParty() refetches with in-place mergeParty()

## Problem

Clicking "Use for Event" on the flyer page (FlyerGenerator.tsx) feels like a page reload: the flyer's local positions/edits/sponsor box state resets and the UI jumps. Root cause: after updateParty succeeds, the handler calls loadParty(inviteCode), which refetches the entire party from the server and replaces the PizzaContext party object. The FlyerGenerator re-renders against the fresh object, so derived state visibly resets.

Same bug class exists on multiple other surfaces — the rule (per arugula-38633 and burrata-72104) is: prefer in-place context merge over refetch for save handlers. A mergeParty helper doesn't exist in PizzaContext yet.

## Fix

1. Add `mergeParty(updates: Partial<Party>)` to PizzaContext: `setParty(prev => prev ? { ...prev, ...updates } : prev)`.
2. Replace `loadParty(party.inviteCode)` on SUCCESS paths with `mergeParty({ ...just-changed fields })` at these sites:
   - FlyerGenerator.tsx `handleUseAsEventImage` (line ~691) and `handleAddAsCoHost` (line ~378)
   - HostPage.tsx PartnerManagement onAddAsCoHost (line ~300)
   - EventDetailsTab.tsx saveDateTime (line ~496); change triggerFlyerRegen callers to pass mergeParty
   - SponsorCRM.tsx three sites (~170, ~196, ~245) — drop the explicit loadParty, switch triggerFlyerRegen to mergeParty
   - autoRegenFlyer.ts: change `loadParty?` param to `mergeParty?`, replace the final loadParty call with mergeParty({ eventImageUrl, flyerGeneratedAt })

3. Keep loadParty unchanged on failure-revert paths (PreviousYearPhotos, PlatformPublisher) and page-load paths.

## Test plan

- typecheck passes
- Manual: GPP flyer page, drag a sponsor, click "Use for Event" → image updates without resetting positions
- Manual: EventDetailsTab date/time blur save doesn't feel like reload
- Manual: SponsorCRM status change → flyer auto-regens in background, no jarring rerender
