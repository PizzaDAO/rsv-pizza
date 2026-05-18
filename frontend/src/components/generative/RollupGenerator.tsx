import { usePizza } from '../../contexts/PizzaContext';
import { GenerativeCanvas } from './GenerativeCanvas';
import { ROLLUP_CONFIG } from './configs/rollupConfig';
import { AVAX_ROLLUP_CONFIG } from './configs/avaxRollupConfig';

export function RollupGenerator() {
  const { party } = usePizza();
  const isAvax = party?.eventTags?.includes('avax');
  return <GenerativeCanvas config={isAvax ? AVAX_ROLLUP_CONFIG : ROLLUP_CONFIG} />;
}
