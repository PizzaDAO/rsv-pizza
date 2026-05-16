# dough-19767 — GPP dashboard checklist: clickable circles for manual items + visual "auto" cue

**Priority**: P1

## Problem

On the GPP host dashboard ("Event Setup" card in `GPPDashboardTab`), the checklist circle is purely decorative. Manual items like "Find Partners" and "Prepare for the Party" can never be marked done from this view — the only way to toggle them is to navigate to the separate `/checklist` tab, which most hosts never visit.

DB confirms the symptom: across 537 GPP events with seeded defaults, **zero** `checklist_items` rows have `completed_at` set. Nobody has ever successfully toggled a manual item, because the dashboard never sends a toggle.

Current rendering in `frontend/src/components/gpp-dashboard/GPPDashboardTab.tsx:248-302`:
- The whole row is a `<button>` if the item has a `linkTab` or custom `onClick`, otherwise a `<div>`.
- Click on a row with `linkTab` → navigates away (e.g. "Find Partners" → `/partners`).
- Click on a row with neither (like "Prepare for the Party") → nothing.
- The leading `CheckCircle` / `Circle` icon has no click handler of its own.

Auto-completed items (like "Find a Venue", "Set Up Budget") also look identical to manual items, so the user can't tell which ones the system will check off automatically vs which ones need manual action.

## Goal

