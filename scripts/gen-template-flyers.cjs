/**
 * Generate flyers for GPP events still using the template image.
 * Uses node-canvas to render server-side, uploads to Supabase storage,
 * and updates each party record via Prisma.
 *
 * Usage: cd backend && node ../scripts/gen-template-flyers.cjs [--dry-run]
 */

const { createCanvas, loadImage, registerFont } = require('canvas');
const { createClient } = require('@supabase/supabase-js');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const crypto = require('crypto');

const DRY_RUN = process.argv.includes('--dry-run');
const TEMPLATE_URL = 'https://www.rsv.pizza/gpp-flyer-2026-og.jpg';

// Paths
const FONT_DIR = path.join(__dirname, '..', 'frontend', 'public', 'fonts');
const TEMPLATE_PATH = path.join(__dirname, '..', 'frontend', 'public', 'gpp-flyer-2026-template.png');
const AVAX_TEMPLATE_PATH = path.join(__dirname, '..', 'frontend', 'public', 'gpp-flyer-avax-template.png');

// Register fonts
registerFont(path.join(FONT_DIR, 'Hub-191-Display.otf'), { family: 'Hub 191 Display' });
registerFont(path.join(FONT_DIR, 'Hub-191-Regular.otf'), { family: 'Hub 191' });

// Flyer constants (mirrored from renderFlyer.ts)
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

// Supabase client (for storage uploads)
const supabase = createClient(
  'https://znpiwdvvsqaxuskpfleo.supabase.co',
  // anon key - storage upload needs to be allowed for anon or use service role
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMjA0ODQsImV4cCI6MjA4MzU5NjQ4NH0.yAb2_JOtyYD0uqvqoPufzc5kG2pNjyqd1pC97UViXuw'
);

const prisma = new PrismaClient();

// ---- Helpers (ported from renderFlyer.ts) ----

const TWELVE_HOUR_ZONES = new Set([
  'Asia/Kolkata', 'Asia/Calcutta',
  'Asia/Manila',
  'Asia/Riyadh', 'Asia/Jeddah',
  'Asia/Dubai',
]);

