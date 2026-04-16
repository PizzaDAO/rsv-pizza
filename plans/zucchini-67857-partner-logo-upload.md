# zucchini-67857 — Add Partner form: logo file upload

**Priority**: Low (UX polish)

## Goal

On the /underboss Add Partner form, replace (or augment) the URL-only Logo input with a file upload, mirroring the pattern already used in CRM/Intake modes.

## File

`frontend/src/components/sponsors/PartnerForm.tsx`

## Current state

Around lines 698-715, partner mode has only a URL `IconInput`:
```tsx
<>
  <IconInput
    icon={Globe}
    type="url"
    value={formData.logoUrl}
    onChange={e => handleChange('logoUrl', e.target.value)}
    placeholder="Logo URL (for sponsor records)"
  />
  {formData.logoUrl && (
    <img
      src={formData.logoUrl}
      alt="Logo preview"
      className="w-16 h-16 object-contain rounded-lg border border-theme-stroke bg-theme-surface"
      onError={...}
    />
  )}
</>
```

CRM/Intake modes (around lines 653-696) already have the file-upload pattern using `uploadSponsorLogo` from `lib/supabase.ts`. The submit handler (lines 299-338) already conditionally calls `uploadSponsorLogo(logoFile)` if `(isCrm || isIntake) && logoFile`.

## Change

Use the same file-upload UI in partner mode that's used in CRM/Intake modes. Two approaches:

### Option A (recommended, minimal change)

Change the gating condition to include partner mode:
1. **Submit handler (line ~308)**: Change `if ((isCrm || isIntake) && logoFile)` → `if ((isCrm || isIntake || isPartner) && logoFile)`.
2. **Logo input section**: Replace the partner-mode-only block (lines 698-715) with the same JSX block CRM/Intake mode uses (lines 653-696). Or — refactor: extract the file-upload JSX to a common block that all three modes render.

### Option B (cleaner)

Just remove the partner-mode-specific branch entirely and let the existing CRM/Intake branch render in partner mode too. If the surrounding `{(isCrm || isIntake) && (...)}` wrapper exists, change it to `{(isCrm || isIntake || isPartner) && (...)}`.

Pick whichever is simpler given the surrounding code. Read lines 640-720 first to decide.

## Notes

- `uploadSponsorLogo` uploads to the `event-images` bucket under `sponsor-logos/`. No new storage config needed.
- Partner mode should keep accepting a manually-pasted URL too (the existing pattern offers both file upload and URL input as a fallback).
- Do not change anything else on the form (account, partner info, automation, notes).

## Verification

1. Open Vercel preview `/underboss` → Partners tab → click "Add Partner"
2. The Logo section should show the file upload UI (drag/drop or click to upload) AND optionally a URL input as fallback (whatever the CRM/Intake pattern provides)
3. Pick an image file → preview displays the local image
4. Fill in the rest and Submit → image uploads to Supabase storage → partner is created with the public URL stored in `coHostLogoUrl`
5. Edit the same partner → the logo loads from the stored URL and can be replaced
