import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, MapPin, CalendarDays } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { useTheme } from '../contexts/ThemeContext';
import { brandUrl } from '../config/brand';
import { fetchPublicSeries, fetchPublicSeriesEvents, type PublicSeries, type PublicSeriesEvent } from '../lib/api';

/**
 * Public landing page for a white-label event series: /series/:slug.
 * Renders the series' own branding (name, description, OG image, theme class)
 * and its public events. Config comes from GET /api/series/:slug (+ /events).
 */
export function SeriesLandingPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { themeClass, backgroundStyle } = useTheme();
  const [series, setSeries] = useState<PublicSeries | null>(null);
  const [events, setEvents] = useState<PublicSeriesEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const { series: s } = await fetchPublicSeries(slug);
        if (cancelled) return;
        setSeries(s);
        try {
          const { events: ev } = await fetchPublicSeriesEvents(slug);
          if (!cancelled) setEvents(ev);
        } catch {
          if (!cancelled) setEvents([]);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Apply the series' own theme class to this page's subtree.
  const pageThemeClass = series?.themeClass || themeClass;

  if (loading) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted" />
        </div>
        <Footer />
      </div>
    );
  }

  if (notFound || !series) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <h1 className="text-2xl font-bold mb-2 text-theme-text">Series not found</h1>
          <p className="text-theme-text-muted">No event series exists at this address.</p>
        </div>
        <Footer />
      </div>
    );
  }

  const title = series.displayName || series.name;
  const ogImage = series.ogImageUrl || undefined;

  return (
    <div className={`min-h-screen ${pageThemeClass}`} style={backgroundStyle}>
      <Helmet>
        <title>{`${title} | ${series.name}`}</title>
        {series.description && <meta name="description" content={series.description.slice(0, 200)} />}
        <meta property="og:title" content={title} />
        {series.description && <meta property="og:description" content={series.description.slice(0, 200)} />}
        {ogImage && <meta property="og:image" content={ogImage} />}
        <meta property="og:url" content={brandUrl(`series/${series.slug}`)} />
        <meta property="og:type" content="website" />
      </Helmet>
      <Header />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <header className="text-center mb-10">
          {series.logoUrl && (
            <img src={series.logoUrl} alt={title} className="h-20 mx-auto mb-4 object-contain" />
          )}
          <h1 className="text-4xl font-bold text-theme-text mb-3">{title}</h1>
          {series.description && (
            <p className="text-theme-text-secondary whitespace-pre-line max-w-2xl mx-auto">{series.description}</p>
          )}
        </header>

        <section>
          <h2 className="text-lg font-semibold text-theme-text mb-4">
            {events.length > 0 ? `${events.length} event${events.length === 1 ? '' : 's'}` : 'Events'}
          </h2>

          {events.length === 0 ? (
            <p className="text-theme-text-muted">No public events yet — check back soon.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {events.map((e) => (
                <a
                  key={e.id}
                  href={brandUrl(e.slug)}
                  className="block rounded-xl border border-theme-stroke hover:bg-theme-surface-hover p-4 transition-colors"
                >
                  <div className="font-medium text-theme-text">{e.city || e.name}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-theme-text-muted">
                    {e.country && (
                      <span className="inline-flex items-center gap-1"><MapPin size={12} />{e.country}</span>
                    )}
                    {e.date && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays size={12} />
                        {new Date(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                    {e.community && <span className="text-theme-text-faint">community</span>}
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>

        <div className="mt-10 text-center">
          <Link to="/map" className="text-sm text-theme-accent underline underline-offset-2">
            View all events on the map →
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default SeriesLandingPage;
