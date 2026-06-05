# rigatoni-72401: Ship combined PizzaDAO+SWC opt-in checkbox to all SWC events

**Priority:** P2
**Type:** Experiment graduation — kill A/B, force variant
**Status:** Plan
**Branch:** `rigatoni-72401-ship-combined-optin`

## Context

The parmesan-98989 A/B test ran for ~3 weeks across US, EU, UK, AU. Results as of 2026-06-05:

| region | n | PizzaDAO Δ (variant − control) | SWC Δ |
|---|---|---|---|
| US | 1,355 | −0.5pp (p=0.83) | +4.2pp (p=0.07) |
| EU | 866 | −1.1pp (p=0.73) | +2.7pp (p=0.39) |
| UK | 73 | +4.2pp (p=0.70) | −11.8pp (p=0.27) |
| AU | 19 | (underpowered) | (underpowered) |

US + EU are well-powered and both show **no PizzaDAO opt-in cost** from the merged checkbox; SWC opt-in trends up. UK/AU still small but directionally consistent. CA/BR have no data yet but the merge is safe to roll out everywhere.

**Decision (Snax, 2026-06-05):** Ship the variant to all 6 SWC regions in all 8 locales. Keep A/B infra in place but dormant (kill switch can still flip back; column stays for history).

## Goal

Make every RSVP on an SWC-tagged event (US `swc`, plus regional `swccanada`, `swcau`, `swceu`, `swcuk`, `swcbr`) render the single combined opt-in checkbox — no more random bucketing, no more pilot-tag gate, no more flag dependency.

## Important discoveries up front

1. **Current bucketing has two gates, not one.** `frontend/src/hooks/useRSVPForm.ts` (in `useEffect` ~line 220–235 on master) requires BOTH:
   - The event has the pilot tag `optin-ab-test` (added by pizzaiolo-63884).
   - The region's `experiment_flags` kill switch is enabled (per `getExperimentFlag(activeRegionConfig.flagKey)`).

   So today, only events with the `optin-ab-test` tag participate. Removing the random roll alone is insufficient — both gates need to come out.

