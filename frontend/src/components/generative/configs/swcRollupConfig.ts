import type { FormatConfig } from '../types';
import { ROLLUP_CONFIG } from './rollupConfig';

// Stand With Crypto roll-up banner. See swcPosterConfig.ts.
export const SWC_ROLLUP_CONFIG: FormatConfig = {
  ...ROLLUP_CONFIG,
  id: 'rollup-swc',
  templatePath: '/brands/swc/flyer/rollup-template.png',
  fullResUrl: '/brands/swc/flyer/rollup-template.png',
  handleColor: 'rgba(2,8,23,0.85)',
  // Empty band between the pizza art and the city line (y 2200).
  qr: { x: 410, y: 1880, size: 260, tileColor: '#F1EAFF', dark: '#020817', caption: 'SCAN TO RSVP', radius: 18 },
  textFields: ROLLUP_CONFIG.textFields.map((f) => ({
    ...f,
    color: f.key === 'venue' ? '#52607A' : '#020817',
    ...(f.key === 'time' ? { dateColor: '#6C11FF' } : {}),
  })),
};
