import { GenerativeCanvas } from './GenerativeCanvas';
import { POSTER_CONFIG } from './configs/posterConfig';

export function PosterGenerator() {
  return <GenerativeCanvas config={POSTER_CONFIG} />;
}
