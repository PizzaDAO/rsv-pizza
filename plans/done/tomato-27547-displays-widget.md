# tomato-27547: Displays Widget

## Overview

A widget for hosts to manage digital displays at their events. Displays can show various content types like photo slideshows, QR codes for RSVP, event info, sponsor logos, and more. Each display has a unique URL that can be opened on any screen (TV, tablet, projector).

## Data Model

### Display Table
```sql
CREATE TABLE displays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,

  -- Basic Info
  name TEXT NOT NULL,                    -- "Main Screen", "Photo Wall", etc.
  slug TEXT NOT NULL,                    -- URL-safe identifier

  -- Content Configuration
  content_type TEXT NOT NULL DEFAULT 'slideshow',  -- slideshow, qr_code, event_info, photos, custom
  content_config JSONB DEFAULT '{}',     -- Type-specific settings

  -- Display Settings
  rotation_interval INTEGER DEFAULT 10,  -- Seconds between slides (for slideshow)
  background_color TEXT DEFAULT '#000000',
  show_clock BOOLEAN DEFAULT FALSE,
  show_event_name BOOLEAN DEFAULT TRUE,

  -- Access Control
  is_active BOOLEAN DEFAULT TRUE,
  password TEXT,                         -- Optional password protection

  -- Metadata
  last_viewed_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(party_id, slug)
);

CREATE INDEX idx_displays_party ON displays(party_id);
```

### Content Types

| Type | Description | Config Options |
|------|-------------|----------------|
| slideshow | Rotating images/content | slides[], transition, shuffle |
| qr_code | RSVP QR code | size, message, showEventInfo |
| event_info | Event details display | showCountdown, showGuestCount, showLocation |
| photos | Live photo wall from gallery | filter, layout, autoRefresh |
| custom | Custom HTML/embed | html, refreshInterval |

### Example content_config

```json
// slideshow
{
  "slides": [
    { "type": "image", "url": "...", "caption": "Welcome!" },
    { "type": "text", "content": "Pizza arriving at 7PM" },
    { "type": "qr", "url": "https://rsv.pizza/abc123" }
  ],
  "transition": "fade",
  "shuffle": false
}

// qr_code
{
  "size": "large",
  "message": "Scan to RSVP!",
  "showEventInfo": true,
  "showGuestCount": true
}

// photos
{
  "filter": "starred",
  "layout": "grid",
  "autoRefresh": 30,
  "columns": 3
}
```

## API Endpoints

```
GET    /api/parties/:partyId/displays         - List displays
POST   /api/parties/:partyId/displays         - Create display
GET    /api/parties/:partyId/displays/:id     - Get display details
PATCH  /api/parties/:partyId/displays/:id     - Update display
DELETE /api/parties/:partyId/displays/:id     - Delete display

# Public endpoint for display viewer
GET    /api/display/:slug                     - Get display for viewer (no auth)
POST   /api/display/:slug/view                - Record view (no auth)
```

## UI Components

### 1. DisplaysWidget (Main Container)
Location: Host Page -> new "Displays" tab

Features:
- List of configured displays
- Add new display button
- Quick preview links
- Active/inactive toggle

### 2. DisplayCard
Shows:
```
+-------------------------------------------------+
| Main Screen                        [Active]     |
| Type: Slideshow (5 slides)                       |
| URL: rsv.pizza/d/abc123-main                    |
| Views: 42  |  Last viewed: 2 hours ago          |
|                         [Preview] [Edit] [Copy] |
+-------------------------------------------------+
```

### 3. DisplayForm (Add/Edit Modal)
Fields:

**Basic Info**
- Name (required)
- Content Type (dropdown)

**Content Settings** (varies by type)
- Slideshow: Add/reorder slides, transitions
- QR Code: Size, message
- Photos: Filter, layout
- Event Info: What to show

**Display Settings**
- Rotation interval
- Background color
- Show clock
- Show event name

**Access**
- Active toggle
- Password (optional)

### 4. DisplayViewer (Public Page)
Full-screen display viewer at `/display/:slug`

Features:
- Full-screen mode
- Auto-rotation for slideshows
- Real-time photo updates
- Clock overlay
- Mobile-friendly touch controls

## Files to Create/Modify

### Backend
- `backend/prisma/schema.prisma` - Add Display model
- `backend/src/routes/display.routes.ts` - CRUD API
- `backend/src/index.ts` - Register routes

### Frontend
- `frontend/src/components/displays/DisplaysWidget.tsx` - Main container
- `frontend/src/components/displays/DisplayCard.tsx` - Individual display
- `frontend/src/components/displays/DisplayForm.tsx` - Add/edit modal
- `frontend/src/components/displays/index.ts` - Exports
- `frontend/src/pages/DisplayViewer.tsx` - Public viewer page
- `frontend/src/pages/HostPage.tsx` - Add Displays tab
- `frontend/src/types.ts` - Display types
- `frontend/src/lib/api.ts` - Display API functions
- `frontend/src/App.tsx` - Add display viewer route

## Implementation Steps

1. Update Prisma schema with Display model
2. Create display routes (CRUD)
3. Create DisplayForm component
4. Create DisplayCard component
5. Create DisplaysWidget container
6. Create DisplayViewer page
7. Add to HostPage as new tab
8. Add route for public display viewer
9. Test full workflow

## Verification

- [ ] Display model created in database
- [ ] CRUD endpoints working
- [ ] Displays tab shows in HostPage
- [ ] Can create/edit/delete displays
- [ ] Public display viewer works
- [ ] QR code generates correctly
- [ ] Slideshow rotates content
- [ ] Photo wall shows live photos
