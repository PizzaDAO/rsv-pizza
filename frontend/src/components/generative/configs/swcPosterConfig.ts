import type { FormatConfig } from '../types';
import { POSTER_CONFIG } from './posterConfig';

// Stand With Crypto poster. Art is baked into the template (public/brands/swc/flyer); city/date/venue/
// sponsors/QR are drawn by the generator below the pizza. Text colours are >= 4.5:1 on the
// template background. The same file serves preview and full-res (no Supabase upload).
const FONT = '"Hub 191", "Comic Sans MS", "Comic Sans", cursive';

export const SWC_POSTER_CONFIG: FormatConfig = {
  ...POSTER_CONFIG,
  id: 'poster-swc',
  templatePath: '/brands/swc/flyer/poster-template.png',
  fullResUrl: '/brands/swc/flyer/poster-template.png',
  handleColor: 'rgba(2,8,23,0.85)',
  // Right-hand tile below the art; text boxes are narrowed to leave room for it.
  qr: { x: 790, y: 985, size: 230, tileColor: '#F1EAFF', dark: '#020817', caption: 'SCAN TO RSVP', radius: 18 },
  textFields: [
    { key: 'city', label: 'City', defaultX: 60, defaultY: 990, boxWidth: 700, boxHeight: 72, color: '#020817', fontFamily: `"Hub 191 Display", ${FONT}`, maxFontSize: 64 },
    { key: 'time', label: 'Time', defaultX: 60, defaultY: 1072, boxWidth: 700, boxHeight: 60, color: '#020817', dateColor: '#6C11FF', fontFamily: FONT, maxFontSize: 50 },
    { key: 'venue', label: 'Venue', defaultX: 60, defaultY: 1140, boxWidth: 700, boxHeight: 100, color: '#52607A', fontFamily: FONT, maxFontSize: 40 },
  ],
  sponsorBox: { defaultX: 60, defaultY: 1265, width: 960, height: 150, defaultRows: 2 },
};
