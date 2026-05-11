import { DEFAULT_POSITIONS, type FlyerPositions } from './useFlyerDrag';

// ---- Shared constants ----
export const CITY_FONT = '"Hub 191 Display", "Hub 191", "Comic Sans MS", cursive';
export const TEXT_FONT = '"Hub 191", "Comic Sans MS", "Comic Sans", cursive';
export const CITY_COLOR = '#FE332C';
export const TIME_COLOR = '#FFFFFF';
export const VENUE_COLOR = '#0497C1';

export const CITY_BOX = { width: 587, height: 72 };
export const VENUE_BOX = { width: 600, height: 110 };
export const TIME_BOX = { width: 600, height: 60 };
export const DEFAULT_SPONSOR_BOX = { width: 759, height: 171 };

// ---- Shared utility functions ----

/**
 * Measure text with an offscreen canvas and return the optimal font size
 * that fits within maxWidth, starting from maxFontSize down to minFontSize.
 */
export function fitText(
  text: string,
  fontFamily: string,
  maxFontSize: number,
  maxWidth: number,
  minFontSize: number = 14,
): number {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return maxFontSize;

  let size = maxFontSize;
  const quotedFont = fontFamily.includes(' ') ? `"${fontFamily}"` : fontFamily;
  while (size > minFontSize) {
    ctx.font = `${size}px ${quotedFont}`;
    const measured = ctx.measureText(text.toUpperCase());
    if (measured.width <= maxWidth) break;
    size -= 1;
  }
  return Math.max(size, minFontSize);
}

/** Load an image as a promise for canvas drawing */
export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Determine whether the given IANA timezone's country conventionally uses
 * 12-hour time (e.g. "6:00 PM") or 24-hour time (e.g. "18:00").
 */
export function uses12Hour(tz: string): boolean {
  const TWELVE_HOUR_ZONES = new Set([
    'Asia/Kolkata', 'Asia/Calcutta',
    'Asia/Manila',
    'Asia/Riyadh', 'Asia/Jeddah',
    'Asia/Dubai',
  ]);
  if (TWELVE_HOUR_ZONES.has(tz)) return true;
  if (tz.startsWith('America/') || tz.startsWith('Australia/')) return true;
  return false;
}

/**
 * Format a 24-hour "HH:MM" time string to the appropriate display format.
 * - 12-hour mode: "6 PM" (or "6:30 PM" when minutes are non-zero)
 * - 24-hour mode: "18:00"
 */
