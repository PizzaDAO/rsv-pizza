import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { EventForm } from '../components/EventForm';
import { SeriesCreateFlow } from '../components/series-create/SeriesCreateFlow';
import { BRAND } from '../config/brand';
import { IS_SERIES_SCOPED } from '../config/brandScope';
import { resolvePreset } from '../config/createPresets';
import { fetchPublicSeries } from '../lib/api';

function GenericCreate() {
  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="card p-8">
          <EventForm />
        </div>
      </div>
    </Layout>
  );
}

// Series-scoped (white-label) builds: use the preset-driven create flow when the series has a
// `createFlow`; otherwise (flag absent, unknown, load error, ?full=1) the existing form.
function SeriesScopedNewEventPage() {
  const [params] = useSearchParams();
  const full = params.get('full') === '1';
  const { data, isLoading } = useQuery({
    queryKey: ['public-series', BRAND.seriesSlug],
    queryFn: () => fetchPublicSeries(BRAND.seriesSlug),
    retry: false,
    staleTime: 60_000,
    enabled: !full,
  });

  if (full) return <GenericCreate />;

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-theme-text-muted" size={28} />
        </div>
      </Layout>
    );
  }

  const series = data?.series;
  const preset = resolvePreset(series?.createFlow);
  if (!series || !preset) return <GenericCreate />;

  return (
    <Layout>
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="card p-6 sm:p-8">
          <SeriesCreateFlow series={series} preset={preset} />
        </div>
      </div>
    </Layout>
  );
}

export function NewEventPage() {
  // Default build (rsv.pizza): exactly the existing markup, no series fetch.
  if (!IS_SERIES_SCOPED) return <GenericCreate />;
  return <SeriesScopedNewEventPage />;
}
