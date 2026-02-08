# RSV.Pizza

## Project Overview
RSV.Pizza is an event RSVP platform with pizza ordering integration, built with React/TypeScript frontend and Supabase backend.

## Tech Stack
- **Frontend**: React, TypeScript, Vite, TailwindCSS
- **Backend**: Supabase (Postgres, Auth, Storage, Edge Functions)
- **Payments**: Stripe
- **Deployment**: Vercel (frontend), Supabase (backend)

## Key Directories
- `frontend/src/pages/` - Page components (EventPage, HostPage, RSVPPage, etc.)
- `frontend/src/components/` - Reusable components
- `frontend/src/lib/` - Supabase client, API functions, Stripe utilities
- `frontend/src/contexts/` - React contexts (Auth, Pizza)
- `frontend/src/hooks/` - Custom React hooks
- `backend/` - Express API with Prisma
- `backend/prisma/` - Database schema
- `supabase/functions/` - Edge functions
- `plans/` - Task implementation plans

## Vercel Preview URL Pattern
```
https://rsvpizza-git-{branch-name}-pizza-dao.vercel.app
```

## Default Branch
This project uses `master` instead of `main`.

## Supabase MCP
Use **`mcp__supabase-pizzadao__`** for this project (not `supabase-snax`).
- Project ID: `znpiwdvvsqaxuskpfleo`
- Project Name: RSV.Pizza

## Branching Convention
- Use `{task-id}-{short-name}` for branches (no `feature/` prefix)
- Example: `buffalo-39031-donation` not `feature/buffalo-39031-donation-option`
- Shorter branch names = shorter Vercel preview URLs

## Reusable Components

**ALWAYS use these existing components instead of writing custom markup:**

| Component | Use For |
|-----------|---------|
| `IconInput` | All text inputs and textareas. Use `multiline` prop for textarea mode. |
| `Checkbox` | All checkboxes/toggles |
| `ClickableEmail` | Displaying emails (makes domain clickable) |
| `CustomUrlInput` | URL slug inputs with `rsv.pizza/` prefix + live validation |
| `LocationAutocomplete` | Address/location inputs (Google Maps autocomplete) |
| `TimezonePickerInput` | Timezone selection |
| `Layout` | Page wrapper (Header + Footer + CornerLinks) |
| `HostsList` | Displaying co-hosts with avatars |
| `TableRow` | Guest/pizza/beverage list rows (multi-variant) |
| `LoginModal` | Auth modal pattern (backdrop + card + close button) |

**Rules:**
- Never create raw `<input>` elements — use `IconInput`
- Never create raw `<textarea>` elements — use `IconInput` with `multiline`
- Never create raw checkboxes — use `Checkbox`
- **Always use placeholders instead of labels** — no `<label>` elements above fields. Put descriptive text in the placeholder. Use small helper text below (`text-xs text-white/40`) only when necessary.
- Follow existing modal patterns (fixed backdrop + `z-50` + click-outside-to-close)

## Project-Specific Notes
- Supabase storage buckets must be created via dashboard, not code
- **Preview deploys share production backend + DB.** Frontend previews auto-deploy per branch, but the backend only deploys from `master` and the database is a single Supabase instance. New DB columns and backend endpoints must be applied to production **before** they'll work on preview branches.
