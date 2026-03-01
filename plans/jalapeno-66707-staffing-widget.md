# jalapeno-66707: Staffing Widget

**Task ID:** jalapeno-66707
**Priority:** Medium
**Status:** In Progress

## Overview

A widget for hosts to manage event staff members, track their roles, contact information, and status. This enables event organizers to coordinate their team for pizza parties.

## Data Model

### New Prisma Model: `Staff`

```prisma
model Staff {
  id              String    @id @default(uuid()) @db.Uuid
  partyId         String    @map("party_id") @db.Uuid
  party           Party     @relation(fields: [partyId], references: [id], onDelete: Cascade)

  // Staff info
  name            String
  email           String?
  phone           String?
  role            String    // Role/position (e.g., "Coordinator", "Door", "Bar", "DJ", etc.)

  // Status
  status          String    @default("invited") // invited, confirmed, declined, checked_in
  confirmedAt     DateTime? @map("confirmed_at") @db.Timestamptz
  checkedInAt     DateTime? @map("checked_in_at") @db.Timestamptz

  // Notes
  notes           String?

  // Metadata
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  @@index([partyId, status])
  @@map("staff")
}
```

### Staff Status Options
| Status | Color | Description |
|--------|-------|-------------|
| invited | Gray | Invited but not confirmed |
| confirmed | Green | Confirmed attendance |
| declined | Red | Declined |
| checked_in | Blue | Checked in at event |

### Staff Role Suggestions
- Coordinator
- Door / Check-in
- Bar / Drinks
- DJ / Music
- Photography
- Decorations
- Setup / Teardown
- Pizza Pickup
- General Help

## API Routes

### New File: `backend/src/routes/staff.routes.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/parties/:partyId/staff` | Host | List all staff for a party |
| POST | `/api/parties/:partyId/staff` | Host | Add a new staff member |
| GET | `/api/parties/:partyId/staff/stats` | Host | Get staff statistics |
| PATCH | `/api/parties/:partyId/staff/:staffId` | Host | Update staff member |
| DELETE | `/api/parties/:partyId/staff/:staffId` | Host | Remove staff member |

## Frontend Components

### New Components Structure

```
frontend/src/components/staffing/
├── StaffingWidget.tsx      # Main widget container
├── StaffCard.tsx           # Individual staff card
├── StaffForm.tsx           # Add/edit staff modal
├── StaffStats.tsx          # Statistics display
└── index.ts                # Exports
```

## UI Design

### StaffingWidget (Compact Card View)
```
┌─────────────────────────────────────────────────────┐
│ Staff                                   [+ Add Staff] │
├─────────────────────────────────────────────────────┤
│ 4 confirmed  |  1 pending  |  1 checked in          │
├─────────────────────────────────────────────────────┤
│ [Avatar] John Smith                    [Confirmed ●] │
│          Coordinator                    [Edit] [✕]   │
├─────────────────────────────────────────────────────┤
│ [Avatar] Jane Doe                       [Pending ●]  │
│          DJ / Music                     [Edit] [✕]   │
└─────────────────────────────────────────────────────┘
```

## Implementation Steps

1. Update Prisma schema with Staff model
2. Create staff.routes.ts with CRUD operations
3. Register routes in backend/src/index.ts
4. Add Staff type to frontend/src/types.ts
5. Add staff API functions to frontend/src/lib/api.ts
6. Create StaffingWidget components
7. Add Staffing tab to HostPage

## Files to Create/Modify

### Backend
- `backend/prisma/schema.prisma` - Add Staff model
- `backend/src/routes/staff.routes.ts` - New API routes
- `backend/src/index.ts` - Register staff routes

### Frontend
- `frontend/src/types.ts` - Add Staff types
- `frontend/src/lib/api.ts` - Add staff API functions
- `frontend/src/components/staffing/StaffingWidget.tsx` - Main component
- `frontend/src/components/staffing/StaffCard.tsx` - Staff card
- `frontend/src/components/staffing/StaffForm.tsx` - Add/edit modal
- `frontend/src/components/staffing/StaffStats.tsx` - Statistics
- `frontend/src/components/staffing/index.ts` - Exports
- `frontend/src/pages/HostPage.tsx` - Add Staffing tab

## Verification Steps

- [ ] Staff model created in database
- [ ] API endpoints return correct data
- [ ] Can add new staff member
- [ ] Can edit staff details and status
- [ ] Can delete staff member
- [ ] Stats display correctly
- [ ] Widget displays in HostPage
- [ ] Mobile responsive
