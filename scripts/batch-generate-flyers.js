/**
 * Batch-generate GPP flyers for events still using the template image.
 *
 * Uses node-canvas to replicate the frontend FlyerGenerator rendering,
 * uploads results to Supabase Storage, and updates each party record.
 *
 * Usage:  node scripts/batch-generate-flyers.js [--dry-run]
 */

const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---- Config ----
const SUPABASE_URL = 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAyMDQ4NCwiZXhwIjoyMDgzNTk2NDg0fQ.KkAjyc8k6FbX4YxWPJEhOsInijffOcPtp6roESj4U9s';
const TEMPLATE_IMG = 'https://www.rsv.pizza/gpp-flyer-2026-og.jpg';
const DRY_RUN = process.argv.includes('--dry-run');
const REGENERATE = process.argv.includes('--regenerate');
const BACKEND_URL = 'https://backend-pizza-dao.vercel.app';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---- Register fonts ----
const FONTS_DIR = path.join(__dirname, '..', 'frontend', 'public', 'fonts');
registerFont(path.join(FONTS_DIR, 'Hub-191-Display.otf'), { family: 'Hub 191 Display' });
registerFont(path.join(FONTS_DIR, 'Hub-191-Regular.otf'), { family: 'Hub 191' });

// ---- Constants from renderFlyer.ts ----
const CITY_COLOR = '#FE332C';
const TIME_COLOR = '#FFFFFF';
const VENUE_COLOR = '#0497C1';

const CITY_BOX = { width: 587, height: 72 };
const VENUE_BOX = { width: 600, height: 110 };
const TIME_BOX = { width: 600, height: 60 };
const DEFAULT_SPONSOR_BOX = { width: 759, height: 171 };

const DEFAULT_POSITIONS = {
  city: { x: 50, y: 582 },
  time: { x: 50, y: 660 },
  venue: { x: 50, y: 720 },
  sponsors: { x: 27, y: 884 },
};

// ---- 12-hour detection (from renderFlyer.ts) ----
function uses12Hour(tz) {
  const TWELVE_HOUR_ZONES = new Set([
    'Asia/Kolkata', 'Asia/Calcutta', 'Asia/Manila',
    'Asia/Riyadh', 'Asia/Jeddah', 'Asia/Dubai',
  ]);
  if (TWELVE_HOUR_ZONES.has(tz)) return true;
  if (tz.startsWith('America/') || tz.startsWith('Australia/')) return true;
  return false;
}

