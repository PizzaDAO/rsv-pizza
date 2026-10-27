import { useMemo } from 'react';
import MapLibreMap, { type MapLibreMarker } from '../lib/maps/MapLibreMap';
import { countryCentroid } from '../lib/countryCentroids';
import { flagEmoji } from '../lib/iso4217';
import { fmtPerCm2, fmtUsd } from '../lib/pizzaIndexUtils';
import type { PublicCountryEntry } from '../lib/api';

/**
 * sfincione-40417: country markers for the public Pizza Price Index.
 * Colour = USD/cm^2 (green cheap -> red pricey, relative to the published set),
 * size = number of events. Countries without a known centroid are skipped.
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colorFor(t: number): string {
  // hue 140 (green) -> 0 (red)
  return `hsl(${Math.round(140 * (1 - t))}, 75%, 48%)`;
}

export function PizzaIndexMap({ countries }: { countries: PublicCountryEntry[] }) {
  const markers = useMemo<MapLibreMarker[]>(() => {
    const prices = countries.map((c) => c.usdPerCm2).filter((v) => Number.isFinite(v));
    if (prices.length === 0) return [];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const maxN = Math.max(...countries.map((c) => c.nParties), 1);
    const out: MapLibreMarker[] = [];
    for (const c of countries) {
      const pos = countryCentroid(c.countryCode);
      if (!pos) continue;
      const t = max > min ? (c.usdPerCm2 - min) / (max - min) : 0.5;
      const size = Math.round(16 + 22 * Math.sqrt(c.nParties / maxN));
      const el = document.createElement('div');
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${colorFor(t)};border:2px solid rgba(255,255,255,0.9);box-shadow:0 1px 4px rgba(0,0,0,0.5);opacity:0.92;cursor:pointer;`;
      el.title = `${c.country}: ${fmtPerCm2(c.usdPerCm2)}/cm²`;
      el.setAttribute('aria-label', el.title);
      const flag = c.countryCode ? `${flagEmoji(c.countryCode)} ` : '';
      out.push({
        lat: pos.lat,
        lng: pos.lng,
        element: el,
        anchor: 'center',
        title: c.country,
        popupHTML: `<div style="color:#111;font-size:13px;line-height:1.4"><div style="font-weight:600">${flag}${escapeHtml(c.country)}</div><div>${escapeHtml(fmtPerCm2(c.usdPerCm2))} per cm²</div><div>30 cm pizza: ${escapeHtml(fmtUsd(c.ladderUsd['30']))}</div><div>${c.nParties} events</div></div>`,
      });
    }
    return out;
  }, [countries]);

  if (markers.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="relative rounded-2xl overflow-hidden border border-theme-stroke">
        <MapLibreMap
          markers={markers}
          fitToMarkers
          fitMaxZoom={4}
          center={{ lat: 20, lng: 10 }}
          zoom={1.5}
          minZoom={1}
          className="w-full"
          style={{ height: 'min(60vh, 440px)' }}
          dataTestId="pizza-index-map"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-text-muted">
        <span className="flex items-center gap-2">
          cheaper
          <span className="inline-block h-2 w-24 rounded-full" style={{ background: `linear-gradient(to right, ${colorFor(0)}, ${colorFor(0.5)}, ${colorFor(1)})` }} />
          pricier
        </span>
        <span>Bigger dot = more events. Tap a dot for details.</span>
      </div>
    </section>
  );
}
