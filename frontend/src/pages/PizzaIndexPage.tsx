import { Fragment, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ChevronDown, ChevronRight, Loader2, Pizza } from 'lucide-react';
import { Layout } from '../components/Layout';
import { BRAND } from '../config/brand';
import {
  fetchPublicPizzaCountryPhotos,
  fetchPublicPizzaIndex,
  type PublicPizzaCountryPhoto,
  type PublicPizzaIndex,
} from '../lib/api';
import { LADDER_SIZES, fmtLocalPerCm2, fmtPerCm2, fmtUsd } from '../lib/pizzaIndexUtils';
import { flagEmoji } from '../lib/iso4217';
import { PizzaIndexMap } from '../components/PizzaIndexMap';

/** Countries with fewer events than this are flagged as early estimates. */
const EARLY_BELOW = 3;

/**
 * sfincione-40417 Phase 3: public Pizza Price Index. Aggregates only
 * (GPP 2026 receipts, verified or high-confidence
 * sizes, bundles excluded). Handles an empty dataset gracefully.
 * Map: PizzaIndexMap puts a sized/coloured marker on each published country's centroid.
 */

const LADDER_LABEL: Record<(typeof LADDER_SIZES)[number], string> = {
  '25': '25 cm (≈10″)',
  '30': '30 cm (≈12″)',
  '35': '35 cm (≈14″)',
  '40': '40 cm (≈16″)',
};

/** Photo strip for one country, shown when its table row is opened. */
function CountryPhotos({ country }: { country: string }) {
  const [photos, setPhotos] = useState<PublicPizzaCountryPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPublicPizzaCountryPhotos(country)
      .then((r) => { if (!cancelled) setPhotos(r.photos); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [country]);

  if (failed) return <div className="text-xs text-theme-text-muted">Couldn't load photos.</div>;
  if (!photos) return <div className="py-4 flex justify-center"><Loader2 size={18} className="animate-spin text-theme-text-muted" /></div>;
  if (photos.length === 0) return <div className="text-xs text-theme-text-muted">No photos from these events yet.</div>;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
      {photos.map((p) => (
        <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="block">
          <img
            src={p.thumbnailUrl || p.url}
            alt={`Pizza from a Global Pizza Party event${p.city ? ` in ${p.city}` : ''}, ${country}`}
            loading="lazy"
            className="aspect-square w-full object-cover rounded-lg border border-theme-stroke hover:opacity-90"
          />
        </a>
      ))}
    </div>
  );
}

