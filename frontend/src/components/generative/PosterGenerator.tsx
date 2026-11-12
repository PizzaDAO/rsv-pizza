import { usePizza } from '../../contexts/PizzaContext';
import { GenerativeCanvas } from './GenerativeCanvas';
import { POSTER_CONFIG } from './configs/posterConfig';
import { AVAX_POSTER_CONFIG } from './configs/avaxPosterConfig';
import { useSeriesFlyerTemplate } from './useSeriesFlyerTemplate';
import { BrandFlyerNotice } from './BrandFlyerNotice';
import { IS_SERIES_SCOPED } from '../../config/brandScope';

export function PosterGenerator() {
  const { party } = usePizza();
  // Prefer the party's series flyer template (Phase 2c); fall back to the
  // avax-tag check, then the default GPP poster.
  const seriesTpl = useSeriesFlyerTemplate(party?.eventSeriesId);
  // White-label builds never fall back to GPP art: no series template means no GPP flyer.
  if (IS_SERIES_SCOPED && !seriesTpl) return <BrandFlyerNotice />;
  const isAvax = party?.eventTags?.includes('avax');
  const config = seriesTpl?.poster ?? (isAvax ? AVAX_POSTER_CONFIG : POSTER_CONFIG);
  return <GenerativeCanvas config={config} />;
}
