# casatiello-58291 — USDC-only host payout picker + SWC Hub login for US events

## Scope
Two reimbursement-flow changes on the HOST-FACING Payments tab (the
`PaymentDetailsCard` at the top of the Payments tab — NOT the admin `/payments`
page).

## Change A — USDC-only payout method picker
File: `frontend/src/components/payouts/PayoutMethodPicker.tsx`

- Removed the "Mercury virtual card" (`mercury_card`) and "Bank wire" (`wire`)
  radio options and their conditional sub-forms.
- USDC on Base is now the only method. Since a single radio is pointless, the
  3-column grid is gone; we render a single full-width "USDC on Base" header
  card (kept visually selected) followed by the existing wallet `IconInput`,
  live ENS preview, and helper text.
- A small effect forces `method` back to `usdc_base` if a historical row had
  another value, so the wallet sub-form always shows.
- Removed now-unused imports (`CreditCard`, `Banknote`, `Mail`,
  `isMercuryBlocked`, `usePizza`, `BankDetails`) and props (`bankDetails`,
  `onBankDetailsChange`, `userEmail`, `reimbursementCapUsd`). The reduced props
  are `method`, `onMethodChange`, `walletAddress`, `onWalletAddressChange`.
- The `PayoutMethod` type in `types.ts` is UNCHANGED — `mercury_card`/`wire`
  remain valid union members so historical payout rows still render in admin
  views.

## Change B — US events use the SWC Hub login
File: `frontend/src/components/payouts/PaymentDetailsCard.tsx`

- Compute `isUS = party?.country === 'United States'` (parties.country is the
  full English name) and `hasHubTag = (party?.eventTags ?? []).includes('hub')`.
- When `isUS`: hide the picker and the per-event opt-in submit section, and
  render a single SWC Hub block instead:
  - `hasHubTag` → enabled anchor styled like `btn-primary`, linking to
    `https://www.swchub.org/` (`target="_blank" rel="noopener noreferrer"`),
    labeled `Login to SWC Hub with {user.email}` (falls back to
    `Login to SWC Hub` when no email).
  - not `hasHubTag` → same label as a disabled button
    (`opacity-50 cursor-not-allowed`) with a "Pending" badge and helper text:
    "Your event hasn't been added to the SWC Hub yet — check back soon."
  - The Saving/Saved status indicator is hidden for US events.
- When NOT `isUS` (non-US flow preserved):
  - `PayoutMethodPicker` is passed the reduced prop set.
  - `method` state and `pickerMethod` fallback default to `'usdc_base'` so the
    debounced autosave persists usdc_base for hosts with no saved method.
  - `methodValid` simplified to the wallet hex/ENS check only; `buildPayload`
    always sends `payoutWalletAddress` + `payoutBankDetails: null`. The
    mercury/wire/EMAIL_REGEX/bankDetails paths were removed.
  - Per-event opt-in submit flow and debounced autosave to `updateUserMe` are
    intact.
- Removed now-dead imports (`isMercuryBlocked`, `BankDetails`, `EMAIL_REGEX`)
  and the `bankDetails` state + hydration effect.

## Correctness
- All React hooks remain above any early return (Rules of Hooks); `isUS`/
  `hasHubTag` are plain derivations, not hooks.
- `cd frontend && npx tsc --noEmit` → exit 0 (clean).
