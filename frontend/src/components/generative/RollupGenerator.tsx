import { GenerativeCanvas } from './GenerativeCanvas';
import { ROLLUP_CONFIG } from './configs/rollupConfig';

export function RollupGenerator() {
  return <GenerativeCanvas config={ROLLUP_CONFIG} />;
}
