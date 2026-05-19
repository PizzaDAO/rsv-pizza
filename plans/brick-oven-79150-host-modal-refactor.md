# brick-oven-79150 — Refactor add/edit host modals to share a single component

## Problem
`frontend/src/components/HostsManager.tsx` has two near-identical inline modals (~140 lines duplicated):
- **Edit Host modal** (currently lines 510–631) — no permission checkboxes.
- **Add Host modal** (currently lines 633–771) — adds "Show on event" + "Editor" checkboxes and a `UserPlus` icon on the submit button.

Visual structure is otherwise identical.

Per product decision: **both** modals will show the "Show on event" + "Editor" checkboxes. For Edit mode, they wire to `toggleCoHostShowOnEvent` / `toggleCoHostCanEdit` (the existing inline-row handlers).

## Scope
- Single component to extract; only `frontend/src/components/HostsManager.tsx` is modified, and one new file is added.
- No backend, API, DB, or call-site changes (`EventDetailsTab.tsx` imports `HostsManager` and is untouched).

## Approach

### 1. New file: `frontend/src/components/HostFormModal.tsx`

Presentational component. Owns modal chrome + form JSX; all state via props.

```ts
interface HostFormModalProps {
  open: boolean;
  mode: 'add' | 'edit';
  name: string;
  email: string;
  website: string;
  twitter: string;
  instagram: string;
  telegram: string;
  avatarUrl: string;
  avatarFilePreview: string | null;
  showOnEvent: boolean;
  canEdit: boolean;
  xAvatarFetching: boolean;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onWebsiteChange: (v: string) => void;
  onWebsiteBlur: () => void;
  onTwitterChange: (v: string) => void;
  onTwitterBlur: () => void | Promise<void>;
  onInstagramChange: (v: string) => void;
  onInstagramBlur: () => void;
  onTelegramChange: (v: string) => void;
  onTelegramBlur: () => void;
  onShowOnEventChange: () => void;
  onCanEditChange: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onAvatarFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarClear: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
}
```

JSX template — use the **edit modal version** as the base (current lines 511–630) and adapt:
- Title: `mode === 'add' ? 'Add Host' : 'Edit Host'`
- Submit button: `submitting ? (mode === 'add' ? 'Adding...' : 'Saving...') : (mode === 'add' ? 'Add Host' : 'Save')`
- Submit button keeps `<UserPlus size={16} />` icon in both modes (use `flex items-center justify-center gap-2` classes from the current Add button).
- Render the two `Checkbox`es (Show on event + Editor) in **both** modes, with the existing wrapper `<div className="flex items-center gap-4 mt-3">`, positioned after the input grid and before the button row (same position the Add modal uses today).
- `createPortal(..., document.body)` exactly as today.
- Guard with `if (!open) return null;` at top.

Imports needed: `React`, `createPortal` from `react-dom`, `User, Mail, Globe, Instagram, Send, Upload, UserPlus, Loader2` from `lucide-react`, `Checkbox` from `./Checkbox`, `IconInput` from `./IconInput`.

### 2. Modify `frontend/src/components/HostsManager.tsx`

Replace the two inline modal JSX blocks (current lines 510–771) with two `<HostFormModal>` invocations.

**Edit invocation:**
- `open={editingHostId !== null}`
- `mode="edit"`
- All field props bound to existing `editHost*` state and setters
- `avatarUrl={editHostAvatarUrl}`, `avatarFilePreview={editAvatarFilePreview}`
- `fileInputRef={editAvatarInputRef}`, `onAvatarFileChange={handleEditAvatarFileChange}`
- `onAvatarClear={() => { setEditHostAvatarFile(null); setEditHostAvatarUrl(''); setEditHostAvatarFromX(null); }}`
- `showOnEvent` / `canEdit`: look up via `coHosts.find(h => h.id === editingHostId)`; default to safe fallbacks (`true`/`false`) if not found
- `onShowOnEventChange={() => editingHostId && toggleCoHostShowOnEvent(editingHostId)}`
- `onCanEditChange={() => editingHostId && toggleCoHostCanEdit(editingHostId)}`
- `onWebsiteBlur={() => setEditHostWebsite(normalizeUrl(editHostWebsite))}`
- `onTwitterBlur`: keep the existing async logic (strip handle → maybe fetch avatar). Encapsulate as an inline arrow that does what current lines 587–596 do.
- `onInstagramBlur={() => setEditHostInstagram(stripToHandle(editHostInstagram))}`
- `onTelegramBlur={() => setEditHostTelegram(stripToHandle(editHostTelegram))}`
- `onSubmit={saveHostEdit}`, `onCancel={cancelEditingHost}`, `submitting={savingHost}`

**Add invocation:** symmetric — bind to `newCoHost*` state, `newAvatarInputRef`, `handleNewAvatarFileChange`; `onSubmit={addCoHost}`, `onCancel={() => setShowAddHostModal(false)}`; `showOnEvent={newCoHostShowOnEvent}` with `onShowOnEventChange={() => setNewCoHostShowOnEvent(!newCoHostShowOnEvent)}`; same for `canEdit`.

Add import: `import HostFormModal from './HostFormModal';` near the top.

Leave the Add Host trigger button at line 500–508 unchanged (it keeps its own `UserPlus` icon).

### 3. No call-site changes
`EventDetailsTab.tsx` keeps importing `HostsManager` — public surface unchanged.

## Test Plan
- Open Edit Host modal — fields prefill from current host, checkboxes reflect current state, toggling them mutates the host record (same as inline row), Save persists, modal closes.
- Open Add Host modal — empty fields, defaults Show=true, Editor=false, Add creates the host.
- X handle blur in both modes auto-fetches avatar if avatar slot empty.
- Website blur in both modes normalizes URL.
- Cancel button + click-backdrop close both modals.
- TypeScript build passes with zero errors.

## Out of Scope
- Permission tabs expander (current lines 452+) stays inline on the host row.
- HostsList component (read-only host display) — separate UI surface, untouched.
- Backend changes.
