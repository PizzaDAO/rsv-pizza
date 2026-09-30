import { usePizza } from '../../contexts/PizzaContext';
import { GenerativeCanvas } from './GenerativeCanvas';
import { ROLLUP_CONFIG } from './configs/rollupConfig';
import { AVAX_ROLLUP_CONFIG } from './configs/avaxRollupConfig';
import { useSeriesFlyerTemplate } from './useSeriesFlyerTemplate';

export function RollupGenerator() {
  const { party } = usePizza();
  // Prefer the party's series flyer template (Phase 2c); fall back to the
  // avax-tag check, then the default GPP roll-up.
  const seriesTpl = useSeriesFlyerTemplate(party?.eventSeriesId);
  const isAvax = party?.eventTags?.includes('avax');
  const config = seriesTpl?.rollup ?? (isAvax ? AVAX_ROLLUP_CONFIG : ROLLUP_CONFIG);
  return <GenerativeCanvas config={config} />;
}
