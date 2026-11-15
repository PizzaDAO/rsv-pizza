import type { FormatConfig } from '../types';
import { POSTER_CONFIG } from './posterConfig';

// Doge Day (Own The Doge) poster. Cream art with the framed Doge is baked into the template;
// city/date/venue/sponsors are drawn by the generator below it. All text is dark ink or deep
// purple on cream (>= 4.5:1). The same file serves preview and full-res (no Supabase upload).
const INK = '#302D25';
const DATE_PURPLE = '#7A2E9E';
const FONT = '"Hub 191", "Comic Sans MS", "Comic Sans", cursive';

export const DOGE_POSTER_CONFIG: FormatConfig = {
  ...POSTER_CONFIG,
  id: 'poster-doge',
  templatePath: '/brands/doge/flyer/poster-template.png',
  fullResUrl: '/brands/doge/flyer/poster-template.png',
  handleColor: 'rgba(48,45,37,0.85)',
  textFields: [
    { key: 'city', label: 'City', defaultX: 60, defaultY: 990, boxWidth: 960, boxHeight: 72, color: INK, fontFamily: `"Hub 191 Display", ${FONT}`, maxFontSize: 64 },
    { key: 'time', label: 'Time', defaultX: 60, defaultY: 1072, boxWidth: 960, boxHeight: 60, color: INK, dateColor: DATE_PURPLE, fontFamily: FONT, maxFontSize: 50 },
    { key: 'venue', label: 'Venue', defaultX: 60, defaultY: 1140, boxWidth: 960, boxHeight: 100, color: INK, fontFamily: FONT, maxFontSize: 40 },
  ],
  // Slots clear of the Doge's face (~x455-625, y450-612), the badge/mini-doge (right, y~820-900),
  // the headline (ends y~280) and the city/date/venue fields (start y 990).
  dogeSpeak: {
    slots: [
      { x: 665, y: 465, fontSize: 54, maxWidth: 200 },
      { x: 270, y: 480, fontSize: 40, maxWidth: 175 },
      { x: 655, y: 650, fontSize: 36, maxWidth: 235 },
      { x: 275, y: 765, fontSize: 36, maxWidth: 200 },
      { x: 600, y: 292, fontSize: 34, maxWidth: 330 },
    ],
  },
  sponsorBox: { defaultX: 60, defaultY: 1265, width: 960, height: 150, defaultRows: 2 },
};