export function formatFlyerTime(timeStr: string, is12h: boolean): string {
  if (!is12h) return timeStr;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return minutes === 0
    ? `${hours12} ${period}`
    : `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

// ---- FlyerConfig type (persisted to DB) ----

export interface FlyerConfig {
  positions?: FlyerPositions;
  poppedLogos?: Record<string, { x: number; y: number }>;
  logoSizes?: Record<string, number>;
  sponsorBoxSize?: { width: number; height: number };
  editVenueName?: string | null;
  editStreetAddress?: string | null;
  editCity?: string | null;
  editTime?: string | null;
}

// ---- Standalone render function ----

export interface RenderFlyerOptions {
  city: string;
  venueName: string;
  streetAddress: string;
  dateDisplay: string;
  timeDisplay: string;
  is12h: boolean;
  sponsors: { id?: string; logoUrl: string }[];
  config?: FlyerConfig;
}

/**
 * Render a GPP flyer to a canvas using default positions and no custom overrides.
 * This is the standalone version of FlyerGenerator's renderFlyerToCanvas,
 * suitable for batch/mass generation.
 */
export async function renderFlyer(opts: RenderFlyerOptions): Promise<HTMLCanvasElement> {
  const { city, venueName, streetAddress, dateDisplay, timeDisplay, sponsors, config } = opts;

  // Use config positions/sponsorBoxSize when provided, otherwise defaults
  const positions = config?.positions || DEFAULT_POSITIONS;
  const sponsorBox = config?.sponsorBoxSize || DEFAULT_SPONSOR_BOX;

  // Apply text overrides from config
  const displayCity = config?.editCity ?? city;
  const displayVenueName = config?.editVenueName ?? venueName;
  const displayStreetAddress = config?.editStreetAddress ?? streetAddress;
  const displayTime = config?.editTime ?? timeDisplay;

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;

  // 1) Draw template image
  const templateImg = await loadImg('/gpp-flyer-2026-template.png');
  ctx.drawImage(templateImg, 0, 0, 1080, 1080);

  ctx.textBaseline = 'top';

  // 2) City name
  const cityFontSize = fitText(displayCity, 'Hub 191 Display', 64, CITY_BOX.width);
  ctx.fillStyle = CITY_COLOR;
  ctx.font = `${cityFontSize}px "Hub 191 Display"`;
  ctx.fillText(displayCity.toUpperCase(), positions.city.x, positions.city.y);

  // 3) Venue name + street address
  const venueX = positions.city.x;
  const venueNameFontSize = fitText(displayVenueName, 'Hub 191', 46, VENUE_BOX.width);
  ctx.fillStyle = VENUE_COLOR;
  ctx.font = `${venueNameFontSize}px "Hub 191"`;
  ctx.fillText(displayVenueName.toUpperCase(), venueX, positions.venue.y);
  if (displayStreetAddress) {
    const streetFontSize = fitText(displayStreetAddress, 'Hub 191', 46, VENUE_BOX.width);
    ctx.font = `${streetFontSize}px "Hub 191"`;
    ctx.fillText(displayStreetAddress.toUpperCase(), venueX, positions.venue.y + venueNameFontSize + 4);
  }

  // 4) Date + Time
  const fullTimeDisplay = `${dateDisplay}  ${displayTime || '6PM - 9PM'}`;
  const timeFontSize = fitText(fullTimeDisplay, 'Hub 191', 55, TIME_BOX.width);
  {
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
  }

  // 5) Separate sponsors into group (flex layout) vs popped (absolute positioned)
  const poppedLogos = config?.poppedLogos || {};
  const configLogoSizes = config?.logoSizes || {};
  const groupSponsors = sponsors.filter(s => !s.id || !poppedLogos[s.id]);
  const poppedSponsors = sponsors.filter(s => s.id && poppedLogos[s.id]);

  // 5a) Render popped logos at their absolute positions
  for (const s of poppedSponsors) {
    try {
      const logoImg = await loadImg(s.logoUrl);
      const pos = poppedLogos[s.id!];
      const customSize = configLogoSizes[s.id!] || 80;
      const maxW = customSize * 2.5;
      const maxH = customSize;
      const fitScale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
      const w = logoImg.width * fitScale;
      const h = logoImg.height * fitScale;
      ctx.drawImage(logoImg, pos.x - w / 2, pos.y - h / 2, w, h);
    } catch {
      // Skip logos that fail to load
    }
  }

  // 5b) Render group sponsors in flex layout
  if (groupSponsors.length > 0) {
    const gap = 16;
    const boxX = positions.sponsors.x;
    const boxW = sponsorBox.width;
    const boxH = sponsorBox.height;

    // Compute auto logo size
    const sponsorCount = groupSponsors.length;
    const sponsorCols = sponsorCount <= 4 ? sponsorCount : Math.ceil(sponsorCount / 2);
    const sponsorRows = sponsorCount <= 4 ? 1 : 2;
    const maxLogoWidth = sponsorCols > 0 ? (boxW - (sponsorCols - 1) * 16) / sponsorCols : 0;
    const maxLogoHeight = sponsorRows > 0 ? (boxH - (sponsorRows - 1) * 12) / sponsorRows : 0;
    const autoLogoSize = Math.min(maxLogoWidth / 2.5, maxLogoHeight);

    type LogoItem = { img: HTMLImageElement; w: number; h: number };
    const items: LogoItem[] = [];
    for (const s of groupSponsors) {
      try {
        const logoImg = await loadImg(s.logoUrl);
        // Use per-sponsor size if available, else auto
        const customSize = s.id && configLogoSizes[s.id] ? configLogoSizes[s.id] : autoLogoSize;
        const maxW = customSize * 2.5;
        const maxH = customSize;
        const fitScale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
        items.push({ img: logoImg, w: logoImg.width * fitScale, h: logoImg.height * fitScale });
      } catch {
        // Skip logos that fail to load
      }
    }

    type Row = { items: LogoItem[]; width: number; height: number };
    const rows: Row[] = [];
    let currentRow: Row = { items: [], width: 0, height: 0 };
    for (const item of items) {
      const neededW = currentRow.items.length > 0 ? currentRow.width + gap + item.w : item.w;
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

    const totalH = rows.reduce((sum, r) => sum + r.height, 0) + Math.max(0, rows.length - 1) * gap;
    let drawY = positions.sponsors.y + (boxH - totalH) / 2;

    for (const row of rows) {
      let drawX = boxX + (boxW - row.width) / 2;
      for (const item of row.items) {
        const itemY = drawY + (row.height - item.h) / 2;
        ctx.drawImage(item.img, drawX, itemY, item.w, item.h);
        drawX += item.w + gap;
      }
      drawY += row.height + gap;
    }
  }

  return canvas;
}

/**
 * Render a partner-specific GPP flyer with the template background,
 * city name, and one partner logo displayed large.
 */
export async function renderPartnerFlyer(city: string, logoUrl: string): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;

  // Draw template
  const templateImg = await loadImg('/gpp-flyer-2026-template.png');
  ctx.drawImage(templateImg, 0, 0, 1080, 1080);

  // Draw city name
  ctx.textBaseline = 'top';
  const cityFontSize = fitText(city, 'Hub 191 Display', 64, CITY_BOX.width);
  ctx.fillStyle = CITY_COLOR;
  ctx.font = `${cityFontSize}px "Hub 191 Display"`;
  ctx.fillText(city.toUpperCase(), DEFAULT_POSITIONS.city.x, DEFAULT_POSITIONS.city.y);

  // Draw partner logo large, centered in box
  const logoImg = await loadImg(logoUrl);
  const boxX = 50, boxY = 660, boxW = 980, boxH = 380;
  const scale = Math.min(boxW / logoImg.width, boxH / logoImg.height);
  const w = logoImg.width * scale;
  const h = logoImg.height * scale;
  const x = boxX + (boxW - w) / 2;
  const y = boxY + (boxH - h) / 2;
  ctx.drawImage(logoImg, x, y, w, h);

  return canvas;
}