1. The leading circle becomes an interactive control for **manual** items — clicking it toggles completion via `toggleChecklistItem` and refreshes the row state.
2. **Auto** items show their circle in a way that visually signals "auto" (so the user understands why it's not clickable). Use a `Lock` icon (or similar visual diff — see notes below) — do not call toggle on these.
3. Row-level navigation (`Go →` for items with `linkTab`) keeps working — only the circle is the new toggle hit-target, not the whole row.

## Files to modify

- `frontend/src/components/gpp-dashboard/GPPDashboardTab.tsx` (only file)

## Implementation

### 1. Import `toggleChecklistItem` and a "lock" icon

```ts
import { ..., Lock } from 'lucide-react';
import { getChecklist, seedChecklist, updateUnderbossStatus, toggleChecklistItem } from '../../lib/api';
```

### 2. Carry `isAuto` and `id` through the `checklist` memo

In the `checklist = useMemo(...)` block (line ~66), include `isAuto`, `autoRule`, and `id` in each mapped item so the renderer can decide whether the circle is interactive and which item to toggle:

```ts
return {
  id: item.id,
  isAuto: item.isAuto,
  autoRule: item.autoRule,
  label: item.name,
  done,
  tab: item.linkTab,
  onClick: ...,
  icon: ICON_MAP[item.name] ?? ClipboardCheck,
  dueDate: item.dueDate ? item.dueDate.split('T')[0] : null,
};
```

### 3. Add a toggle handler

After `goToTab`, add:

```ts
const [togglingId, setTogglingId] = useState<string | null>(null);

const handleToggleItem = async (itemId: string) => {
  if (!party?.id || togglingId) return;
  setTogglingId(itemId);
  try {
    const result = await toggleChecklistItem(party.id, itemId);
    if (result?.item) {
      // Optimistic-ish: update the single row in dbItems so the UI reflects the new state
      setDbItems(prev => prev.map(it => it.id === itemId ? { ...it, completed: result.item.completed, completedAt: result.item.completedAt } : it));
    }
  } finally {
    setTogglingId(null);
  }
};
```

(Local-only update — no refetch needed; auto-states haven't changed.)

### 4. Replace the leading icon block in the render

Currently (line ~260):

```tsx
{item.done ? (
  <CheckCircle size={18} className="text-green-500 shrink-0" />
) : (
  <Circle size={18} className="text-theme-text-faint shrink-0" />
)}
```

Replace with a small helper component (or inline) that:

- **If `item.isAuto`**: render the existing `CheckCircle`/`Circle` BUT wrap it with a tooltip or overlay that makes it clear it's automatic. Recommended: use a `Lock` overlay (small lock icon top-right corner) OR render the unchecked state with a `Lock` icon instead of an empty `Circle`. Add `title="Auto-completes when {autoRule explanation}"` for hover hint. Do NOT make it clickable — render as a plain `<span>` so row navigation isn't blocked.

- **If NOT `item.isAuto`**: render the icon inside a `<button type="button">` that:
  - calls `e.stopPropagation()` so the row's parent `<button>`/navigation doesn't fire
  - calls `handleToggleItem(item.id)`
  - has hover styling (`hover:opacity-80` or similar)
  - disabled while `togglingId === item.id`
  - `aria-label="Mark {label} {done ? 'incomplete' : 'complete'}"`

```tsx
const ToggleCircle = ({ item }: { item: ChecklistRow }) => {
  const baseIcon = item.done
    ? <CheckCircle size={18} className="text-green-500 shrink-0" />
    : <Circle size={18} className="text-theme-text-faint shrink-0" />;

  if (item.isAuto) {
    return (
      <span
        title="Auto-completes based on event setup"
        className="relative inline-flex shrink-0"
      >
        {baseIcon}
        <Lock
          size={9}
          className="absolute -bottom-0.5 -right-0.5 text-theme-text-muted bg-theme-surface rounded-full p-px"
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); handleToggleItem(item.id); }}
      disabled={togglingId === item.id}
      aria-label={`Mark ${item.label} ${item.done ? 'incomplete' : 'complete'}`}
      className="shrink-0 hover:opacity-70 transition-opacity disabled:opacity-50"
    >
      {baseIcon}
    </button>
  );
};
```

(Define inside the component so it can close over `handleToggleItem` and `togglingId`.)

### 5. Crucial: row wrapper must allow nested buttons

The outer `<Wrapper>` is a `<button>` when `clickable` is truthy. Nesting a `<button>` inside a `<button>` is invalid HTML and React will warn. **Change the outer wrapper to always be a `<div>`** with `role="button"` when clickable, OR move the click handler off the wrapper and onto a dedicated trailing `Go →` span/button. Recommended: change outer wrapper to always `<div>`, and put the `onClick={clickable ? ... : undefined}` on the div with appropriate `role`/`tabIndex`/keyboard handler.

```tsx
<div
  onClick={clickable ? (item.onClick || (() => goToTab(item.tab!))) : undefined}
  onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (item.onClick || (() => goToTab(item.tab!)))(); } } : undefined}
  role={clickable ? 'button' : undefined}
  tabIndex={clickable ? 0 : undefined}
  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left group ${
    clickable ? 'hover:bg-theme-surface cursor-pointer' : ''
  }`}
>
  <ToggleCircle item={item} />
  ...
</div>
```

This is the only structural change — needed so the inner toggle button is legal.

## Verification

After deploy to Vercel preview:

1. As a GPP host, open `/host/{inviteCode}` → "Event Setup" card.
2. Click the circle next to "Prepare for the Party" → it fills green, item moves to "completed" (visible only if "Show completed" is on).
3. Click again → reverts to empty.
4. Click the circle next to "Find Partners" → it toggles WITHOUT navigating away to /partners.
5. Click the label/row body of "Find Partners" → still navigates to /partners.
6. Auto items (Find a Venue, Set Up Budget, etc.) show a small Lock indicator over their circle and clicking the circle does nothing (no navigation, no error). Hover tooltip says it auto-completes.
7. Refresh the page → manual toggles persisted (verify via DB: `SELECT name, completed, completed_at FROM checklist_items WHERE party_id = '...' AND name IN ('Find Partners', 'Prepare for the Party')`).
8. `/checklist` standalone tab shows the same completion state (sanity check that both surfaces share the same source of truth).

## Out of scope

- Changing the standalone `/checklist` tab's UI.
- Changing the seed/reseed flow or `checklist_defaults` rows.
- Adding any new auto-rules (e.g., "post_to_socials" detection).
