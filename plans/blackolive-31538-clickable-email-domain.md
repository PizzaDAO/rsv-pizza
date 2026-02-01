# Make Email Domain Clickable When Reviewing RSVPs

**Task ID:** blackolive-31538
**Priority:** Mid
**Status:** Planned

## Problem

When hosts review RSVPs on the Guest List tab, they see guest emails as plain text with no way to quickly research the domain to verify if guests are from legitimate organizations.

## Solution

Make the domain part of email addresses clickable, opening the domain in a new tab.

Example: `john@company.com` → "john@" plain text + "company.com" as link to `https://company.com`

## Implementation

### 1. Create Email Utility (`frontend/src/utils/emailUtils.ts`)

```tsx
export function extractEmailDomain(email: string): string | null {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  return parts[1].toLowerCase();
}

export function extractEmailLocalPart(email: string): string {
  if (!email) return '';
  const parts = email.split('@');
  return parts[0] || email;
}
```

### 2. Create ClickableEmail Component (`frontend/src/components/ClickableEmail.tsx`)

```tsx
import React from 'react';
import { extractEmailDomain, extractEmailLocalPart } from '../utils/emailUtils';
import { ExternalLink } from 'lucide-react';

interface ClickableEmailProps {
  email: string;
  className?: string;
}

export const ClickableEmail: React.FC<ClickableEmailProps> = ({ email, className = '' }) => {
  const localPart = extractEmailLocalPart(email);
  const domain = extractEmailDomain(email);

  if (!domain) {
    return <span className={className}>{email}</span>;
  }

  return (
    <span className={className}>
      {localPart}@
      <a
        href={`https://${domain}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-white/70 hover:text-white hover:underline inline-flex items-center gap-0.5"
        onClick={(e) => e.stopPropagation()}
        title={`Visit ${domain}`}
      >
        {domain}
        <ExternalLink size={10} className="opacity-50" />
      </a>
    </span>
  );
};
```

### 3. Update TableRow Component

In `frontend/src/components/TableRow.tsx` (lines 176-178):

```tsx
// Before:
{guest.email && (
  <span className="text-white/50 text-sm truncate">{guest.email}</span>
)}

// After:
{guest.email && (
  <ClickableEmail email={guest.email} className="text-white/50 text-sm truncate" />
)}
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `frontend/src/utils/emailUtils.ts` | Create |
| `frontend/src/components/ClickableEmail.tsx` | Create |
| `frontend/src/components/TableRow.tsx` | Modify |

## Verification Steps

- [ ] Navigate to Host Page → Guests tab
- [ ] Hover over email domain → cursor changes, underline appears
- [ ] Click domain → opens `https://{domain}` in new tab
- [ ] Test corporate domains (google.com), personal (gmail.com), international (.co.uk)
- [ ] Verify clicking domain doesn't trigger row selection
- [ ] Test on mobile
