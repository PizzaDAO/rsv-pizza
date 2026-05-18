import { usePizza } from '../../contexts/PizzaContext';
import { GenerativeCanvas } from './GenerativeCanvas';
import { POSTER_CONFIG } from './configs/posterConfig';
import { AVAX_POSTER_CONFIG } from './configs/avaxPosterConfig';

export function PosterGenerator() {
  const { party } = usePizza();
  const isAvax = party?.eventTags?.includes('avax');
  return <GenerativeCanvas config={isAvax ? AVAX_POSTER_CONFIG : POSTER_CONFIG} />;
}
