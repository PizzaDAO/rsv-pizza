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
  textFields: ROLLUP_CONFIG.textFields.map((f) => ({
    ...f,
    color: INK,
    ...(f.key === 'time' ? { dateColor: '#7A2E9E' } : {}),
  })),
};
