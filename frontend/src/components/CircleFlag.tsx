import { countryNameToAlpha2 } from '../utils/countryFlag';

export const FLAG_BASE = 'https://cdn.jsdelivr.net/npm/circle-flags@2.8.3/flags';

export function CircleFlag({ country, code, size = 14 }: { country?: string | null; code?: string | null; size?: number }) {
  const c = code ?? countryNameToAlpha2(country ?? null);
  if (!c) return null;
  return (
    <img
      src={`${FLAG_BASE}/${c}.svg`}
      alt={country || c}
      width={size}
      height={size}
      loading="lazy"
      className="rounded-full inline-block shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
