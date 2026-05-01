import { DEFAULT_POSITIONS } from './useFlyerDrag';

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

// ---- Standalone render function ----

export interface RenderFlyerOptions {
  city: string;
  venueName: string;
  streetAddress: string;
  dateDisplay: string;
  timeDisplay: string;
  is12h: boolean;
  sponsors: { logoUrl: string }[];
}

/**
 * Render a GPP flyer to a canvas using default positions and no custom overrides.
 * This is the standalone version of FlyerGenerator's renderFlyerToCanvas,
 * suitable for batch/mass generation.
 */
export async function renderFlyer(opts: RenderFlyerOptions): Promise<HTMLCanvasElement> {
  const { city, venueName, streetAddress, dateDisplay, timeDisplay, sponsors } = opts;

  const positions = DEFAULT_POSITIONS;

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;

  // 1) Draw template image
  const templateImg = await loadImg('/gpp-flyer-2026-template.png');
  ctx.drawImage(templateImg, 0, 0, 1080, 1080);

  ctx.textBaseline = 'top';

  // 2) City name
  const cityFontSize = fitText(city, 'Hub 191 Display', 64, CITY_BOX.width);
  ctx.fillStyle = CITY_COLOR;
  ctx.font = `${cityFontSize}px "Hub 191 Display"`;
  ctx.fillText(city.toUpperCase(), positions.city.x, positions.city.y);

  // 3) Venue name + street address
  const venueX = positions.city.x;
  const venueNameFontSize = fitText(venueName, 'Hub 191', 46, VENUE_BOX.width);
  ctx.fillStyle = VENUE_COLOR;
  ctx.font = `${venueNameFontSize}px "Hub 191"`;
  ctx.fillText(venueName.toUpperCase(), venueX, positions.venue.y);
  if (streetAddress) {
    const streetFontSize = fitText(streetAddress, 'Hub 191', 46, VENUE_BOX.width);
    ctx.font = `${streetFontSize}px "Hub 191"`;
    ctx.fillText(streetAddress.toUpperCase(), venueX, positions.venue.y + venueNameFontSize + 4);
  }

  // 4) Date + Time
  const fullTimeDisplay = `${dateDisplay}  ${timeDisplay || '6PM - 9PM'}`;
  const timeFontSize = fitText(fullTimeDisplay, 'Hub 191', 55, TIME_BOX.width);
  {
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
  }

  // 5) Sponsor logos (flex layout, no popped logos for mass gen)
  if (sponsors.length > 0) {
    const gap = 16;
    const boxX = positions.sponsors.x;
    const boxW = DEFAULT_SPONSOR_BOX.width;
    const boxH = DEFAULT_SPONSOR_BOX.height;

    // Compute auto logo size
    const sponsorCount = Math.min(sponsors.length, 8);
    const sponsorCols = sponsorCount <= 4 ? sponsorCount : Math.ceil(sponsorCount / 2);
    const sponsorRows = sponsorCount <= 4 ? 1 : 2;
    const maxLogoWidth = sponsorCols > 0 ? (boxW - (sponsorCols - 1) * 16) / sponsorCols : 0;
    const maxLogoHeight = sponsorRows > 0 ? (boxH - (sponsorRows - 1) * 12) / sponsorRows : 0;
    const autoLogoSize = Math.min(maxLogoWidth / 2.5, maxLogoHeight);

    type LogoItem = { img: HTMLImageElement; w: number; h: number };
    const items: LogoItem[] = [];
    for (const s of sponsors.slice(0, 8)) {
      try {
        const logoImg = await loadImg(s.logoUrl);
        const maxW = autoLogoSize * 2.5;
        const maxH = autoLogoSize;
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
