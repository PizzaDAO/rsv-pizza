import type { FormatConfig, CanvasPositions } from './types';
import {
  fitText, loadImg,
  CITY_COLOR, TIME_COLOR, VENUE_COLOR,
} from '../flyer/renderFlyer';

export interface RenderCanvasOptions {
  config: FormatConfig;
  positions: CanvasPositions;
  textValues: {
    city: string;
    dateDisplay: string;
    timeDisplay: string;
    venueName: string;
    streetAddress: string;
  };
  sponsors: { id?: string; logoUrl: string }[];
  sponsorBoxSize: { width: number; height: number };
  logoSizes: Record<string, number>;
  poppedLogos: Record<string, { x: number; y: number }>;
  scaleFactor?: number;
}

/**
 * Render the generative canvas (poster or rollup) to an offscreen canvas.
 * When scaleFactor is provided, all coordinates and sizes are multiplied by it
 * for full-resolution output.
 */
export async function renderCanvas(opts: RenderCanvasOptions): Promise<HTMLCanvasElement> {
  const { config, positions, textValues, sponsors, sponsorBoxSize, logoSizes, poppedLogos, scaleFactor = 1 } = opts;
  const { city, dateDisplay, timeDisplay, venueName, streetAddress } = textValues;

  const w = Math.round(config.canvasWidth * scaleFactor);
  const h = Math.round(config.canvasHeight * scaleFactor);
  const s = scaleFactor;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // 1) Draw template
  const templateSrc = scaleFactor > 1 ? config.fullResUrl : config.templatePath;
  const templateImg = await loadImg(templateSrc);
  ctx.drawImage(templateImg, 0, 0, w, h);

  ctx.textBaseline = 'top';

  // Get text field configs
  const cityField = config.textFields.find(f => f.key === 'city')!;
  const timeField = config.textFields.find(f => f.key === 'time')!;
  const venueField = config.textFields.find(f => f.key === 'venue')!;

  // 2) City name
  const cityFontSize = fitText(city, 'Hub 191 Display', cityField.maxFontSize * s, cityField.boxWidth * s, (cityField.minFontSize || 14) * s);
  ctx.fillStyle = cityField.color;
  ctx.font = `${cityFontSize}px "Hub 191 Display"`;
  ctx.fillText(city.toUpperCase(), positions.city.x * s, positions.city.y * s);

  // 3) Date + Time
  if (!timeField.hidden) {
    const fullTimeDisplay = timeDisplay ? `${dateDisplay}  ${timeDisplay}` : dateDisplay;
    const timeFontSize = fitText(fullTimeDisplay, 'Hub 191', timeField.maxFontSize * s, timeField.boxWidth * s, (timeField.minFontSize || 14) * s);
    ctx.font = `${timeFontSize}px "Hub 191"`;
    ctx.fillStyle = CITY_COLOR;
    const dateStr = dateDisplay.toUpperCase();
    ctx.fillText(dateStr, positions.time.x * s, positions.time.y * s);
    const dateWidth = ctx.measureText(dateStr).width;
    const gap = 15 * s;
    if (timeDisplay) {
      ctx.fillStyle = TIME_COLOR;
      ctx.fillText(timeDisplay, positions.time.x * s + dateWidth + gap, positions.time.y * s);
    }
  }

  // 4) Venue name + street address
  if (!venueField.hidden) {
    const venueX = positions.city.x * s;
    const venueNameFontSize = fitText(venueName, 'Hub 191', venueField.maxFontSize * s, venueField.boxWidth * s, (venueField.minFontSize || 14) * s);
    ctx.fillStyle = venueField.color;
    ctx.font = `${venueNameFontSize}px "Hub 191"`;
    ctx.fillText(venueName.toUpperCase(), venueX, positions.venue.y * s);
    if (streetAddress) {
      const streetFontSize = fitText(streetAddress, 'Hub 191', venueField.maxFontSize * s, venueField.boxWidth * s, (venueField.minFontSize || 14) * s);
      ctx.font = `${streetFontSize}px "Hub 191"`;
      ctx.fillText(streetAddress.toUpperCase(), venueX, positions.venue.y * s + venueNameFontSize + 4 * s);
    }
  }

  // 5) Sponsor logos
  if (sponsors.length > 0) {
    const gap = 16 * s;
    const boxX = positions.sponsors.x * s;
    const boxW = sponsorBoxSize.width * s;
    const boxH = sponsorBoxSize.height * s;

    const groupSponsors = sponsors.filter(sp => !sp.id || !poppedLogos[sp.id]);
    const poppedSponsors = sponsors.filter(sp => sp.id && poppedLogos[sp.id]);

    // Popped logos
    for (const sp of poppedSponsors) {
      try {
        const logoImg = await loadImg(sp.logoUrl);
        const pos = poppedLogos[sp.id!];
        const customSize = (logoSizes[sp.id!] || 80) * s;
        const maxW = customSize * 2.5;
        const maxH = customSize;
        const fitScale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
        const lw = logoImg.width * fitScale;
        const lh = logoImg.height * fitScale;
        ctx.drawImage(logoImg, pos.x * s - lw / 2, pos.y * s - lh / 2, lw, lh);
      } catch {
        // Skip logos that fail to load
      }
    }

    // Group logos in flex layout
    if (groupSponsors.length > 0) {
      const sponsorCount = groupSponsors.length;
      const sponsorCols = sponsorCount <= 4 ? sponsorCount : Math.ceil(sponsorCount / 2);
      const sponsorRows = sponsorCount <= 4 ? 1 : 2;
      const maxLogoWidth = sponsorCols > 0 ? (boxW - (sponsorCols - 1) * gap) / sponsorCols : 0;
      const maxLogoHeight = sponsorRows > 0 ? (boxH - (sponsorRows - 1) * 12 * s) / sponsorRows : 0;
      const autoLogoSize = Math.min(maxLogoWidth / 2.5, maxLogoHeight);

      type LogoItem = { img: HTMLImageElement; w: number; h: number };
      const items: LogoItem[] = [];
      for (const sp of groupSponsors) {
        try {
          const logoImg = await loadImg(sp.logoUrl);
          const customSize = sp.id && logoSizes[sp.id] ? logoSizes[sp.id] * s : autoLogoSize;
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
      let drawY = positions.sponsors.y * s + (boxH - totalH) / 2;

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
  }

  return canvas;
}
