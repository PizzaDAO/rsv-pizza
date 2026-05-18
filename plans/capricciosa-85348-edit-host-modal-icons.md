# capricciosa-85348 — Edit Host modal: per-line layout + icons on every field

**Priority:** P3 (UI consistency / project convention compliance)

## Goal

Bring the Edit Host modal on `/host/:inviteCode` (Details tab → host row → edit pencil) into compliance with the project's `IconInput` rule (CLAUDE.md "Reusable Components"), and give every field its own line so the layout is consistent top-to-bottom.

Concretely:

1. Replace every raw `<input>` in the Edit Host modal with `IconInput`.
2. Give each text field an appropriate `lucide-react` (or custom-svg) icon.
3. Stack Twitter and Instagram instead of placing them side-by-side in a 2-column grid.
4. Preserve all existing onBlur behavior: `normalizeUrl` (Website), `stripToHandle` + `fetchXAvatarToSupabase` auto-fill (Twitter), `stripToHandle` (Instagram).

## Scope

**In scope:** The Edit Host modal block in `frontend/src/components/HostsManager.tsx` (`{/* Host Edit Modal */}`, currently ~lines 510-631 — the actual input block is lines 557-608).

**Out of scope:** The Add Host modal immediately below (`{/* Add Host Modal */}`, ~lines 633+). Snax explicitly asked only about the Edit modal. The Add modal has the same raw `<input>` set and the same Twitter/Instagram 2-col grid; **it will be visually inconsistent with the Edit modal until a follow-up task addresses it**. Left intentionally — do not opportunistically modify, to keep this PR's diff tight and reviewable.

## Files to change

### `frontend/src/components/HostsManager.tsx`

- **Imports (line 3)** — add `IconInput` import; expand the `lucide-react` import set with `Mail`.
- **Edit Host modal input block** — lines 557-608 (the five `<input>` elements: name, email, website, and the `grid grid-cols-2` containing twitter + instagram).

No other files change. `IconInput.tsx` already supports everything needed (see "IconInput capability check" below).

## IconInput capability check

`frontend/src/components/IconInput.tsx`:

- Extends `React.InputHTMLAttributes<HTMLInputElement>` — so `type`, `value`, `onChange`, `onBlur`, `required`, `disabled`, etc. all pass through via `{...props}`. **All five existing handlers (including the async Twitter onBlur with avatar auto-fetch) work as-is.**
- Accepts `icon: LucideIcon` for stock lucide icons, OR `customIcon: React.ReactNode` for inline SVGs (used by `PartnerForm.tsx` to provide the X/Twitter glyph since lucide does not export a current "X" mark).
- Auto-appends ` *` to the placeholder when `required` is true and the placeholder doesn't already end with `*`. **Change the existing literal `"Name *"` placeholder to `"Name"` with `required` instead**, to avoid a doubled `Name * *`.
- Default icon spacing reserves `!pl-14`, so input internal padding is correct out of the box.

No IconInput gaps. Nothing to extend.

## Icon picks (verified against existing imports / lucide-react)

| Field | Icon | Source | Notes |
|-------|------|--------|-------|
| Name | `User` | `lucide-react` | Already imported in HostsManager (line 3). |
| Email | `Mail` | `lucide-react` | Used by `AccountPage.tsx` and `AuthVerifyPage.tsx`. Add to HostsManager import. |
| Website | `Globe` | `lucide-react` | Already imported in HostsManager (line 3). Project convention — see `AccountPage.tsx`, `PartnerForm.tsx`. |
| Twitter | inline `XIcon` SVG via `customIcon` | local component | Lucide does **not** export a current X-mark; the project's established pattern is the SVG in `frontend/src/components/sponsors/PartnerForm.tsx` lines 13-17. Use the **same path data** for visual consistency. Declare a small `XIcon` component at the top of `HostsManager.tsx` (after imports) — do **not** import from `PartnerForm.tsx` (it's not exported there). |
| Instagram | `Instagram` | `lucide-react` | Already imported in HostsManager (line 3). |

`XIcon` boilerplate — copy verbatim from `PartnerForm.tsx`:

```tsx
const XIcon: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);
```

Used via `customIcon` exactly the way `PartnerForm.tsx` does:

```tsx
customIcon={<XIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />}
```

## Step-by-step changes

### 1. Imports

At `HostsManager.tsx` line 3, expand the lucide import to add `Mail`:

```tsx
import { User, UserPlus, X, Globe, Instagram, GripVertical, ChevronDown, ChevronUp, Upload, Mail } from 'lucide-react';
```

Add a new import line below the existing `Checkbox` import:

```tsx
import { IconInput } from './IconInput';
```

### 2. XIcon component

After the imports and before the `interface HostsManagerProps` declaration, add the `XIcon` component shown above. Keep it module-local (no export) — matches `PartnerForm.tsx`'s pattern.

### 3. Replace the five raw inputs (lines 557-608)

Replace the entire block from line 557 (`<input` for name) through line 608 (closing `</div>` of the `grid grid-cols-2` wrapper) with five sibling `IconInput`s — all inside the existing `space-y-3` container (line 516), which gives them per-line vertical spacing:

