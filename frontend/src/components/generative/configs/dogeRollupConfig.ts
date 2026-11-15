import type { FormatConfig } from '../types';
import { ROLLUP_CONFIG } from './rollupConfig';

// Doge Day (Own The Doge) roll-up banner. See dogePosterConfig.ts.
const INK = '#302D25';

export const DOGE_ROLLUP_CONFIG: FormatConfig = {
  ...ROLLUP_CONFIG,
  id: 'rollup-doge',
  templatePath: '/brands/doge/flyer/rollup-template.png',
  fullResUrl: '/brands/doge/flyer/rollup-template.png',
  handleColor: 'rgba(48,45,37,0.85)',
  // Slots clear of the Doge's face (~x445-634, y1027-1222), badge (y1581-1667), headline (ends y~742)
  // and "powered by" (y~1804).
  dogeSpeak: {
    slots: [
      { x: 670, y: 1010, fontSize: 54, maxWidth: 200 },
      { x: 225, y: 1040, fontSize: 38, maxWidth: 210 },
      { x: 660, y: 1150, fontSize: 36, maxWidth: 220 },
      { x: 230, y: 1290, fontSize: 34, maxWidth: 230 },
      { x: 100, y: 1700, fontSize: 40, maxWidth: 440 },
    ],
  },
  textFields: ROLLUP_CONFIG.textFields.map((f) => ({
    ...f,
    color: INK,
    ...(f.key === 'time' ? { dateColor: '#7A2E9E' } : {}),
  })),
};