function uses12Hour(tz) {
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

function getDateTimeInTimezone(date, timezone) {
  const d = date instanceof Date ? date : new Date(date);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const getPart = (type) => parts.find(p => p.type === type)?.value || '';
  return {
    dateStr: `${getPart('year')}-${getPart('month')}-${getPart('day')}`,
    timeStr: `${getPart('hour')}:${getPart('minute')}`,
  };
}

function parseCityFromName(name) {
  return name.replace(/^Global Pizza Party\s*/i, '').trim() || name;
}

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

// ---- Main rendering ----

async function renderFlyer(templateImg, opts) {
  const { city, venueName, streetAddress, dateDisplay, timeDisplay, sponsors, config } = opts;

  // Use config positions/sponsorBoxSize when provided, otherwise defaults
  const positions = config?.positions || DEFAULT_POSITIONS;
  const sponsorBox = config?.sponsorBoxSize || DEFAULT_SPONSOR_BOX;

  // Always use fresh event data for text — text overrides are only for the
  // interactive editor, not for batch/mass generation scripts.
  const displayCity = city;
  const displayVenueName = venueName;
  const displayStreetAddress = streetAddress;
  const displayTime = timeDisplay;

  const canvas = createCanvas(1080, 1080);
  const ctx = canvas.getContext('2d');

  // 1) Template
  ctx.drawImage(templateImg, 0, 0, 1080, 1080);
  ctx.textBaseline = 'top';

  // 2) City name
  const cityFontSize = fitText(ctx, displayCity, 'Hub 191 Display', 64, CITY_BOX.width);
  ctx.fillStyle = CITY_COLOR;
  ctx.font = `${cityFontSize}px "Hub 191 Display"`;
  ctx.fillText(displayCity.toUpperCase(), positions.city.x, positions.city.y);

  // 3) Venue name + street
  const venueX = positions.city.x;
  const venueNameFontSize = fitText(ctx, displayVenueName, 'Hub 191', 46, VENUE_BOX.width);
  ctx.fillStyle = VENUE_COLOR;
  ctx.font = `${venueNameFontSize}px "Hub 191"`;
  ctx.fillText(displayVenueName.toUpperCase(), venueX, positions.venue.y);
  if (displayStreetAddress) {
    const streetFontSize = fitText(ctx, displayStreetAddress, 'Hub 191', 46, VENUE_BOX.width);
    ctx.font = `${streetFontSize}px "Hub 191"`;
    ctx.fillText(displayStreetAddress.toUpperCase(), venueX, positions.venue.y + venueNameFontSize + 4);
  }

  // 4) Date + Time
  const fullTimeDisplay = `${dateDisplay}  ${displayTime || '6PM - 9PM'}`;
  const timeFontSize = fitText(ctx, fullTimeDisplay, 'Hub 191', 55, TIME_BOX.width);
  ctx.font = `${timeFontSize}px "Hub 191"`;
  ctx.fillStyle = CITY_COLOR;
  const dateStr = dateDisplay.toUpperCase();
  ctx.fillText(dateStr, positions.time.x, positions.time.y);
  const dateWidth = ctx.measureText(dateStr).width;
  const gap = 15;
  if (displayTime) {
    ctx.fillStyle = TIME_COLOR;
    ctx.fillText(displayTime, positions.time.x + dateWidth + gap, positions.time.y);
  }

  // 5a) Render popped logos at their absolute positions
  const poppedLogos = config?.poppedLogos || {};
  const configLogoSizes = config?.logoSizes || {};
  const poppedSponsors = sponsors.filter(s => s.id && poppedLogos[s.id]);
  const groupSponsors = sponsors.filter(s => !s.id || !poppedLogos[s.id]);

  for (const s of poppedSponsors) {
    try {
      const logoImg = await loadImage(s.logoUrl);
      const pos = poppedLogos[s.id];
      const customSize = configLogoSizes[s.id] || 80;
      const maxW = customSize * 2.5;
      const maxH = customSize;
      const fitScale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
      const w = logoImg.width * fitScale;
      const h = logoImg.height * fitScale;
      ctx.drawImage(logoImg, pos.x - w / 2, pos.y - h / 2, w, h);
    } catch (err) {
      console.warn(`    [warn] Failed to load popped logo: ${s.logoUrl}`);
    }
  }

  // 5b) Sponsor logos (group layout)
  if (groupSponsors.length > 0) {
    const logoGap = 16;
    const boxX = positions.sponsors.x;
    const boxW = sponsorBox.width;
    const boxH = sponsorBox.height;

    const sponsorCount = groupSponsors.length;
    const sponsorCols = sponsorCount <= 4 ? sponsorCount : Math.ceil(sponsorCount / 2);
    const sponsorRows = sponsorCount <= 4 ? 1 : 2;
    const maxLogoWidth = sponsorCols > 0 ? (boxW - (sponsorCols - 1) * 16) / sponsorCols : 0;
    const maxLogoHeight = sponsorRows > 0 ? (boxH - (sponsorRows - 1) * 12) / sponsorRows : 0;
    const autoLogoSize = Math.min(maxLogoWidth / 2.5, maxLogoHeight);

    const items = [];
    for (const s of groupSponsors) {
      try {
        const logoImg = await loadImage(s.logoUrl);
        // Use per-sponsor size if available, else auto
        const customSize = s.id && configLogoSizes[s.id] ? configLogoSizes[s.id] : autoLogoSize;
        const maxW = customSize * 2.5;
        const maxH = customSize;
        const fitScale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
        items.push({ img: logoImg, w: logoImg.width * fitScale, h: logoImg.height * fitScale });
      } catch (err) {
        console.warn(`    [warn] Failed to load logo: ${s.logoUrl}`);
      }
    }

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

async function uploadFlyer(canvas, filename) {
  const buffer = canvas.toBuffer('image/png');
  const filePath = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;

  const { error } = await supabase.storage
    .from('event-images')
    .upload(filePath, buffer, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    console.error(`    [error] Upload failed: ${error.message}`);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from('event-images')
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (no uploads/updates) ===' : '=== GENERATING FLYERS ===');

  // 1) Load template image once
  console.log('Loading template image...');
  const templateImg = await loadImage(TEMPLATE_PATH);
  console.log('Template loaded (1080x1080)');

  const avaxTemplateImg = await loadImage(AVAX_TEMPLATE_PATH);
  console.log('Avax template loaded');

  // 2) Fetch events with template image
  const events = await prisma.party.findMany({
    where: { eventType: 'gpp', eventImageUrl: TEMPLATE_URL },
    select: {
      id: true,
      name: true,
      venueName: true,
      address: true,
      date: true,
      timezone: true,
      duration: true,
      customUrl: true,
      inviteCode: true,
      flyerConfig: true,
      eventTags: true,
      sponsors: {
        where: {
          logoUrl: { not: null },
          status: { in: ['yes', 'paid'] },
        },
        select: { id: true, logoUrl: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  console.log(`Found ${events.length} events with template image\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const city = parseCityFromName(event.name);
    const venueName = event.venueName || 'LOCATION TBA';
    const streetAddress = event.address ? event.address.split(',')[0].trim() : '';

    let dateDisplay = '';
    let timeDisplay = '';
    const is12h = event.timezone ? uses12Hour(event.timezone) : false;

    if (event.date) {
      const tz = event.timezone || 'UTC';
      const start = getDateTimeInTimezone(event.date, tz);
      const startFormatted = formatFlyerTime(start.timeStr, is12h);
      timeDisplay = startFormatted;

      if (event.duration) {
        const endDate = new Date(new Date(event.date).getTime() + event.duration * 3600000);
        const end = getDateTimeInTimezone(endDate, tz);
        const endFormatted = formatFlyerTime(end.timeStr, is12h);
        timeDisplay = `${startFormatted} - ${endFormatted}`;
      }

      const eventDate = new Date(event.date);
      const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' });
      const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' });
      dateDisplay = `${monthFormatter.format(eventDate).toUpperCase()} ${dayFormatter.format(eventDate)}`;
    }

    const sponsorLogos = event.sponsors.map(s => ({ id: s.id, logoUrl: s.logoUrl }));
    const flyerCfg = event.flyerConfig || null;

    console.log(`[${i + 1}/${events.length}] ${city}${(event.eventTags || []).includes('avax') ? ' [avax]' : ''} — venue: ${venueName}, date: ${dateDisplay || 'TBA'}, sponsors: ${sponsorLogos.length}${flyerCfg ? ' (has config)' : ''}`);

    try {
      const tpl = (event.eventTags || []).includes('avax') ? avaxTemplateImg : templateImg;
      const canvas = await renderFlyer(tpl, {
        city,
        venueName,
        streetAddress,
        dateDisplay,
        timeDisplay,
        is12h,
        sponsors: sponsorLogos,
        config: flyerCfg,
      });

      if (DRY_RUN) {
        console.log('    [dry-run] Would upload and update');
        success++;
        continue;
      }

      const filename = `gpp-flyer-${event.customUrl || event.inviteCode || event.id}.png`;
      const uploadedUrl = await uploadFlyer(canvas, filename);
      if (!uploadedUrl) {
        failed++;
        continue;
      }

      await prisma.party.update({
        where: { id: event.id },
        data: {
          eventImageUrl: uploadedUrl,
          flyerGeneratedAt: new Date(),
        },
      });

      console.log(`    ✓ uploaded → ${uploadedUrl.split('/').pop()}`);
      success++;
    } catch (err) {
      console.error(`    [error] ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== DONE: ${success} success, ${failed} failed ===`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
