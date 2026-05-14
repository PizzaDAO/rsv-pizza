# artichoke-93963 — Add copy email buttons to admin sections

**Priority**: Medium
**Task**: Add copy email buttons next to every email displayed in admin sections, matching the existing pattern on the partners tab of `/underboss` (PartnerManager.tsx).

---

## Reference pattern

`frontend/src/components/underboss/PartnerManager.tsx` lines 264-275:

```tsx
<button
  onClick={(e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(partner.email);
    setCopiedEmail(partner.id);
    setTimeout(() => setCopiedEmail(null), 1500);
  }}
  className="shrink-0 opacity-40 hover:opacity-100 transition-opacity text-theme-text-faint"
  title="Copy email"
>
  {copiedEmail === partner.id ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
</button>
```

State at top of component:
```tsx
const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
```

---

## Approach

Extract the pattern into a reusable component to avoid duplicating state in every consumer. Use it in all 5 locations and refactor `PartnerManager.tsx` to use it too.

### New component

**File**: `frontend/src/components/CopyEmailButton.tsx`

```tsx
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyEmailButtonProps {
  email: string;
  size?: number;
  className?: string;
}

export function CopyEmailButton({ email, size = 12, className = '' }: CopyEmailButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`shrink-0 opacity-40 hover:opacity-100 transition-opacity text-theme-text-faint ${className}`}
      title="Copy email"
    >
      {copied ? <Check size={size} className="text-green-400" /> : <Copy size={size} />}
    </button>
  );
}
```

---

## Files to modify

### 1. `frontend/src/components/CopyEmailButton.tsx` — CREATE
New reusable component as above.

### 2. `frontend/src/pages/AdminPage.tsx` — 4 spots
For each table row that renders an email in a `<td>`, wrap the email cell content in a flex container with the email text + `<CopyEmailButton email={x} />`.

- **~line 639** (Admin list): `{admin.email}` → flex wrapper with `<CopyEmailButton email={admin.email} />`
- **~line 746** (Graphics Admin list): `{ga.email}` → same
- **~line 863** (Underboss list): `{ub.email}` → same
- **~line 1030** (Sponsor/Partner list): `{sp.email}` → same

Pattern for each `<td>`:
```tsx
<td className="px-4 py-3 text-theme-text">
  <div className="flex items-center gap-2">
    <span>{admin.email}</span>
    <CopyEmailButton email={admin.email} />
  </div>
</td>
```

Add `import { CopyEmailButton } from '../components/CopyEmailButton';` at the top.

### 3. `frontend/src/components/underboss/EventRow.tsx` — 1 spot
**~line 613**: `event.host.email` is shown in a truncated div. Wrap in a flex container.

```tsx
{event.host.email && (
  <div className="flex items-center gap-1">
    <div className="text-xs text-theme-text-faint truncate max-w-[150px]">{event.host.email}</div>
    <CopyEmailButton email={event.host.email} />
  </div>
)}
```

Add the import.

### 4. `frontend/src/components/underboss/PartnerManager.tsx` — REFACTOR
Replace the inline copy button (lines 264-275) with `<CopyEmailButton email={partner.email} />`. Remove the now-unused `copiedEmail` state and `setCopiedEmail` setter. Keep behavior identical.

Add the import. Remove `Copy` and `Check` from `lucide-react` imports if they're no longer used elsewhere in the file (verify first — `Check` is also used at line 280 and 285, so it should stay).

---

## Verification

After implementation:
1. `cd frontend && npm run build` — must pass with no TypeScript errors
2. Visual check on Vercel preview:
   - `/admin` → Admins tab → click copy icon on a row → confirm icon flips to green check for 1.5s, email is in clipboard
   - `/admin` → Graphics Admins tab → same
   - `/admin` → Underbosses tab → same
   - `/admin` → Partners tab → same
   - `/underboss` → Events tab → click copy icon next to host email → same
   - `/underboss` → Partners tab → confirm refactored button still works identically (the original existing one)
3. Confirm clicking the copy button doesn't trigger row-level click handlers (the `e.stopPropagation()` covers this).

---

## Non-goals
- Do NOT modify `ClickableEmail` component — it's used for domain-only links in other contexts.
- Do NOT add copy buttons in non-admin places (event RSVP lists for guests, etc.) — out of scope for this task.
- Do NOT add toast notifications — the inline check icon is the existing UX pattern.