```tsx
<IconInput
  icon={User}
  type="text"
  value={editHostName}
  onChange={(e) => setEditHostName(e.target.value)}
  placeholder="Name"
  required
/>

<IconInput
  icon={Mail}
  type="email"
  value={editHostEmail}
  onChange={(e) => setEditHostEmail(e.target.value)}
  placeholder="Email (required to edit event)"
/>

<IconInput
  icon={Globe}
  type="url"
  value={editHostWebsite}
  onChange={(e) => setEditHostWebsite(e.target.value)}
  onBlur={() => setEditHostWebsite(normalizeUrl(editHostWebsite))}
  placeholder="Website"
/>

<IconInput
  customIcon={<XIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />}
  type="text"
  value={editHostTwitter}
  onChange={(e) => setEditHostTwitter(e.target.value)}
  onBlur={async () => {
    const handle = stripToHandle(editHostTwitter);
    setEditHostTwitter(handle);
    if (!handle) return;
    if (editHostAvatarFile) return;
    if (editHostAvatarUrl.trim() && !isAutoFilledXAvatar(editHostAvatarUrl)) return;
    const fetched = await fetchXAvatarToSupabase(handle);
    if (fetched) setEditHostAvatarUrl(fetched);
  }}
  placeholder="Twitter (no @)"
/>

<IconInput
  icon={Instagram}
  type="text"
  value={editHostInstagram}
  onChange={(e) => setEditHostInstagram(e.target.value)}
  onBlur={() => setEditHostInstagram(stripToHandle(editHostInstagram))}
  placeholder="Instagram (no @)"
/>
```

Key points to preserve from the existing code:

- **Name `*` marker** — previous placeholder was `"Name *"`. Drop the literal `*` and use `required` instead — `IconInput` auto-renders the asterisk. Submission logic unchanged (Save button disable check at line 622 uses `editHostName.trim()` independently).
- **Website onBlur** — `() => setEditHostWebsite(normalizeUrl(editHostWebsite))` preserved verbatim.
- **Twitter onBlur** — the entire async block (stripToHandle, `editHostAvatarFile` guard, `isAutoFilledXAvatar` guard, `fetchXAvatarToSupabase`, `setEditHostAvatarUrl`) copied verbatim from lines 587-596. **Do not refactor this** — there's an in-flight related task `zucchini-24569` (host X avatar refetch) that may change this logic; touching it here risks a merge conflict.
- **Instagram onBlur** — `() => setEditHostInstagram(stripToHandle(editHostInstagram))` preserved verbatim.
- The wrapping `<div className="grid grid-cols-2 gap-3">` (line 582) and its closing `</div>` (line 608) are **deleted**; Twitter and Instagram become direct children of the `space-y-3` block, giving them their own lines stacked.

### 4. Leave avatar block alone

Lines 517-555 (the avatar upload `div` with the file `input`, preview, `Upload` button, and Clear button) are **unchanged**. The `Upload` icon already satisfies the "every field has an icon" rule. The hidden `<input type="file" />` is OK as a raw input because (a) `IconInput` does not target file inputs, and (b) it's `className="hidden"` — not a visible field.

### 5. Leave the modal frame, header, footer buttons alone

Lines 511-516 (the portal root, backdrop, card, `<h2>`) and lines 611-631 (footer Cancel/Save row) are **unchanged**.

## Acceptance criteria

1. Open `/host/:inviteCode`, switch to the Details tab, click the edit pencil on any host row → modal opens. Each of the five visible text fields (Name, Email, Website, Twitter, Instagram) renders with a left-side icon (User / Mail / Globe / X-glyph / Instagram) at the same horizontal position; placeholder text is indented past the icon. Avatar row at the top retains its `Upload` button icon.
2. All five fields are on their own line — no two fields share a row. Twitter and Instagram are stacked, not side-by-side.
3. Name field shows ` *` after "Name" in the placeholder (auto-rendered by `IconInput`).
4. Type something into Website, e.g. `example.com`, tab out → value becomes `https://example.com` (normalizeUrl still fires).
5. Type a Twitter handle e.g. `@snaxbar`, tab out → value normalizes to `snaxbar`, AND if avatar slot is empty or holds a legacy unavatar URL, the avatar preview updates via fxtwitter. Same behavior as before.
6. Type an Instagram handle e.g. `@snaxig`, tab out → value normalizes to `snaxig`.
7. Save with a blank Name → button is disabled (existing guard at line 622 unchanged).
8. Modal click-outside-to-close, Cancel button, and Save button all still work — only the input block changes.
9. TypeScript build clean; no new ESLint warnings.

## Out of scope (explicit)

- **Add Host modal** (`{/* Add Host Modal */}`, ~lines 633+) — same raw `<input>` set and 2-col grid; will look inconsistent with the redesigned Edit modal until a follow-up. Document in PR description as a known follow-up.
- `zucchini-24569` (host X avatar refetch) — do not touch the Twitter `onBlur` body; copy lines verbatim.
- Avatar row redesign or icon swap.
- Modal frame/styling tweaks (heading size, button styling, backdrop opacity).
- Extracting `XIcon` to a shared module (worth doing later if a third caller appears; not now).
- Any backend changes.

## Critical files for implementation

- `frontend/src/components/HostsManager.tsx` — only file edited
- `frontend/src/components/IconInput.tsx` — reference only, no edits
- `frontend/src/components/sponsors/PartnerForm.tsx` — reference for `XIcon` SVG, no edits
