import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Search } from 'lucide-react';
import { Layout } from './Layout';
import { IconInput } from './IconInput';
import { loadPublicSeries } from '../lib/seriesSites';
import { IS_SERIES_SCOPED } from '../config/brandScope';
import type { PublicSeriesWithId } from '../lib/seriesApi';

interface NotFoundViewProps {
  /** page: unknown URL; event: unknown event slug; series: unknown series slug. */
  kind?: 'page' | 'event' | 'series';
}

/**
 * Shared "not found" state, rendered inside Layout (header, footer) with a way out:
 * search, browse events, create your own, and (for series) the list of active series.
 * Always `noindex`. Note: this is a client-rendered SPA, so the HTTP status is still 200.
 */
export function NotFoundView({ kind = 'page' }: NotFoundViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [series, setSeries] = useState<PublicSeriesWithId[]>([]);

  useEffect(() => {
    if (kind !== 'series' || IS_SERIES_SCOPED) return;
    let cancelled = false;
    loadPublicSeries().then((all) => {
      if (!cancelled) setSeries(all.filter((s) => s.isActive !== false));
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const title = kind === 'event' ? t('notFound.eventTitle') : kind === 'series' ? t('notFound.seriesTitle') : t('notFound.title');
  const description =
    kind === 'event' ? t('notFound.eventDescription') : kind === 'series' ? t('notFound.seriesDescription') : t('notFound.description');

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/events?q=${encodeURIComponent(term)}` : '/events');
  };

  return (
    <Layout>
      <Helmet>
        <title>{title}</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="flex items-center justify-center p-4 py-16">
        <div className="card p-8 max-w-md w-full text-center" data-testid="not-found">
          <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">{title}</h1>
          <p className="text-theme-text-secondary mb-6">{description}</p>

          <form onSubmit={onSearch} role="search" className="mb-4 text-left">
            <IconInput
              icon={Search}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('notFound.searchPlaceholder')}
              aria-label={t('notFound.search')}
            />
          </form>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/events" className="btn-primary inline-block">
              {t('notFound.browseEvents')}
            </Link>
            <Link to="/new" className="btn-secondary inline-block">
              {t('notFound.createYourOwn')}
            </Link>
          </div>
          <Link to="/" className="inline-block mt-4 text-sm text-theme-text-muted hover:text-theme-text">
            {t('notFound.goHome')}
          </Link>

          {kind === 'series' && series.length > 0 && (
            <div className="mt-6 pt-6 border-t border-theme-stroke text-left">
              <h2 className="text-sm font-semibold text-theme-text-secondary mb-2">{t('notFound.activeSeries')}</h2>
              <ul className="space-y-1">
                {series.map((s) => (
                  <li key={s.slug}>
                    <Link to={`/series/${s.slug}`} className="text-theme-text hover:underline">
                      {s.displayName || s.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
