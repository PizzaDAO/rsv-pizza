import type { FormatConfig } from '../types';
import { ROLLUP_CONFIG } from './rollupConfig';

// Team1 roll-up banner. See team1PosterConfig.ts.
export const TEAM1_ROLLUP_CONFIG: FormatConfig = {
  ...ROLLUP_CONFIG,
  id: 'rollup-team1',
  templatePath: '/brands/team1/flyer/rollup-template.png',
  fullResUrl: '/brands/team1/flyer/rollup-template.png',
  handleColor: 'rgba(255,255,255,0.85)',
  // Empty band between the pizza art and the city line (y 2200).
  qr: { x: 410, y: 1880, size: 260, tileColor: '#FFFFFF', dark: '#000000', caption: 'SCAN TO RSVP', radius: 18 },
  textFields: ROLLUP_CONFIG.textFields.map((f) => ({
    ...f,
    color: f.key === 'venue' ? '#D1D5DB' : '#FFFFFF',
    ...(f.key === 'time' ? { dateColor: '#FF4D5A' } : {}),
  })),
};
