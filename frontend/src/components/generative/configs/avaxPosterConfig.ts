import type { FormatConfig } from '../types';
import { POSTER_CONFIG } from './posterConfig';

export const AVAX_POSTER_CONFIG: FormatConfig = {
  ...POSTER_CONFIG,
  id: 'poster-avax',
  templatePath: '/gpp-poster-avax-template.png',
  fullResUrl: 'https://znpiwdvvsqaxuskpfleo.supabase.co/storage/v1/object/public/templates/gpp-poster-avax-fullres.png',
};
