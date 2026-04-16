# Underboss — Copy Selected Cities

## Feature
On the `/underboss` Events tab, when one or more events are selected via the row checkboxes, a "Copy Cities" action should be available in the bulk actions dropdown. Clicking it opens a modal that shows the list of cities from the selected events in alphabetical order, with a "Copy to Clipboard" button.

## File to Modify
- `frontend/src/components/underboss/EventTable.tsx`

## Implementation

### 1. Add state for the modal
```typescript
const [showCopyCitiesModal, setShowCopyCitiesModal] = useState(false);
const [copiedToClipboard, setCopiedToClipboard] = useState(false);
```

### 2. Add "Copy Cities" button in the actions dropdown
The dropdown is around lines 304-488. Add a new button right after "Send Telegram" (line 359). Reuse the existing city extraction logic (already in `Send Telegram` handler, lines 343-354).

```tsx
<button
  onClick={() => {
    setShowActionDropdown(false);
    setShowCopyCitiesModal(true);
  }}
  className="w-full text-left px-4 py-2 text-sm text-theme-text hover:bg-theme-surface transition-colors"
>
  Copy Cities
</button>
```

### 3. Build the sorted cities list (memoized)
Extract cities from selected events using the same logic as the Send Telegram button, then sort alphabetically (case-insensitive).

```typescript
const selectedCitiesSorted = useMemo(() => {
  const prefix = 'Global Pizza Party ';
  return events
    .filter(e => selectedIds.has(e.id))
    .map(e => e.name.startsWith(prefix) ? e.name.slice(prefix.length) : (e.customUrl || e.name))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}, [events, selectedIds]);
```

### 4. Modal component (inline or at end of file)
Follows existing patterns:
- Fixed backdrop: `bg-black/60 backdrop-blur-sm`
- `z-50`, click-outside-to-close
- `bg-theme-header border border-theme-stroke rounded-2xl`
- Close button (X icon)

**Modal content**:
- Title: `Copy Cities ({N} selected)`
- Read-only textarea or `<pre>` block showing `selectedCitiesSorted.join('\n')`. Make it selectable / scrollable for long lists.
- "Copy to Clipboard" button — uses `navigator.clipboard.writeText(selectedCitiesSorted.join('\n'))`. Show brief "Copied!" confirmation (toggle `copiedToClipboard` for 2 seconds).
- "Close" button

### 5. Render the modal with `createPortal`
Use `createPortal(..., document.body)` like existing modals in the codebase.

## Style Guidelines
- Use existing theme tokens (`bg-theme-surface`, `text-theme-text`, `text-theme-text-muted`, etc.)
- Red accent color `#ff393a` for the Copy button
- Consistent with rest of EventTable.tsx modals

## Verification
1. Go to `/underboss`, Events tab
2. Select 3-5 events via checkboxes
3. Click the actions dropdown → "Copy Cities"
4. Modal opens showing cities alphabetically, one per line
5. Click "Copy to Clipboard" → paste into a text editor → verify cities are in the clipboard
6. Close modal, verify selection is still active
7. Works on mobile (card view) too

## Out of Scope
- Does NOT change anything about the Cities tab
- Does NOT add city selection checkboxes to the Events tab (they already exist)
- Does NOT affect bulk approve/tag/telegram actions
