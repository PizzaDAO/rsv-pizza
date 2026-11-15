import type { FormatConfig } from '../types';
import { ROLLUP_CONFIG } from './rollupConfig';

// Team1 roll-up banner. See team1PosterConfig.ts.
export const TEAM1_ROLLUP_CONFIG: FormatConfig = {
  ...ROLLUP_CONFIG,
  id: 'rollup-team1',
  templatePath: '/brands/team1/flyer/rollup-template.png',
  fullResUrl: '/brands/team1/flyer/rollup-template.png',
  handleColor: 'rgba(255,255,255,0.85)',
  // Band between the pizza art (ends y~1760) and the city line (y 2380).
  qr: { x: 410, y: 1960, size: 260, tileColor: '#FFFFFF', dark: '#000000', caption: 'SCAN TO RSVP', radius: 18 },
  // Content shifted down vs the GPP roll-up so the sponsor row sits near the bottom of the banner.
  sponsorBox: { ...ROLLUP_CONFIG.sponsorBox, defaultY: 2600, height: 290 },
  textFields: ROLLUP_CONFIG.textFields.map((f) => ({
    ...f,
    defaultY: f.key === 'city' ? 2380 : f.key === 'time' ? 2490 : 2590,
    color: f.key === 'venue' ? '#D1D5DB' : '#FFFFFF',
    ...(f.key === 'time' ? { dateColor: '#FF4D5A' } : {}),
  })),
};