2. **Existing-guest variant preservation must stay.** The same hook preserves `existingGuest.optinAbVariant` if it's `'control'` or `'variant'`. Guests already bucketed into `control` on past RSVPs would still see the two-checkbox UI on re-submit. That's correct behavior (don't break analytics for in-flight events) — leave the preservation branch alone.

3. **`activeRegionConfig` is the single source of truth for "is this an SWC-tagged event".** `frontend/src/hooks/useRSVPForm.ts` already uses `findActiveRegion(eventData.eventTags)` to map any of the 6 SWC tags to a region config. We can rely on it.

4. **`combinedOptIn` / `setCombinedOptIn` already handle all 6 regions.** The `switch (activeRegionConfig.swcOptInField)` already covers `swcOptIn`, `swcCaOptIn`, `swcAuOptIn`, `swcEuOptIn`, `swcUkOptIn`, `swcBrOptIn`. No regional plumbing changes needed.

5. **Portuguese already has `combinedOptIn`.** `frontend/src/i18n/locales/pt/rsvp.json` has `"combinedOptIn": "Receba novidades da PizzaDAO + nossos parceiros"`. The other 6 non-English locales (de, es, fr, ja, ko, zh) are missing it.

6. **Backend, DB, admin UI: nothing to change.** Backend already accepts/persists `optinAbVariant` for any value in `{'control','variant'}`. Admin OptinABTab continues to work — it just won't see new `control` rows accumulating after this ships (only existing-guest re-submits will write `control`).

## Files to modify

### 1. `frontend/src/hooks/useRSVPForm.ts`

In the `useEffect` that currently buckets (~line 220–235 on master), replace the whole pilot-gate + flag-fetch + random-roll with an unconditional `setOptinAbVariant('variant')` for any SWC-tagged event. Preservation path stays.

**Before:**
```ts
useEffect(() => {
  if (optinAbVariant !== null) return; // preservation path already set
  if (!activeRegionConfig) return;     // not an SWC event
  // pizzaiolo-63884: pilot mode — only events explicitly tagged 'optin-ab-test'
  // participate in the experiment, even when the region's kill-switch flag is ON.
  // Remove this gate (or remove the tag from each pilot event) to fan out to all
  // region-tagged events.
  const tags = eventData.eventTags || [];
  if (!tags.includes('optin-ab-test')) return;
  let cancelled = false;
  (async () => {
    const enabled = await getExperimentFlag(activeRegionConfig.flagKey);
    if (cancelled) return;
    if (!enabled) return;
    setOptinAbVariant(Math.random() < 0.5 ? 'control' : 'variant');
  })();
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

**After:**
```ts
useEffect(() => {
  if (optinAbVariant !== null) return; // preserve existing-guest bucket if any
  if (!activeRegionConfig) return;     // not an SWC event
  // rigatoni-72401: A/B test concluded — every SWC event ships the combined checkbox.
  // Kill-switch flag + pilot tag remain in DB for emergency rollback, but no longer gate the UI.
  setOptinAbVariant('variant');
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

The `getExperimentFlag` import can stay (low cost, may be used by future experiments) — don't bother removing it.

### 2. i18n — add `combinedOptIn` to 6 locales

Add the key under `step1` in each file, adjacent to `swcJoin` / `swcNotify` (which the agent should grep to locate the right block):

- `frontend/src/i18n/locales/de/rsvp.json` → `"combinedOptIn": "Hören Sie von PizzaDAO + unseren Partnern"`
- `frontend/src/i18n/locales/es/rsvp.json` → `"combinedOptIn": "Recibe novedades de PizzaDAO + nuestros socios"`
- `frontend/src/i18n/locales/fr/rsvp.json` → `"combinedOptIn": "Recevoir des nouvelles de PizzaDAO + nos partenaires"`
- `frontend/src/i18n/locales/ja/rsvp.json` → `"combinedOptIn": "PizzaDAOとパートナーからのお知らせを受け取る"`
- `frontend/src/i18n/locales/ko/rsvp.json` → `"combinedOptIn": "PizzaDAO 및 파트너의 소식 받기"`
- `frontend/src/i18n/locales/zh/rsvp.json` → `"combinedOptIn": "接收来自 PizzaDAO 与合作伙伴的消息"`

(pt is already done — leave it.)

Keep the existing JSON formatting/indentation of each file. Place the key in roughly the same location as in `en/rsvp.json` (next to `swcJoin`/`swcNotify`).

## What NOT to change

- **Don't remove the control codepath in `RSVPFormStep1.tsx`.** It still renders for existing-guest re-submits whose variant is `'control'`. Removing it would break the preserved-bucket flow.
- **Don't drop the `optin_ab_variant` column or the `experiment_flags` rows.** History + future kill-switch.
- **Don't touch the admin `OptinABTab`.** Still useful for reviewing historical results.
- **Don't touch backend `rsvp.routes.ts` or Prisma schema.** They already accept and persist the field correctly.
- **Don't remove the `pizzaiolo-63884` pilot-tag comment from the hook** — replace it with the rigatoni-72401 comment explaining the experiment graduated. Future readers need to know why the gates disappeared.

## Verification / test plan

1. **TS build clean:** `cd frontend && npm run build` passes.
2. **Smoke test on Vercel preview:**
   - Open any SWC-tagged event (US `swc` works fine). RSVP form should show ONE combined checkbox + (i) modal, not two.
   - Open any non-SWC event. RSVP form should show only the PizzaDAO checkbox (unchanged baseline).
   - Open in fresh incognito (no `existingGuest.optinAbVariant`) — should always be variant, never two checkboxes.
3. **Bucket distribution check (post-deploy, after a few RSVPs):**
   ```sql
   SELECT optin_ab_variant, COUNT(*) FROM guests
   WHERE submitted_via='link'
     AND created_at >= '2026-06-05'
   GROUP BY 1;
   ```
   Should be ~100% `variant` for SWC events; `control` count should not grow (except from existing-guest re-submits).
4. **Locale spot check:** Switch locale to fr/de/zh/ja/ko/es; the combined-checkbox label should render in the local language, not English fallback.

## Step-by-step implementation order

1. Edit `frontend/src/hooks/useRSVPForm.ts` — replace the bucketing effect body.
2. Add `combinedOptIn` to 6 locale JSON files.
3. `cd frontend && npm run build` to verify TS + JSON parse.
4. Commit + push as `rigatoni-72401-ship-combined-optin`.
5. Open draft PR titled "Ship combined PizzaDAO+SWC opt-in checkbox to all SWC events (rigatoni-72401)".

## Open questions for Snax

None — Snax already chose: force-variant only / all 6 regions / translate to all 8 locales.

## Out of scope

- Stripping the control UI from `RSVPFormStep1.tsx` (deferred to a later cleanup PR once no live guest has `control` variant).
- Removing the kill-switch admin tab.
- Dropping the `optin_ab_variant` column.
- Generalizing the experiment infra for future A/B tests.
