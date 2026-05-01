# Pizzeria Tagline Edit

## Task
Allow hosts to edit the description/tagline on their selected pizzerias from the host page.

## Scope
Frontend-only — no DB or backend changes needed. The `description` field already exists on the `Pizzeria` type and is persisted as part of the `selected_pizzerias` JSONB array.

## File to Modify
- `frontend/src/components/PizzeriaSelection.tsx`

## Implementation

In the selected pizzerias section (lines ~289-407), for each pizzeria card:

1. Add a `Pencil` icon import from lucide-react
2. Below the address line and above the votes/links, add an inline editable tagline area:
   - If NOT editing: show the current `description` as muted text, or "Add tagline..." placeholder if empty. Show a small pencil icon on hover.
   - If editing: show an `IconInput` with `multiline` prop, pre-filled with current description
3. Track which pizzeria is being edited via `editingTaglineId` state (`string | null`)
4. On blur: update the pizzeria's `description` in the local `selectedPizzerias` array and call `savePizzerias()`
5. Keep it compact — use `text-xs` styling consistent with the rest of the card

## Save Flow
- Same optimistic pattern as the rest of PizzeriaSelection
- Update local state immediately, call `savePizzerias(updated)` which calls `saveField('pizzerias', { selected_pizzerias: updated })`
- On failure, reverts to `party.selectedPizzerias`

## Display
Already handled — `ParticipatingPizzerias.tsx` renders `pizzeria.description` on the public event page. No changes needed there.

## Verification
1. Select a pizzeria on the host page Pizza tab
2. Click the tagline area → should open editable input
3. Type a tagline, click away → should save
4. Reload page → tagline persists
5. Check event page → tagline appears under pizzeria name
