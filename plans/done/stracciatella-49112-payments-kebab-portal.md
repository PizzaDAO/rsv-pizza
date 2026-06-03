> **ARCHIVED — merged as [PR #792](https://github.com/PizzaDAO/rsv-pizza/pull/792) on 2026-06-03.**

# stracciatella-49112 — /payments kebab dropdown clipped by table overflow

## Problem
On `/payments` (By city view), the `⋮` "More actions" dropdown in each city row is
clipped by the table's overflow container. When the table has only one row there's
nothing below to scroll, so the menu items are unreachable (see bug screenshot: menu
opens below the row and is cut off by the table's bottom edge).

## Root cause
`CityActionsMenu` in `frontend/src/components/payments-admin/PayoutsByPartyTable.tsx`
renders its dropdown as:
```
<div className="relative">
  <button ...>⋮</button>
  {menuOpen && (
    <>
      <div className="fixed inset-0 z-40" onClick=close />   {/* click-out */}
      <div className="absolute right-0 mt-1 w-56 z-50 ... bg-[#1a1a2e] ...">...</div>
    </>
  )}
</div>
```
The `absolute` menu is positioned relative to the row cell, but the table is wrapped in
`<div className="...rounded-xl overflow-hidden"><div className="overflow-x-auto">` (lines
~2647-2648). `overflow-hidden` + `overflow-x-auto` clip the menu. With a single row there
is no scroll room, so the menu is permanently cut off.

## Fix — portal the dropdown to `document.body` with fixed positioning
Convert the `absolute` dropdown into a `createPortal(..., document.body)` panel positioned
with `position: fixed` from the kebab button's `getBoundingClientRect()`, flipping **above**
the button when there isn't enough room below.

### Implementation (single file: `PayoutsByPartyTable.tsx`)
1. **Imports**
   - `react`: add `useRef`, `useEffect` to the existing `useState` import.
   - Add `import { createPortal } from 'react-dom';`
2. **In `CityActionsMenu`:**
   - Add `const buttonRef = useRef<HTMLButtonElement>(null);` on the `⋮` button.
   - Add menu position state: `const [menuPos, setMenuPos] = useState<{ top: number; left: number; placement: 'above' | 'below' } | null>(null);`
   - Add a `computeMenuPos()` helper that reads `buttonRef.current.getBoundingClientRect()`:
     - Menu width `MENU_W = 224` (w-56). Menu max-height estimate `MENU_MAX_H = 320`.
     - `spaceBelow = window.innerHeight - rect.bottom`, `spaceAbove = rect.top`.
     - `placement = 'above'` when `spaceBelow < MENU_MAX_H && spaceBelow < spaceAbove`, else `'below'`.
     - `top`: below → `rect.bottom + 4`; above → `rect.top - 4` (panel shifted up by its own
       height via `transform: translateY(-100%)`).
     - `left = rect.right - MENU_W`, clamped to `[8, window.innerWidth - MENU_W - 8]`.
   - Call `computeMenuPos()` when opening; `setMenuPos(null)` when closing (alongside the
     existing `confirmTgReminder` / `confirmWalletReminder` resets).
   - `useEffect` while `menuOpen`: add capture-phase `scroll` + `resize` listeners that
     reposition (not close) the menu.
   - Render the menu via `createPortal(<>overlay + panel</>, document.body)`. Panel uses inline
     `style={{ position: 'fixed', top, left, zIndex: 60, ...(placement==='above' && { transform:
     'translateY(-100%)' }) }}`, keeping `w-56 rounded-lg border border-theme-stroke bg-[#1a1a2e]
     shadow-xl py-1` (drop `absolute right-0 mt-1 z-50`). Overlay `position: fixed; inset: 0;
     zIndex: 50`.

### Theme note (verified)
`text-theme-*` / `bg-theme-*` map to CSS vars defined at **`:root`** (frontend/src/index.css:45),
and `/payments` is **not** a `.gpp-theme` page, so the existing theme classes resolve fine when
the panel is portaled to `<body>`. No restyle needed; the panel bg is already `bg-[#1a1a2e]`.

## Constraints
- ONLY touched `frontend/src/components/payments-admin/PayoutsByPartyTable.tsx`.
- No changes to handler props, two-click-confirm logic, or which menu items appear.
- Preserved `onClick={(e) => e.stopPropagation()}` on the container.
- Hooks declared above the early `return null` guard.

## Outcome
Shipped in PR #792 (squash-merged 2026-06-03, commit `dca210d5`). Typecheck passed with no new
errors; the 5 pre-existing `tsc` diagnostics in the file were confirmed present on baseline.