export function PizzaIndexPage() {
  const [data, setData] = useState<PublicPizzaIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCountry, setOpenCountry] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPublicPizzaIndex()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Could not load the index'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const countries = data?.countries ?? [];
  const hasData = countries.length > 0 && data?.global.usdPerCm2 != null;
  const th = 'px-3 py-2 text-left text-xs font-medium text-theme-text-muted whitespace-nowrap';
  const td = 'px-3 py-2 text-sm whitespace-nowrap';

  return (
    <Layout>
      <Helmet>
        <title>{`Pizza Price Index | ${BRAND.name}`}</title>
        <meta name="description" content="What does a pizza really cost around the world? Price per cm² and standard-size prices by country, from Global Pizza Party receipts." />
      </Helmet>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-red-500"><Pizza size={22} /><span className="text-sm font-semibold uppercase tracking-wide">Pizza Price Index</span></div>
          <h1 className="text-3xl sm:text-4xl font-bold text-theme-text">What does a pizza cost around the world?</h1>
          <p className="text-theme-text-muted max-w-2xl">
            Real menu prices from pizzerias that fed Global Pizza Party {data?.year ?? 2026} events, normalised by size so a 25 cm pie in Lagos can be compared with a 16-inch pie in Brooklyn.
          </p>
        </header>

        {loading && <div className="py-16 flex justify-center"><Loader2 className="animate-spin" /></div>}
        {error && <div className="text-sm text-red-400">{error}</div>}

        {!loading && !error && !hasData && (
          <div className="rounded-2xl border border-theme-stroke bg-white/5 p-8 text-center space-y-2">
            <div className="text-lg font-semibold text-theme-text">The index is still being cooked.</div>
            <p className="text-sm text-theme-text-muted">
              We publish a country once one of its events has a verified pizza size. Check back soon.
            </p>
          </div>
        )}

        {hasData && data && (
          <>
            {/* Global headline */}
            <section className="rounded-2xl border border-theme-stroke bg-white/5 p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <div className="text-4xl font-bold text-theme-text">{fmtPerCm2(data.global.usdPerCm2)}</div>
                <div className="text-theme-text-muted">per cm² · global median</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {LADDER_SIZES.map((s) => (
                  <div key={s} className="rounded-xl bg-black/20 p-3 text-center">
                    <div className="text-xs text-theme-text-muted">{LADDER_LABEL[s]}</div>
                    <div className="text-xl font-semibold text-theme-text">{fmtUsd(data.global.ladderUsd[s])}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-theme-text-faint">
                Median across {data.global.nCountries} countries and {data.global.nParties} events. Prices in USD at each event's exchange rate.
              </p>
            </section>

            <PizzaIndexMap countries={countries} />

            {/* Leaderboard */}
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-theme-text">Cheapest to priciest</h2>
              <p className="text-xs text-theme-text-faint">Tap a country to see pizzas from its events.</p>
              <div className="overflow-x-auto rounded-xl border border-theme-stroke">
                <table className="w-full">
                  <thead className="bg-white/5">
                    <tr>
                      <th className={th}>#</th>
                      <th className={th}>Country</th>
                      <th className={th}>USD / cm²</th>
                      <th className={th}>Local / cm²</th>
                      {LADDER_SIZES.map((s) => <th key={s} className={th}>{s} cm</th>)}
                      <th className={th}>Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countries.map((c, i) => (
                      <Fragment key={c.country}>
                      <tr
                        className="border-t border-theme-stroke hover:bg-white/5 cursor-pointer"
                        onClick={() => setOpenCountry(openCountry === c.country ? null : c.country)}
                        aria-expanded={openCountry === c.country}
                      >
                        <td className={`${td} text-theme-text-muted`}>{i + 1}</td>
                        <td className={`${td} font-medium text-theme-text`}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            aria-label={`${openCountry === c.country ? 'Hide' : 'Show'} pizza photos from ${c.country}`}
                          >
                            {openCountry === c.country ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {c.countryCode ? `${flagEmoji(c.countryCode)} ` : ''}{c.country}
                          </button>
                        </td>
                        <td className={td}>{fmtPerCm2(c.usdPerCm2)}</td>
                        <td className={td}>{fmtLocalPerCm2(c.localPerCm2, c.localCurrency)}</td>
                        {LADDER_SIZES.map((s) => <td key={s} className={td}>{fmtUsd(c.ladderUsd[s])}</td>)}
                        <td className={`${td} text-theme-text-muted`}>
                          {c.nParties}
                          {c.nParties < EARLY_BELOW && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-theme-text-faint">early</span>}
                        </td>
                      </tr>
                      {openCountry === c.country && (
                        <tr className="bg-black/10">
                          <td colSpan={5 + LADDER_SIZES.length} className="px-3 py-3">
                            <CountryPhotos country={c.country} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* Methodology */}
        <section className="space-y-2 text-sm text-theme-text-muted">
          <h2 className="text-xl font-semibold text-theme-text">How we calculate it</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Prices are <b className="text-theme-text">menu (list) prices</b> from pizzeria receipts submitted for Global Pizza Party {data?.year ?? 2026} events. Discounts are tracked separately and not used here.</li>
            <li>Each pizza's price is divided by its area in cm², then scaled to standard 25, 30, 35 and 40 cm sizes so countries are comparable.</li>
            <li>Each event counts once: we take the median per event, then the median across events.</li>
            <li>A country appears once at least one event has a confirmed pizza size. Countries with fewer than {EARLY_BELOW} events are marked <i>early</i>: one pizzeria can swing their number.</li>
            <li>Only pizzas whose size is verified by a reviewer or read with high confidence are used.</li>
            <li>Bundles, all-you-can-eat deals and lump-sum orders are excluded.</li>
            <li>Tax treatment varies by country (many include VAT, US prices are usually pre-tax), so US prices may look slightly low.</li>
          </ul>
          {data && <p className="text-xs text-theme-text-faint">Updated {new Date(data.generatedAt).toLocaleDateString()}.</p>}
        </section>
      </div>
    </Layout>
  );
}
