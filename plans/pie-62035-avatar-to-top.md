# pie-62035 — Move avatar upload to top of Edit Host & Add Host modals

**Priority:** P2
**File:** `frontend/src/components/HostsManager.tsx`

## Goal
Move the avatar upload block to the top of the Edit Host modal (and the matching Add Host modal). The avatar preview should sit on the left, the Upload button on the right, with the Clear link after the button. The block should sit above the Name field, separated from the rest of the form by the existing `space-y-3` spacing.

Current order in both modals: Name → Email → Website → Twitter/Instagram → **Avatar upload** (button | avatar | clear).
Target order: **Avatar upload** (avatar | button | clear) → Name → Email → Website → Twitter/Instagram.

## Files to modify
- `frontend/src/components/HostsManager.tsx` — only file.

## Changes

### Edit Host modal (around lines 510–629)

Move the entire `{/* Avatar upload */}` block (currently lines ~570–606) to be the **first** child inside the `<div className="space-y-3">` container (above the Name input at line 517).

Inside that block, reorder the flex row so the avatar preview comes first, then the Upload button, then the Clear link. The flex row currently renders: `[Upload button] [<img>] [Clear button]`. Change to: `[<img> placeholder when none] [Upload button] [Clear button]`.

To keep the row vertically balanced when there is no avatar yet, render a neutral placeholder circle (same `w-10 h-10 rounded-full` dimensions) when `editAvatarFilePreview || editHostAvatarUrl` is falsy. Use `bg-theme-surface border border-theme-stroke` for the placeholder background.

Resulting JSX shape inside the `flex items-center gap-3` row:

```jsx
{(editAvatarFilePreview || editHostAvatarUrl) ? (
  <img
    src={editAvatarFilePreview || editHostAvatarUrl}
    alt=""
    className="w-10 h-10 rounded-full object-cover border border-white/20 shrink-0"
    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
  />
) : (
  <div className="w-10 h-10 rounded-full bg-theme-surface border border-theme-stroke shrink-0" />
)}
<button
  type="button"
  onClick={() => editAvatarInputRef.current?.click()}
  className="flex items-center gap-2 px-3 py-2 bg-theme-surface border border-theme-stroke rounded-lg text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover transition-colors text-sm"
>
  <Upload size={16} />
  Upload avatar
</button>
{(editAvatarFilePreview || editHostAvatarUrl) && (
  <button
    type="button"
    onClick={() => { setEditHostAvatarFile(null); setEditHostAvatarUrl(''); }}
    className="text-xs text-red-400 hover:text-red-300"
  >
    Clear
  </button>
)}
```

The hidden `<input type="file" ref={editAvatarInputRef} … />` stays inside the same wrapper `<div>` as the flex row.

### Add Host modal (around lines 631–~750)

Apply the **identical** reorder to the Add Host modal: move the `{/* Avatar upload */}` block to be the first child inside its `space-y-3` container, and reorder the row to `[avatar placeholder or <img>] [Upload button] [Clear]`. The state names there are `newAvatarFilePreview`, `newCoHostAvatarUrl`, `newAvatarInputRef`, `setNewCoHostAvatarFile`, `setNewCoHostAvatarUrl`, `handleNewAvatarFileChange`.

## Non-goals
- Do not change any state, refs, handlers, or upload logic.
- Do not change PartnerForm (different component, different request).
- Do not touch styling on the inputs themselves.

## Verification
1. Open an event as host → Hosts section → click pencil on a host → Edit Host modal opens.
   - Avatar block sits above the Name field.
   - When the host has an avatar: image on the left, Upload button to its right, Clear link after.
   - When no avatar: a neutral circle placeholder on the left, Upload button to its right, no Clear.
2. Click "Add Host" → same layout, with empty placeholder.
3. Upload a new image → preview replaces the placeholder, Clear appears.
4. Click Clear → preview returns to placeholder, Clear disappears.
5. Save flow still works unchanged.

## Branch
`pie-62035-avatar-to-top`
