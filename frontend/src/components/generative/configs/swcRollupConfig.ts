import type { FormatConfig } from '../types';
import { ROLLUP_CONFIG } from './rollupConfig';

// Stand With Crypto roll-up banner. See swcPosterConfig.ts.
export const SWC_ROLLUP_CONFIG: FormatConfig = {
  ...ROLLUP_CONFIG,
  id: 'rollup-swc',
  templatePath: '/brands/swc/flyer/rollup-template.png',
  fullResUrl: '/brands/swc/flyer/rollup-template.png',
  handleColor: 'rgba(2,8,23,0.85)',
  // Band between the pizza art (ends y~1760) and the city line (y 2380).
  qr: { x: 410, y: 1960, size: 260, tileColor: '#F1EAFF', dark: '#020817', caption: 'SCAN TO RSVP', radius: 18 },
  // Content shifted down vs the GPP roll-up so the sponsor row sits near the bottom of the banner.
  sponsorBox: { ...ROLLUP_CONFIG.sponsorBox, defaultY: 2600, height: 290 },
  textFields: ROLLUP_CONFIG.textFields.map((f) => ({
    ...f,
    defaultY: f.key === 'city' ? 2380 : f.key === 'time' ? 2490 : 2590,
    color: f.key === 'venue' ? '#52607A' : '#020817',
    ...(f.key === 'time' ? { dateColor: '#6C11FF' } : {}),
  })),
};
