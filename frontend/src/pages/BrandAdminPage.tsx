import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Helmet } from 'react-helmet-async';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Layout } from '../components/Layout';
import { LoginModal } from '../components/LoginModal';
import { NotFoundPage } from './NotFoundPage';
import { useAuth } from '../contexts/AuthContext';
import { useBrandAdminAccess } from '../lib/brandAdminAccess';
import { fetchBrandSettings, describeApiError, type BrandAdminSeries, type BrandAssets, type BrandSettings } from '../lib/brandAdminApi';
import type { BrandAssetSlot } from '../lib/seriesApi';
import { IdentityPanel } from '../components/brand-admin/IdentityPanel';
import { ThemePanel } from '../components/brand-admin/ThemePanel';
import { ImagesPanel } from '../components/brand-admin/ImagesPanel';
import { ChecklistPanel } from '../components/brand-admin/ChecklistPanel';
import { EventsPanel } from '../components/brand-admin/EventsPanel';
import { HistoryPanel } from '../components/brand-admin/HistoryPanel';

export const BRAND_ADMIN_TABS = [
  { key: 'identity', label: 'Identity' },
  { key: 'look', label: 'Look' },
  { key: 'images', label: 'Images' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'events', label: 'Events' },
  { key: 'history', label: 'History' },
] as const;
type TabKey = (typeof BRAND_ADMIN_TABS)[number]['key'];
const isTab = (v: string | undefined): v is TabKey => BRAND_ADMIN_TABS.some((t) => t.key === v);
const tabPath = (k: TabKey) => (k === 'identity' ? '/brand-admin' : `/brand-admin/${k}`);

/** Settings + current images for one series; owns loading and the shared saved state. */
const SeriesAdmin: React.FC<{ series: BrandAdminSeries; tab: TabKey }> = ({ series, tab }) => {
  const [settings, setSettings] = useState<BrandSettings | null>(null);
  const [assets, setAssets] = useState<BrandAssets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visited, setVisited] = useState<Set<TabKey>>(() => new Set([tab]));

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchBrandSettings(series.id);
      setSettings(res.settings);
      setAssets(res.assets);
    } catch (e) {
      setError(describeApiError(e));
    }
  }, [series.id]);
  useEffect(() => { setSettings(null); setAssets(null); void load(); }, [load]);
  // Panels stay mounted once opened, so unsaved edits survive a tab switch.
  useEffect(() => { setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))); }, [tab]);

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[#E52828]" role="alert">{error}</p>
        <button type="button" className="btn-secondary text-sm" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!settings || !assets) return <div className="flex items-center gap-2 text-sm text-theme-text-muted"><Loader2 size={16} className="animate-spin" />Loading settings…</div>;

  const onAssetChanged = (slot: BrandAssetSlot, url: string | null) => setAssets((a) => (a ? { ...a, [slot]: url } : a));
  const panel = (key: TabKey, node: React.ReactNode) => (
    <div hidden={tab !== key} role="tabpanel" aria-label={key}>{visited.has(key) || tab === key ? node : null}</div>
  );

  return (
    <>
      {panel('identity', <IdentityPanel seriesId={series.id} settings={settings} onSaved={setSettings} />)}
      {panel('look', <ThemePanel seriesId={series.id} settings={settings} onSaved={setSettings} />)}
      {panel('images', <ImagesPanel seriesId={series.id} assets={assets} onChanged={onAssetChanged} />)}
      {panel('checklist', <ChecklistPanel seriesId={series.id} />)}
      {panel('events', <EventsPanel seriesId={series.id} alertsEnabled={series.actorKind === 'series_admin' ? series.alertsEnabled : null} />)}
      {panel('history', <HistoryPanel seriesId={series.id} onReverted={setSettings} />)}
    </>
  );
};

/**
 * Brand settings for brand admins (and super-admins), served on the brand's own site at
 * /brand-admin[/identity|look|images|checklist|events|history]. Anyone else sees the ordinary
 * not-found page, so the route does not advertise itself.
 */
export function BrandAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const [showLogin, setShowLogin] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const access = useBrandAdminAccess(!!user, retry);

  // Hooks are all above; the branches below only choose what to render.
  if (authLoading || (user && access.status === 'loading')) {
    return <Layout><div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-theme-text-muted" /></div></Layout>;
  }

  if (!user) {
    return (
      <Layout>
        <Helmet><meta name="robots" content="noindex" /></Helmet>
        <div className="flex flex-col items-center text-center px-4 py-24 max-w-md mx-auto">
          <ShieldCheck size={40} className="text-theme-accent mb-3" />
          <h1 className="text-xl font-bold text-theme-text mb-2">Brand admin</h1>
          <p className="text-theme-text-muted text-sm mb-4">Sign in to manage your brand.</p>
          <button type="button" onClick={() => setShowLogin(true)} className="btn-primary text-sm">Sign in</button>
        </div>
        <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
      </Layout>
    );
  }

  if (access.status === 'error') {
    return (
      <Layout>
        <div className="flex flex-col items-center text-center px-4 py-24 max-w-md mx-auto space-y-3">
          <p className="text-sm text-[#E52828]" role="alert">{access.message}</p>
          <button type="button" className="btn-secondary text-sm" onClick={() => setRetry((n) => n + 1)}>Try again</button>
        </div>
      </Layout>
    );
  }

  const list = access.status === 'ready' ? access.series : [];
  if (list.length === 0) return <NotFoundPage />;
  if (tabParam !== undefined && !isTab(tabParam)) return <NotFoundPage />;

  const tab: TabKey = isTab(tabParam) ? tabParam : 'identity';
  const series = list.find((s) => s.id === pickedId) ?? list[0];

  return (
    <Layout>
      <Helmet><meta name="robots" content="noindex" /></Helmet>
      <div className="max-w-3xl mx-auto px-4 py-8 min-w-0">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-theme-text break-words">Brand settings</h1>
          <p className="text-sm text-theme-text-muted break-words">{series.brandName || series.displayName}{series.actorKind === 'super_admin' ? ' · PizzaDAO admin view' : ''}</p>
          {list.length > 1 && (
            <div className="mt-3">
              <select aria-label="Series" className="w-full sm:w-auto" value={series.id} onChange={(e) => setPickedId(e.target.value)}>
                {list.map((s) => <option key={s.id} value={s.id}>{s.brandName || s.displayName}</option>)}
              </select>
            </div>
          )}
        </div>

        <nav aria-label="Brand settings sections" className="flex gap-1 overflow-x-auto border-b border-theme-stroke mb-6 -mx-4 px-4">
          {BRAND_ADMIN_TABS.map((t) => (
            <Link key={t.key} to={tabPath(t.key)} aria-current={tab === t.key ? 'page' : undefined} replace
              className={`px-3 py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === t.key ? 'border-[#E52828] text-theme-text font-semibold' : 'border-transparent text-theme-text-muted hover:text-theme-text'}`}>
              {t.label}
            </Link>
          ))}
        </nav>

        <SeriesAdmin key={series.id} series={series} tab={tab} />
      </div>
    </Layout>
  );
}

export default BrandAdminPage;
