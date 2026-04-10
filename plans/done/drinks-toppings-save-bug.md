# Fix: Custom Drinks/Toppings Not Saving

## Root Cause

**5 related bugs found:**

### Bug 1: Names lost on reload (MAIN BUG)
Custom items are stored as opaque IDs like `custom-1712345678` in the DB (`available_beverages` / `available_toppings` arrays). The human-readable name (e.g., "Kombucha") is stored **only in React local state** — never persisted. On reload, the ID is loaded but the name is gone.

### Bug 2: Remove doesn't persist
`removeCustomBeverage` / `removeCustomTopping` only remove from local state — never update the DB. The orphaned ID stays in the array.

### Bug 3: Custom items invisible to guests
`RSVPFormStep2.tsx` filters against static `TOPPINGS` and `DRINKS` constants. Custom IDs like `custom-1712345678` don't exist in these constants, so guests never see them.

### Bug 4: ToppingsSettings never saves (dead code)
`ToppingsSettings.tsx` doesn't call `updatePartyToppings` on add — only saves if user clicks a separate Save button. (This file appears to be dead code — not imported anywhere.)

### Bug 5: Data model mismatch
`String[]` stores IDs that map to constants for standard items, but custom items get meaningless timestamp IDs.

## The Fix

**Change custom item ID format from `custom-{timestamp}` to `custom:{Name}`**

- Self-describing: ID carries the name (`custom:Kombucha`)
- No DB schema change needed (still `String[]`)
- On reload, any ID starting with `custom:` has its name extracted
- RSVP guest form can display custom items by parsing the prefix

## Files to Change

| File | Change |
|------|--------|
| `frontend/src/components/BeverageSettings.tsx` | Fix ID format, restore names on load, fix remove |
| `frontend/src/components/PizzaStyleAndToppings.tsx` | Fix ID format, restore names on load, fix remove |
| `frontend/src/components/RSVPFormStep2.tsx` | Render custom toppings/drinks for guests |
| `frontend/src/components/ToppingsSettings.tsx` | Delete (dead code) or fix |

## Implementation

### BeverageSettings.tsx / PizzaStyleAndToppings.tsx

```typescript
// Initialize custom items from saved party data
const [customBeverages, setCustomBeverages] = useState<string[]>(() => {
  return (party?.availableBeverages || [])
    .filter(id => id.startsWith('custom:'))
    .map(id => id.slice('custom:'.length));
});

// Add: use custom:Name format
const addCustomBeverage = () => {
  if (customInput.trim()) {
    const customId = `custom:${customInput.trim()}`;
    if (selectedBeverages.includes(customId)) return; // prevent dupes
    setCustomBeverages(prev => [...prev, customInput.trim()]);
    const newSelection = [...selectedBeverages, customId];
    setSelectedBeverages(newSelection);
    updatePartyBeverages(newSelection);
    setCustomInput('');
  }
};

// Remove: also update DB
const removeCustomBeverage = (index: number) => {
  const removedName = customBeverages[index];
  const removedId = `custom:${removedName}`;
  setCustomBeverages(prev => prev.filter((_, i) => i !== index));
  const newSelection = selectedBeverages.filter(id => id !== removedId);
  setSelectedBeverages(newSelection);
  updatePartyBeverages(newSelection);
};
```

### RSVPFormStep2.tsx

After standard items, render custom items:
```typescript
{/* Custom toppings */}
{form.availableToppings.filter(id => id.startsWith('custom:')).map(id => {
  const name = id.slice('custom:'.length);
  // Render same topping chip UI with name and id
})}

{/* Custom drinks */}
{form.availableBeverages.filter(id => id.startsWith('custom:')).map(id => {
  const name = id.slice('custom:'.length);
  // Render same drink chip UI
})}
```

### Backward Compatibility

Old `custom-{timestamp}` IDs have lost their names — filter them out on next save.

## Verification

1. Host adds custom drink → navigate away and back → still there
2. Host adds custom topping → refresh page → still there
3. Host removes custom drink → refresh → stays gone
4. Guest RSVPs → sees custom toppings/drinks in selection
5. Standard items still work correctly
6. Pizza algorithm still works with custom topping IDs
