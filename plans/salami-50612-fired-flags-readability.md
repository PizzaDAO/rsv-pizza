# salami-50612 — Improve readability of fired flags on Fake Detection tab

## Problem

On `/underboss` → Fake Detection tab, each row shows a list of "fired flag"
pills like `low_domain_entropy`, `wallet_too_low`, `sig_collapse`. As-is:

- Text is `text-[10px]` — barely legible at normal viewing distance.
- `font-mono` + snake_case IDs read like machine codes, not insights.
- Pill colors are `bg-red-500/20` + `text-red-300` — on the site's light
  surface those render as pale-pink on pink with very low contrast (visible
  in the screenshot Snax shared).
- The heuristic weight is hidden in the `title` tooltip — admins triaging
  10+ pills per row can't tell which signals are heavy without hovering each.

## Files to modify

Single file:
`frontend/src/components/underboss/FakeDetectionTable.tsx`

No backend, no API, no migration, no i18n keys (English-only labels live in
the component itself — matches how `TIER_LABEL` is handled today).

## Changes

### 1. Add a flag-name → human label map

At module top, alongside `TIER_LABEL`, add:

```ts
const FLAG_LABELS: Record<string, string> = {
  cap_fill_no_waitlist: 'Cap fill, no waitlist',
  low_domain_entropy: 'Low email-domain entropy',
  sig_collapse: 'Field signature collapse',
  wallet_too_low: 'Too few wallets',
  wallet_too_high_reuse: 'Wallet reuse (high)',
  wallet_reuse: 'Wallet reuse',
  host_self_rsvp_mismatch: 'Host self-RSVP mismatch',
  pizzeria_fields_blank: 'Pizzeria fields blank',
  wallet_source_all_null: 'Wallet source all null',
  one_word_name: 'One-word event name',
  firstname_digits_email: 'Firstname+digits emails',
  day_gap_pattern: 'Day-gap pattern',
  low_hour_entropy: 'Low hour-of-day entropy',
  rapid_intersubmission: 'Rapid inter-submission',
  cross_event_wallet: 'Cross-event sybil wallet',
  high_per_visitor_rsvp_saturation: 'High per-visitor RSVP saturation',
  low_funnel_coverage: 'Low funnel coverage',
};

function flagLabel(name: string): string {
  return FLAG_LABELS[name] ?? name.replace(/_/g, ' ');
}
```

(The list comes from `backend/src/lib/fakeDetection.ts` heuristic ids. If a
new heuristic ships without a label, the fallback turns underscores into
spaces — still readable.)

### 2. Rework `FlagPill`

Replace the existing component with:

```tsx
function FlagPill({ flag }: { flag: FakeDetectionRow['flags'][number] }) {
  if (!flag.fired) return null;
  return (
    <span
      title={`${flag.name} — ${flag.detail}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-500/15 text-red-700 border border-red-500/30"
    >
      <span>{flagLabel(flag.name)}</span>
      <span className="text-red-700/60 tabular-nums">+{flag.weight}</span>
    </span>
  );
}
```

Concretely vs. today:

| Aspect | Before | After |
|---|---|---|
| Font size | `text-[10px]` | `text-xs` (12px) |
| Family | `font-mono` | default sans |
| Padding | `px-1.5 py-0.5` | `px-2 py-0.5` |
| Text color | `text-red-300` (washed on light bg) | `text-red-700` (high contrast) |
| Background | `bg-red-500/20` | `bg-red-500/15` (slightly softer to balance darker text) |
| Border | `border-red-500/30` | unchanged |
| Label | `wallet_source_all_null` | `Wallet source all null` |
| Weight | tooltip-only | inline `+8` (muted) |

The tooltip keeps the raw id (so devs can still cross-reference the
heuristic constant) and the `detail` string. We drop `(+weight)` from the
tooltip since the weight is now visible.

## Out of scope

- Re-theming pills per heuristic severity (e.g., weight-tiered colors).
  Single red pill is fine; the inline `+N` already telegraphs weight.
- Dark-mode tuning. The site is light. `text-red-700` reads well on both.
- i18n. The fake-detection tab is admin-only; existing flag-related copy
  in this file (e.g., the column header) is already i18n'd via
  `t('fakeDetection.columns.flags', 'Fired flags')`. Heuristic display
  names being English-only matches `TIER_LABEL` and is consistent.

## Verification

1. Vercel preview deploys for branch.
2. Open `https://rsvpizza-git-{branch}-pizza-dao.vercel.app/underboss`,
   click Fake Detection tab, confirm:
   - Pills are visibly larger and readable from a normal viewing distance.
   - Labels read as human English (e.g., "Wallet source all null"), not
     snake_case.
   - Each pill shows `+N` weight inline.
   - Hover still reveals the raw id and detail in the tooltip.
   - High-tier rows (e.g., Bukoba, Misungwi) still have visible red tint
     on the row.
3. No console errors, no layout shift on the row.
