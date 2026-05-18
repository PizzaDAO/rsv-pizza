import type { FormatConfig } from '../types';
import { ROLLUP_CONFIG } from './rollupConfig';

export const AVAX_ROLLUP_CONFIG: FormatConfig = {
  ...ROLLUP_CONFIG,
  id: 'rollup-avax',
  templatePath: '/gpp-rollup-avax-template.png',
  fullResUrl: 'https://znpiwdvvsqaxuskpfleo.supabase.co/storage/v1/object/public/templates/gpp-rollup-avax-fullres.png',
};
