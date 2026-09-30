import { useEffect, useState } from 'react';
import { fetchPublicSeriesList } from '../../lib/api';
import { resolveFlyerTemplate, type FlyerTemplate } from './configs/flyerTemplates';

/**
 * Resolve a party's series flyer template (Phase 2c). Given the party's
 * eventSeriesId, look up the series (public /api/series, cached module-wide) and
 * map its flyerTemplateKey to a registered template. Returns null when the party
 * has no series, the series has no template key, or the key isn't registered —
 * callers then fall back to their existing default behavior.
 */
let cache: Promise<Record<string, string | null>> | null = null;

async function loadKeyById(): Promise<Record<string, string | null>> {
  if (!cache) {
    cache = fetchPublicSeriesList()
      .then((r) => {
        const map: Record<string, string | null> = {};
        for (const s of r.series) map[s.id] = s.flyerTemplateKey ?? null;
        return map;
      })
      .catch(() => ({}));
  }
  return cache;
}

export function useSeriesFlyerTemplate(eventSeriesId: string | null | undefined): FlyerTemplate | null {
  const [tpl, setTpl] = useState<FlyerTemplate | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!eventSeriesId) { setTpl(null); return; }
    loadKeyById().then((map) => {
      if (cancelled) return;
      setTpl(resolveFlyerTemplate(map[eventSeriesId]));
    });
    return () => { cancelled = true; };
  }, [eventSeriesId]);
  return tpl;
}
