# RSV.Pizza - Claude Instructions

## Project Overview
RSV.Pizza is an event RSVP platform with pizza ordering integration, built with React/TypeScript frontend and Supabase backend.

## Task Management Workflow

### Project Sheet
Tasks are tracked in the project Google Sheet, accessible via the sheets-claude MCP.
- Config: `.sheets-claude.json` contains the sheet URL
- Use `mcp__sheets-claude__get_project_tasks` to list tasks

### Complete Workflow

```
1. GET TASKS      →  Fetch from project sheet
2. PLAN           →  Spawn planning agents (background, parallel)
3. SAVE PLANS     →  Plans saved to plans/{task-id}-{slug}.md
4. REVIEW PLANS   →  Snax and Claude review together
5. IMPLEMENT      →  Spawn implementation agents on feature branches
6. REVIEW CODE    →  Snax and Claude review changes
7. MERGE          →  Merge approved branches to master
8. MARK DONE      →  Update project sheet
```

### Phase 1: Planning

**Do NOT enter plan mode directly** - spawn background planning agents instead.

```
Task tool:
- subagent_type: "Plan"
- run_in_background: true
- prompt: Include task ID, read codebase, write plan to plans/{task-id}-{slug}.md
```

**Batch planning**: Queue multiple planning agents in parallel for efficiency.

**Plan file format** (`plans/{task-id}-{slug}.md`):
- Task ID and priority
- Problem/feature description
- Root cause (for bugs)
- Database changes needed
- Files to create/modify
- Step-by-step implementation
- Verification steps

### Phase 2: Review Plans

- Claude summarizes each plan for Snax
- Discuss approach, ask clarifying questions
- Approve or adjust plans before implementation

### Presenting Tasks to Snax

**Always include task IDs** when listing or discussing tasks:

```
| Task ID | Task | Priority |
|---------|------|----------|
| burrata-71044 | Code entry bug fix | High |
```

This makes it easy for Snax to refer to specific tasks in conversation.

### Phase 3: Implementation

**Each task gets its own git worktree** for isolated parallel work, with **draft PRs** for Vercel previews.

#### Worktree Setup
```bash
# Agent creates isolated worktree with feature branch
git worktree add ../rsvpizza-{task-id} -b feature/{task-id}-{name}
cd ../rsvpizza-{task-id}
```

#### Agent Instructions
```
Task tool:
- subagent_type: "general-purpose"
- run_in_background: true
- prompt:
  1. Create worktree: git worktree add ../rsvpizza-{task-id} -b feature/{task-id}-{name}
  2. cd into the worktree directory
  3. Read plan from plans/{task-id}.md (copy from main repo if needed)
  4. Implement the approved changes
  5. Commit with descriptive message including task ID
  6. Push branch: git push -u origin feature/{task-id}-{name}
  7. Create draft PR: gh pr create --draft --title "Task ID: Description" --body "..."
  8. Report:
     - PR URL
     - Vercel preview URL: https://rsvpizza-git-feature-{task-id}-{name}-pizza-dao.vercel.app
     - Files changed
```

#### Vercel Preview URLs
PRs automatically get Vercel preview deployments:
```
https://rsvpizza-git-{branch-name}-pizza-dao.vercel.app
```

Example: `feature/diavola-85351-photo-widget` →
`https://rsvpizza-git-feature-diavola-85351-photo-widget-pizza-dao.vercel.app`

#### After Review
```bash
# Merge the PR via GitHub (or locally)
gh pr merge {pr-number} --merge

# Clean up worktree
git worktree remove ../rsvpizza-{task-id}
```

**Parallel implementation**: Multiple agents work in separate worktrees simultaneously - no conflicts.

**Small tasks** (< 10 lines, single file): Can be done directly by Claude in main repo after plan review.

### Phase 4: Review & Merge

For each feature branch:
1. Review the changes with Snax
2. Test if needed
3. Commit with descriptive message
4. Merge to master (or create PR)
5. Mark task done in project sheet

### Branching Convention

| Branch | Purpose |
|--------|---------|
| `master` | Production-ready code |
| `feature/{task-id}-{name}` | Individual task implementation |

Example: `feature/bellpepper-71328-ios-scroll`

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

## Notes
- Project sheet MCP update has a bug (updates header instead of row) - mark tasks done manually for now
- Supabase storage buckets must be created via dashboard, not code
