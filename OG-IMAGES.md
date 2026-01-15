# Open Graph Images System

This project includes a dynamic Open Graph (OG) image system that automatically generates social media preview cards when event links are shared.

## How It Works

### 1. Client-Side Meta Tags (React Helmet)

The `EventPage.tsx` component uses `react-helmet-async` to inject dynamic meta tags based on the event data:

```tsx
<Helmet>
  <title>{party.name} | RSVPizza</title>
  <meta property="og:title" content={party.name} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={eventImageUrl} />
  <meta property="twitter:card" content="summary_large_image" />
  {/* ... more meta tags */}
</Helmet>
```

**Important:** These meta tags work for browser navigation but NOT for social media crawlers (they don't execute JavaScript).

### 2. Static HTML Generation (Build-Time)

To ensure social media crawlers see the proper meta tags, we generate static HTML files during the build process:

**Script:** `scripts/generate-og-meta.js`

This script:
1. Fetches all events with custom URLs from Supabase
2. Generates static HTML files at `dist/{custom_url}/index.html`
3. Each file contains:
   - Full OG meta tags (title, description, image, event details)
   - Meta refresh redirect to the React app
   - JavaScript redirect as backup
   - Loading spinner UI

**Build Process:**
```bash
npm run build
# 1. Builds React app (vite build)
# 2. Generates static OG meta pages (node scripts/generate-og-meta.js)
```

### 3. How It Works for Users

**When someone visits a direct link:**
1. Social media crawler hits `/piola/` → Gets static HTML with full OG tags
2. Normal browser hits `/piola/` → Static HTML redirects to React app
3. React app loads at `/piola` → Displays full event page

**Result:**
- Twitter/Facebook/LinkedIn see the proper preview image and text
- Users get the full React app experience
- No server-side rendering required!

## Testing OG Tags

### Option 1: Social Media Debuggers

**Twitter Card Validator:**
https://cards-dev.twitter.com/validator

**Facebook Sharing Debugger:**
https://developers.facebook.com/tools/debug/

**LinkedIn Post Inspector:**
https://www.linkedin.com/post-inspector/

### Option 2: View Source

Visit the static page and view source:
```
https://pizzadao.github.io/rsv-pizza/piola/
```

Right-click → "View Page Source" to see the meta tags.

### Option 3: curl

```bash
curl https://pizzadao.github.io/rsv-pizza/piola/ | grep "og:image"
```

## Adding New Events

When you create a new event with a custom URL:

1. **Automatically:** The next deployment will include it
   - GitHub Actions runs `npm run build`
   - Build script generates static pages for all events

2. **Manually:** Regenerate OG pages
   ```bash
   npm run generate-og
   ```

## Event Requirements for OG Images

For best social media previews, ensure events have:

✅ **Required:**
- `custom_url` - For the static page (e.g., "piola", "ethtokyo")
- `name` - Event title
- `event_image_url` - Square image (1:1 aspect ratio recommended)

✅ **Recommended:**
- `description` - First 160 chars used for preview
- `date` - Shown in meta tags
- `duration` - Calculated end time
- `address` - Location info
- `host_name` - Attribution

## OG Image Best Practices

**Image Requirements:**
- **Size:** 1200x630px (or square 1:1 ratio)
- **Format:** JPG, PNG, or WebP
- **File size:** Under 5MB
- **Content:** Should be readable at thumbnail size

**URL Structure:**
- Use relative paths: `/rsv-pizza/piola.jpg`
- Or absolute: `https://pizzadao.github.io/rsv-pizza/piola.jpg`

## Architecture Notes

**Why not @vercel/og?**
- This project deploys to GitHub Pages (static hosting)
- @vercel/og requires serverless functions
- Our solution works with any static host (GitHub Pages, Netlify, Cloudflare Pages, etc.)

**Future Enhancements:**
- Generate custom OG images at build time using canvas
- Add event-specific templates (date/time overlay on image)
- A/B test different preview styles

## Files

```
scripts/
  generate-og-meta.js       # Build script that generates static HTML

frontend/
  src/
    App.tsx                 # HelmetProvider wrapper
    pages/
      EventPage.tsx         # Dynamic meta tags with Helmet

package.json                # Build script runs OG generation

dist/
  piola/
    index.html              # Static page with OG tags
  joli/
    index.html
  ethtokyo/
    index.html
```

## Debugging

**Issue:** Social media not showing preview
- Check: Did you deploy the latest build?
- Check: Does `/piola/index.html` exist in dist?
- Check: Run the link through Facebook/Twitter debugger
- Check: Clear social media cache (may take 24-48hrs)

**Issue:** Wrong image showing
- Social media platforms cache OG images aggressively
- Use their debugger tools to force a refresh
- Facebook: Click "Scrape Again"
- Twitter: Just paste the URL (auto-refreshes)

**Issue:** Meta tags not updating
- Verify `generate-og-meta.js` fetches latest data from Supabase
- Check the static HTML file has updated tags
- Redeploy if needed

## Contributing

When adding new meta tags:
1. Update `EventPage.tsx` (for client-side)
2. Update `scripts/generate-og-meta.js` (for static pages)
3. Test with social media debuggers
4. Commit both files together