function formatFlyerTime(timeStr, is12h) {
  if (!is12h) return timeStr;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return minutes === 0
    ? `${hours12} ${period}`
    : `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

// ---- Fit text utility (node-canvas version) ----
function fitText(ctx, text, fontFamily, maxFontSize, maxWidth, minFontSize = 14) {
  let size = maxFontSize;
  while (size > minFontSize) {
    ctx.font = `${size}px "${fontFamily}"`;
    const measured = ctx.measureText(text.toUpperCase());
    if (measured.width <= maxWidth) break;
    size -= 1;
  }
  return Math.max(size, minFontSize);
}

// ---- Derive display strings for an event ----
function getEventDisplayInfo(event) {
  // City name: strip "Global Pizza Party" prefix
  let city = event.name.replace(/^Global Pizza Party\s*/i, '').trim();
  // Clean up leading dashes/special chars
  city = city.replace(/^[-–—]\s*/, '');
  // Remove emoji
  city = city.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();

  // Venue
  const venueName = event.venue_name || 'Location TBA';
  const streetAddress = event.venue_name ? (event.address || '') : '';

  // Date
  const dateDisplay = 'MAY 22';

  // Time
  let timeDisplay = '';
  if (event.date) {
    const tz = event.timezone || 'America/New_York';
    const is12h = uses12Hour(tz);
    try {
      const d = new Date(event.date);
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const parts = formatter.format(d);
      const startTime = formatFlyerTime(parts, is12h);

      // End time (3 hours later by default)
      let endTimeStr = '';
      if (event.end_time) {
        const endD = new Date(event.end_time);
        const endParts = formatter.format(endD);
        endTimeStr = formatFlyerTime(endParts, is12h);
      } else {
        const endD = new Date(d.getTime() + 3 * 60 * 60 * 1000);
        const endParts = formatter.format(endD);
        endTimeStr = formatFlyerTime(endParts, is12h);
      }

      // Check if this is the default 6PM time — if venue is TBA, might mean no real time set
      timeDisplay = `${startTime} - ${endTimeStr}`;
    } catch {
      timeDisplay = 'Time TBA';
    }
  } else {
    timeDisplay = 'Time TBA';
  }

  return { city, venueName, streetAddress, dateDisplay, timeDisplay };
}

// ---- Load logo image with timeout ----
async function loadLogoSafe(url, timeoutMs = 10000) {
  return Promise.race([
    loadImage(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Logo load timeout')), timeoutMs)),
  ]);
}

// ---- Render a single flyer ----
async function renderFlyer(templateImage, event, sponsors) {
  const { city, venueName, streetAddress, dateDisplay, timeDisplay } = getEventDisplayInfo(event);
  const positions = DEFAULT_POSITIONS;

  const canvas = createCanvas(1080, 1080);
  const ctx = canvas.getContext('2d');

  // 1) Draw template
  ctx.drawImage(templateImage, 0, 0, 1080, 1080);
  ctx.textBaseline = 'top';

  // 2) City name
  const cityFontSize = fitText(ctx, city, 'Hub 191 Display', 64, CITY_BOX.width);
  ctx.fillStyle = CITY_COLOR;
  ctx.font = `${cityFontSize}px "Hub 191 Display"`;
  ctx.fillText(city.toUpperCase(), positions.city.x, positions.city.y);

  // 3) Venue + street address
  const venueX = positions.city.x;
  const venueNameFontSize = fitText(ctx, venueName, 'Hub 191', 46, VENUE_BOX.width);
  ctx.fillStyle = VENUE_COLOR;
  ctx.font = `${venueNameFontSize}px "Hub 191"`;
  ctx.fillText(venueName.toUpperCase(), venueX, positions.venue.y);
  if (streetAddress) {
    const streetFontSize = fitText(ctx, streetAddress, 'Hub 191', 46, VENUE_BOX.width);
    ctx.font = `${streetFontSize}px "Hub 191"`;
    ctx.fillText(streetAddress.toUpperCase(), venueX, positions.venue.y + venueNameFontSize + 4);
  }

  // 4) Date + Time
  const fullTimeDisplay = `${dateDisplay}  ${timeDisplay}`;
  const timeFontSize = fitText(ctx, fullTimeDisplay, 'Hub 191', 55, TIME_BOX.width);
  ctx.font = `${timeFontSize}px "Hub 191"`;
  ctx.fillStyle = CITY_COLOR;
  const dateStr = dateDisplay.toUpperCase();
  ctx.fillText(dateStr, positions.time.x, positions.time.y);
  const dateWidth = ctx.measureText(dateStr).width;
  const gap = 15;
  if (timeDisplay) {
    ctx.fillStyle = TIME_COLOR;
    ctx.fillText(timeDisplay, positions.time.x + dateWidth + gap, positions.time.y);
  }

  // 5) Sponsor logos
  const validSponsors = sponsors.filter(s => s.logo_url && (s.status === 'yes' || s.status === 'paid'));
  if (validSponsors.length > 0) {
    const logoGap = 16;
    const boxX = positions.sponsors.x;
    const boxW = DEFAULT_SPONSOR_BOX.width;
    const boxH = DEFAULT_SPONSOR_BOX.height;

    const sponsorCount = validSponsors.length;
    const sponsorCols = sponsorCount <= 4 ? sponsorCount : Math.ceil(sponsorCount / 2);
    const sponsorRows = sponsorCount <= 4 ? 1 : 2;
    const maxLogoWidth = sponsorCols > 0 ? (boxW - (sponsorCols - 1) * 16) / sponsorCols : 0;
    const maxLogoHeight = sponsorRows > 0 ? (boxH - (sponsorRows - 1) * 12) / sponsorRows : 0;
    const autoLogoSize = Math.min(maxLogoWidth / 2.5, maxLogoHeight);

    const items = [];
    for (const s of validSponsors) {
      try {
        const logoImg = await loadLogoSafe(s.logo_url);
        const maxW = autoLogoSize * 2.5;
        const maxH = autoLogoSize;
        const fitScale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
        items.push({ img: logoImg, w: logoImg.width * fitScale, h: logoImg.height * fitScale });
      } catch (err) {
        // Skip logos that fail to load
      }
    }

    // Flex layout rows
    const rows = [];
    let currentRow = { items: [], width: 0, height: 0 };
    for (const item of items) {
      const neededW = currentRow.items.length > 0 ? currentRow.width + logoGap + item.w : item.w;
      if (neededW > boxW && currentRow.items.length > 0) {
        rows.push(currentRow);
        currentRow = { items: [item], width: item.w, height: item.h };
      } else {
        currentRow.items.push(item);
        currentRow.width = neededW;
        currentRow.height = Math.max(currentRow.height, item.h);
      }
    }
    if (currentRow.items.length > 0) rows.push(currentRow);

    const totalH = rows.reduce((sum, r) => sum + r.height, 0) + Math.max(0, rows.length - 1) * logoGap;
    let drawY = positions.sponsors.y + (boxH - totalH) / 2;

    for (const row of rows) {
      let drawX = boxX + (boxW - row.width) / 2;
      for (const item of row.items) {
        const itemY = drawY + (row.height - item.h) / 2;
        ctx.drawImage(item.img, drawX, itemY, item.w, item.h);
        drawX += item.w + logoGap;
      }
      drawY += row.height + logoGap;
    }
  }

  return canvas;
}

// ---- Upload to Supabase Storage ----
async function uploadFlyer(canvas, inviteCode) {
  const buffer = canvas.toBuffer('image/png');
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.png`;

  const { error } = await supabase.storage
    .from('event-images')
    .upload(fileName, buffer, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from('event-images')
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}

// ---- Update party via backend API ----
async function updatePartyImage(partyId, imageUrl) {
  // Use the service-role Supabase client directly since we have it
  const { error } = await supabase
    .from('parties')
    .update({
      event_image_url: imageUrl,
      flyer_generated_at: new Date().toISOString(),
    })
    .eq('id', partyId);

  if (error) throw new Error(`Update failed: ${error.message}`);
}

// ---- Main ----
async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== GENERATING FLYERS ===');

  // Load template image once
  const templatePath = path.join(__dirname, '..', 'frontend', 'public', 'gpp-flyer-2026-template.png');
  console.log('Loading template image...');
  const templateImage = await loadImage(templatePath);
  console.log('Template loaded.');

  // Fetch events to process
  let query = supabase
    .from('parties')
    .select('id, name, custom_url, invite_code, venue_name, address, date, end_time, timezone, event_image_url')
    .eq('event_type', 'gpp');

  if (REGENERATE) {
    // Regenerate: target events that already have generated flyers
    query = query.not('flyer_generated_at', 'is', null);
  } else {
    // Default: target events still using the template image
    query = query.eq('event_image_url', TEMPLATE_IMG);
  }

  const { data: events, error: eventsErr } = await query.order('name', { ascending: true });

  if (eventsErr) {
    console.error('Failed to fetch events:', eventsErr);
    process.exit(1);
  }

  console.log(`Found ${events.length} events to ${REGENERATE ? 'regenerate' : 'generate'}.\n`);

  // Fetch all sponsors for these events in one query
  const eventIds = events.map(e => e.id);
  const { data: allSponsors, error: sponsorsErr } = await supabase
    .from('sponsors')
    .select('id, party_id, name, logo_url, status, sort_order')
    .in('party_id', eventIds)
    .order('sort_order', { ascending: true });

  if (sponsorsErr) {
    console.error('Failed to fetch sponsors:', sponsorsErr);
    process.exit(1);
  }

  // Group sponsors by party_id
  const sponsorsByParty = {};
  for (const s of allSponsors) {
    if (!sponsorsByParty[s.party_id]) sponsorsByParty[s.party_id] = [];
    sponsorsByParty[s.party_id].push(s);
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const city = event.name.replace(/^Global Pizza Party\s*/i, '').trim();
    const sponsors = sponsorsByParty[event.id] || [];
    const sponsorLogos = sponsors.filter(s => s.logo_url && (s.status === 'yes' || s.status === 'paid')).length;

    process.stdout.write(`[${i + 1}/${events.length}] ${city} (${sponsorLogos} logos)... `);

    if (DRY_RUN) {
      const info = getEventDisplayInfo(event);
      console.log(`venue="${info.venueName}" time="${info.timeDisplay}"`);
      success++;
      continue;
    }

    try {
      const canvas = await renderFlyer(templateImage, event, sponsors);
      const imageUrl = await uploadFlyer(canvas, event.invite_code);
      await updatePartyImage(event.id, imageUrl);
      console.log('OK');
      success++;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone! ${success} succeeded, ${failed} failed.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
