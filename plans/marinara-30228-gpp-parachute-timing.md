# marinara-30228 — GPP parachute timing fix

**Priority**: Low (polish)

## Problem

On `/gpp`, after submitting the create-event form:
- Parachute pizzas spawn with random `duration: 5.5–9.5s`
- Transition to OTP code entry page is hardcoded at **8s**
- Result: longer parachutes (8–9.5s) get cut off mid-drop

## Goal

Constrain parachute drops to **5–7s** (randomized per chute) and time the transition so the OTP page appears right as the last parachute finishes.

## Files to modify

- `frontend/src/pages/GPPLandingPage.tsx`

## Changes

In `handleSubmit` (around lines 183–204):

1. **Parachute duration**: Change `duration: 5.5 + Math.random() * 4` → `duration: 5 + Math.random() * 2` (5–7s range).
2. **Stagger delays**: Currently `delay: i * 0.4 + Math.random() * 0.2` — last chute starts at ~1.4s. Combined with max duration 7s, the last chute lands around **8.4s**. Keep delays as-is.
3. **Transition timing**: Change `setTimeout(..., 8000)` → compute the actual longest end time from the generated chutes (`Math.max(...chutes.map(c => (c.delay + c.duration) * 1000))`) so transition fires exactly when the last chute lands.

## Implementation sketch

```tsx
const sizes = [65, 80, 95, 110].sort(() => Math.random() - 0.5);
const chutes = Array.from({ length: 4 }, (_, i) => ({
  id: i,
  x: 12 + Math.random() * 76,
  size: sizes[i],
  delay: i * 0.4 + Math.random() * 0.2,
  duration: 5 + Math.random() * 2,                 // ← 5–7s
  swayAmount: 12 + Math.random() * 30,
  swaySpeed: 1.2 + Math.random() * 2,
}));
setParachutes(chutes);

// Transition exactly when the last parachute finishes
const lastEndMs = Math.max(...chutes.map(c => (c.delay + c.duration) * 1000));
setTimeout(() => {
  setSuccess(successData);
}, lastEndMs);
```

## Verification

1. Open Vercel preview `/gpp`
2. Fill out form with a real city + your email
3. Submit → confetti fires immediately
4. Watch parachutes — all should fully reach the bottom of the viewport before page transitions
5. OTP code entry page appears as the last chute lands
