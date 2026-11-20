import { lazyWithReload } from './lib/chunkReload';
import React, { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';
import BrandHelmet from './components/BrandHelmet';
import { BRAND } from './config/brand';
import { GPP_ONLY_PATHS, IS_SERIES_SCOPED } from './config/brandScope';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { HomePage } from './pages/HomePage';
import { RSVPPage } from './pages/RSVPPage';
const HostPage = lazyWithReload(() => import('./pages/HostPage').then(m => ({ default: m.HostPage })));
const NotFoundPage = lazyWithReload(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));
const DayOfRunPage = lazyWithReload(() => import('./pages/DayOfRunPage').then(m => ({ default: m.DayOfRunPage })));
const ArtDisplayPage = lazyWithReload(() => import('./pages/ArtDisplayPage').then(m => ({ default: m.ArtDisplayPage })));
import { EventPage } from './pages/EventPage';
const AuthVerifyPage = lazyWithReload(() => import('./pages/AuthVerifyPage').then(m => ({ default: m.AuthVerifyPage })));
const PizzadaoLinkPage = lazyWithReload(() => import('./pages/PizzadaoLinkPage').then(m => ({ default: m.PizzadaoLinkPage })));
const LoginPage = lazyWithReload(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const NewEventPage = lazyWithReload(() => import('./pages/NewEventPage').then(m => ({ default: m.NewEventPage })));
const AccountPage = lazyWithReload(() => import('./pages/AccountPage').then(m => ({ default: m.AccountPage })));
const GPPLandingPage = lazyWithReload(() => import('./pages/GPPLandingPage').then(m => ({ default: m.GPPLandingPage })));
const GPP27CreatePage = lazyWithReload(() => import('./pages/GPP27CreatePage').then(m => ({ default: m.GPP27CreatePage })));
const SideCreatePage = lazyWithReload(() => import('./pages/SideCreatePage').then(m => ({ default: m.SideCreatePage })));
const CheckInPage = lazyWithReload(() => import('./pages/CheckInPage').then(m => ({ default: m.CheckInPage })));
const DJPage = lazyWithReload(() => import('./pages/DJPage').then(m => ({ default: m.DJPage })));
const JudgePage = lazyWithReload(() => import('./pages/JudgePage').then(m => ({ default: m.JudgePage })));
const HackathonGalleryPage = lazyWithReload(() => import('./pages/HackathonGalleryPage').then(m => ({ default: m.HackathonGalleryPage })));
const BoothPage = lazyWithReload(() => import('./pages/BoothPage').then(m => ({ default: m.BoothPage })));
const HackathonProjectPage = lazyWithReload(() => import('./pages/HackathonProjectPage').then(m => ({ default: m.HackathonProjectPage })));
const PublicReportPage = lazyWithReload(() => import('./pages/PublicReportPage').then(m => ({ default: m.PublicReportPage })));
const PublicVenueReportPage = lazyWithReload(() => import('./pages/PublicVenueReportPage').then(m => ({ default: m.PublicVenueReportPage })));
const DisplayPage = lazyWithReload(() => import('./pages/DisplayPage').then(m => ({ default: m.DisplayPage })));
const UnderbossDashboard = lazyWithReload(() => import('./pages/UnderbossDashboard').then(m => ({ default: m.UnderbossDashboard })));
const ShippingDashboard = lazyWithReload(() => import('./pages/ShippingDashboard').then(m => ({ default: m.ShippingDashboard })));
const AdminPage = lazyWithReload(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
// Brand-admin invite acceptance (works on brand sites: not in GPP_ONLY_PATHS).
const BrandAdminAcceptPage = lazyWithReload(() => import('./pages/BrandAdminAcceptPage').then(m => ({ default: m.BrandAdminAcceptPage })));
// Brand settings for brand admins (and super-admins): /brand-admin[/look|images|checklist|events|history]. Lazy, not in GPP_ONLY_PATHS.
const BrandAdminPage = lazyWithReload(() => import('./pages/BrandAdminPage').then(m => ({ default: m.BrandAdminPage })));
const AdminSeriesPage = lazyWithReload(() => import('./pages/AdminSeriesPage').then(m => ({ default: m.AdminSeriesPage })));
const SeriesLandingPage = lazyWithReload(() => import('./pages/SeriesLandingPage').then(m => ({ default: m.SeriesLandingPage })));
const SuggestionsPage = lazyWithReload(() => import('./pages/SuggestionsPage').then(m => ({ default: m.SuggestionsPage })));
const TaxFormRequestPage = lazyWithReload(() => import('./pages/TaxFormRequestPage').then(m => ({ default: m.TaxFormRequestPage })));
const PaymentsAdminPage = lazyWithReload(() => import('./pages/PaymentsAdminPage').then(m => ({ default: m.PaymentsAdminPage })));
const PaymentsHostsPage = lazyWithReload(() => import('./pages/PaymentsHostsPage').then(m => ({ default: m.PaymentsHostsPage })));
const LatamPaymentsPage = lazyWithReload(() => import('./pages/LatamPaymentsPage').then(m => ({ default: m.LatamPaymentsPage })));
const SouthAfricaPaymentsPage = lazyWithReload(() => import('./pages/SouthAfricaPaymentsPage').then(m => ({ default: m.SouthAfricaPaymentsPage })));
const AfricaPaymentsPage = lazyWithReload(() => import('./pages/AfricaPaymentsPage').then(m => ({ default: m.AfricaPaymentsPage })));
const WestAfricaPaymentsPage = lazyWithReload(() => import('./pages/WestAfricaPaymentsPage').then(m => ({ default: m.WestAfricaPaymentsPage })));
const EastAfricaPaymentsPage = lazyWithReload(() => import('./pages/EastAfricaPaymentsPage').then(m => ({ default: m.EastAfricaPaymentsPage })));
const NaPaymentsPage = lazyWithReload(() => import('./pages/NaPaymentsPage').then(m => ({ default: m.NaPaymentsPage })));
const EuropePaymentsPage = lazyWithReload(() => import('./pages/EuropePaymentsPage').then(m => ({ default: m.EuropePaymentsPage })));
const IndiaPaymentsPage = lazyWithReload(() => import('./pages/IndiaPaymentsPage').then(m => ({ default: m.IndiaPaymentsPage })));
const AsiaPaymentsPage = lazyWithReload(() => import('./pages/AsiaPaymentsPage').then(m => ({ default: m.AsiaPaymentsPage })));
const PartnerIntakePage = lazyWithReload(() => import('./pages/PartnerIntakePage').then(m => ({ default: m.PartnerIntakePage })));
const PartnerDashboardPage = lazyWithReload(() => import('./pages/PartnerDashboardPage').then(m => ({ default: m.PartnerDashboardPage })));
const InvoicePage = lazyWithReload(() => import('./pages/InvoicePage').then(m => ({ default: m.InvoicePage })));
const MouPage = lazyWithReload(() => import('./pages/MouPage').then(m => ({ default: m.MouPage })));
const ConsolidatedReportPage = lazyWithReload(() => import('./pages/ConsolidatedReportPage').then(m => ({ default: m.ConsolidatedReportPage })));
const PartnerBizdevPage = lazyWithReload(() => import('./pages/PartnerBizdevPage').then(m => ({ default: m.PartnerBizdevPage })));
const PostComposerPage = lazyWithReload(() => import('./pages/PostComposerPage').then(m => ({ default: m.PostComposerPage })));
const OneSheetPage = lazyWithReload(() => import('./pages/OneSheetPage').then(m => ({ default: m.OneSheetPage })));
const GPPPizzeriasPage = lazyWithReload(() => import('./pages/GPPPizzeriasPage').then(m => ({ default: m.GPPPizzeriasPage })));
const PizzaIndexPage = lazyWithReload(() => import('./pages/PizzaIndexPage').then(m => ({ default: m.PizzaIndexPage })));
const EventsMapPage = lazyWithReload(() => import('./pages/EventsMapPage').then(m => ({ default: m.EventsMapPage })));
const EventsSearchPage = lazyWithReload(() => import('./pages/EventsSearchPage').then(m => ({ default: m.EventsSearchPage })));
const AdminLogoCleanup = lazyWithReload(() => import('./pages/AdminLogoCleanup').then(m => ({ default: m.AdminLogoCleanup })));
const PartnersPage = lazyWithReload(() => import('./pages/PartnersPage').then(m => ({ default: m.PartnersPage })));
const LeaderboardPage = lazyWithReload(() => import('./pages/LeaderboardPage').then(m => ({ default: m.LeaderboardPage })));
const PhotosFeedPage = lazyWithReload(() => import('./pages/PhotosFeedPage').then(m => ({ default: m.PhotosFeedPage })));
const PhotosSlideshowPage = lazyWithReload(() => import('./pages/PhotosSlideshowPage').then(m => ({ default: m.PhotosSlideshowPage })));
const SurveyPage = lazyWithReload(() => import('./pages/SurveyPage').then(m => ({ default: m.SurveyPage })));
const NftClaimPage = lazyWithReload(() => import('./pages/NftClaimPage').then(m => ({ default: m.NftClaimPage })));
const HostSurveyPage = lazyWithReload(() => import('./pages/HostSurveyPage').then(m => ({ default: m.HostSurveyPage })));

// Shown while a lazily loaded route chunk downloads (same look as the app-level
// fallback in main.tsx so the transition doesn't flash).
function PageFallback() {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#fff', fontFamily: 'system-ui, sans-serif' }}
    >
      Loading…
    </div>
  );
}

// Legacy redirect: /sponsor-intake/:token → /partner-intake/:token
// <Navigate> doesn't forward path params, so we wrap useParams().
function SponsorIntakeRedirect() {
  const { token } = useParams<{ token: string }>();
  return <Navigate to={`/partner-intake/${token}`} replace />;
}

const GraphicsDashboard = lazyWithReload(() => import('./pages/GraphicsDashboard').then(m => ({ default: m.GraphicsDashboard })));
const GraphicsFlyerEdit = lazyWithReload(() => import('./pages/GraphicsFlyerEdit').then(m => ({ default: m.GraphicsFlyerEdit })));
// cacciatore-72814: super-admin-only SWC variant of /map (lazy because the
// page is admin-only and rarely visited).
const EventsMapSwcPage = lazyWithReload(() => import('./pages/EventsMapSwcPage').then(m => ({ default: m.EventsMapSwcPage })));
// focaccia-58293: public no-clustering variant of /map (lazy to keep main bundle small).
const EventsMapAllPage = lazyWithReload(() => import('./pages/EventsMapAllPage').then(m => ({ default: m.EventsMapAllPage })));

// White-label: on a series-scoped build, every route in GPP_ONLY_PATHS renders a
// redirect to `/` instead of its page. Unset (default brand) => element untouched.
// Plain function, not a hook, so rules-of-hooks is unaffected.
function gppOnly(path: string, element: React.ReactElement): React.ReactElement {
  return IS_SERIES_SCOPED && GPP_ONLY_PATHS.includes(path) ? <Navigate to="/" replace /> : element;
}

function App() {
  // White-label: apply the brand's theme class at the document root so a
  // re-branded deploy can override the design tokens (see src/index.css) via
  // VITE_BRAND_THEME_CLASS. Empty for the default brand => no class added =>
  // the default :root theme, unchanged. Per-page themes (e.g. .gpp-theme
  // wrappers) still override within their subtree.
  useEffect(() => {
    const cls = BRAND.themeClass;
    if (!cls) return;
    document.documentElement.classList.add(cls);
    // Doge Day's heavy rounded headline font; only fetched for that brand.
    let fontLink: HTMLLinkElement | null = null;
    const fontHref =
      cls === 'doge-theme' ? 'https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&display=swap'
      // Monad: Inter for headings/body (stand-in for their brittiSans), JetBrains Mono for buttons/labels.
      : cls === 'monad-theme' ? 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap'
      // Stand With Crypto: Satoshi (their site's typeface), served by Fontshare; only fetched for that brand.
      : cls === 'swc-theme' ? 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap'
      // Runtime build: the tokens load Inter (heading + body); the Monad buttons also need JetBrains Mono.
      : __BRAND_RUNTIME__ && cls === 'brand-monad' ? 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap'
      : '';
    if (fontHref) {
      fontLink = document.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = fontHref;
      document.head.appendChild(fontLink);
    }
    // Team1's Kanit type (team1.network); only fetched for that brand.
    let team1FontLink: HTMLLinkElement | null = null;
    if (cls === 'team1-theme') {
      team1FontLink = document.createElement('link');
      team1FontLink.rel = 'stylesheet';
      team1FontLink.href = 'https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600&display=swap';
      document.head.appendChild(team1FontLink);
    }
    return () => {
      document.documentElement.classList.remove(cls);
      fontLink?.remove();
      team1FontLink?.remove();
    };
  }, []);

  return (
    <HelmetProvider>
      <BrandHelmet />
      <AuthProvider>
        <ThemeProvider theme="dark">
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/new" element={<NewEventPage />} />
            <Route path="/gpp" element={gppOnly("/gpp", <GPPLandingPage />)} />
            {/* soppressata-50927: admin/UB-gated 2027 create flow; must come before /:slug */}
            <Route path="/gpp27" element={gppOnly("/gpp27", <GPP27CreatePage />)} />
            {/* rigatoni-58919: admin/UB-gated side-event create flow; must come before /:slug */}
            <Route path="/side" element={gppOnly("/side", <SideCreatePage />)} />
            <Route path="/gpp/pizzerias" element={gppOnly("/gpp/pizzerias", <GPPPizzeriasPage />)} />
            {/* sfincione-40417: public Pizza Price Index; must come before /:slug */}
            <Route path="/pizza-index" element={gppOnly("/pizza-index", <Suspense fallback={<PageFallback />}><PizzaIndexPage /></Suspense>)} />
            {/* /map must come before /:slug */}
            <Route path="/events" element={<Suspense fallback={<PageFallback />}><EventsSearchPage /></Suspense>} />
            <Route path="/map" element={gppOnly("/map", <EventsMapPage />)} />
            {/* cacciatore-72814: /map/swc super-admin-only variant; must come before /:slug */}
            <Route path="/map/swc" element={gppOnly("/map/swc", <Suspense fallback={<PageFallback />}><EventsMapSwcPage /></Suspense>)} />
            {/* focaccia-58293: /map/all public no-clustering variant; must come before /:slug */}
            <Route path="/map/all" element={gppOnly("/map/all", <Suspense fallback={<PageFallback />}><EventsMapAllPage /></Suspense>)} />
            {/* /partners must come before /:slug */}
            <Route path="/partners" element={gppOnly("/partners", <PartnersPage />)} />
            {/* stromboli-71593: /leaderboard + /gpp/leaderboard must come before /:slug */}
            <Route path="/leaderboard" element={gppOnly("/leaderboard", <LeaderboardPage />)} />
            <Route path="/gpp/leaderboard" element={gppOnly("/gpp/leaderboard", <LeaderboardPage />)} />
            {/* /payments must come before /:slug */}
            <Route path="/tax-form" element={gppOnly("/tax-form", <Suspense fallback={<PageFallback />}><TaxFormRequestPage /></Suspense>)} />
            <Route path="/payments" element={gppOnly("/payments", <PaymentsAdminPage />)} />
            {/* trusted hosts phase 1: read-only admin report; must come before /:slug */}
            <Route path="/payments/hosts" element={gppOnly("/payments/hosts", <PaymentsHostsPage />)} />
            {/* argentina-92103: regional LATAM portal for the LATAM
                underboss. Wraps PaymentsAdminPage with regionFilter +
                portalSlug. Must come before /:slug. */}
            <Route path="/payments/latam" element={gppOnly("/payments/latam", <LatamPaymentsPage />)} />
            {/* tortelli-92103: regional /payments/<region> portals for the
                rest of the UB regional split. Each wraps PaymentsAdminPage
                with a fixed regionFilter + portalSlug. Must come before /:slug. */}
            <Route path="/payments/southafrica" element={gppOnly("/payments/southafrica", <SouthAfricaPaymentsPage />)} />
            <Route path="/payments/africa" element={gppOnly("/payments/africa", <AfricaPaymentsPage />)} />
            <Route path="/payments/westafrica" element={gppOnly("/payments/westafrica", <WestAfricaPaymentsPage />)} />
            <Route path="/payments/eastafrica" element={gppOnly("/payments/eastafrica", <EastAfricaPaymentsPage />)} />
            <Route path="/payments/na" element={gppOnly("/payments/na", <NaPaymentsPage />)} />
            <Route path="/payments/europe" element={gppOnly("/payments/europe", <EuropePaymentsPage />)} />
            <Route path="/payments/india" element={gppOnly("/payments/india", <IndiaPaymentsPage />)} />
            <Route path="/payments/asia" element={gppOnly("/payments/asia", <AsiaPaymentsPage />)} />
            {/* margherita-43821: /photos public global feed; must come before /:slug */}
            {/* crespelle-58543: /photos/play fullscreen slideshow — before /:slug */}
            <Route path="/photos/play" element={gppOnly("/photos/play", <PhotosSlideshowPage />)} />
            <Route path="/photos" element={gppOnly("/photos", <PhotosFeedPage />)} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/auth/verify" element={<AuthVerifyPage />} />
            <Route path="/link/pizzadao" element={<PizzadaoLinkPage />} />
            <Route path="/report/:slug" element={<PublicReportPage />} />
            <Route path="/venue-report/:slug" element={<PublicVenueReportPage />} />
            <Route path="/rsvp/:inviteCode" element={<RSVPPage />} />
            <Route path="/host/:inviteCode" element={<HostPage />} />
            <Route path="/host/:inviteCode/:tab" element={<HostPage />} />
            {/* pepperoni-58341: mobile day-of dashboard for hosts/cohosts */}
            <Route path="/run/:inviteCode" element={<DayOfRunPage />} />
            <Route path="/checkin/:inviteCode/:guestId" element={<CheckInPage />} />
            <Route path="/dj/:inviteCode" element={<DJPage />} />
            {/* Hackathon PR 4: judge queue + scoring (works on brand sites; not in GPP_ONLY_PATHS) */}
            <Route path="/judge/:inviteCode" element={<JudgePage />} />
            {/* pepperoni-58341: full-bleed art slideshow — more specific than /display/:partyId/:slug */}
            <Route path="/display/:partyId/art" element={<ArtDisplayPage />} />
            <Route path="/display/:partyId/:slug" element={<DisplayPage />} />
            <Route path="/underboss" element={gppOnly("/underboss", <UnderbossDashboard />)} />
            <Route path="/underboss/:region" element={gppOnly("/underboss/:region", <UnderbossDashboard />)} />
            <Route path="/shipping" element={gppOnly("/shipping", <ShippingDashboard />)} />
            <Route path="/admin" element={gppOnly("/admin", <AdminPage />)} />
            {/* scarpetta-58472: admin/underboss-only suggestions list — before /:slug catch-all */}
            <Route path="/suggestions" element={gppOnly("/suggestions", <SuggestionsPage />)} />
            <Route path="/admin/logo-cleanup" element={gppOnly("/admin/logo-cleanup", <AdminLogoCleanup />)} />
            <Route path="/admin/series" element={gppOnly("/admin/series", <AdminSeriesPage />)} />
            <Route path="/brand-admin/accept" element={<Suspense fallback={<PageFallback />}><BrandAdminAcceptPage /></Suspense>} />
            <Route path="/brand-admin/:tab?" element={<Suspense fallback={<PageFallback />}><BrandAdminPage /></Suspense>} />
            <Route path="/partner" element={gppOnly("/partner", <PartnerDashboardPage />)} />
            <Route path="/partner/report" element={gppOnly("/partner/report", <ConsolidatedReportPage />)} />
            {/* soppressata-72251: per-partner BizDev industry report — before /:slug catch-all */}
            <Route path="/partner/bizdev" element={gppOnly("/partner/bizdev", <PartnerBizdevPage />)} />
            <Route path="/partner-dashboard" element={gppOnly("/partner-dashboard", <Navigate to="/partner" replace />)} />
            <Route path="/sponsor-dashboard" element={gppOnly("/sponsor-dashboard", <Navigate to="/partner" replace />)} />
            <Route path="/partner-intake/:token" element={gppOnly("/partner-intake/:token", <PartnerIntakePage />)} />
            <Route path="/invoice/:viewToken" element={gppOnly("/invoice/:viewToken", <InvoicePage />)} />
            <Route path="/mou/:viewToken" element={gppOnly("/mou/:viewToken", <MouPage />)} />
            <Route path="/sponsor-intake/:token" element={gppOnly("/sponsor-intake/:token", <SponsorIntakeRedirect />)} />
            <Route path="/graphics" element={gppOnly("/graphics", <Suspense fallback={<PageFallback />}><GraphicsDashboard /></Suspense>)} />
            <Route path="/graphics/:slug/edit" element={gppOnly("/graphics/:slug/edit", <Suspense fallback={<PageFallback />}><GraphicsFlyerEdit /></Suspense>)} />
            <Route path="/post" element={gppOnly("/post", <PostComposerPage />)} />
            <Route path="/onesheet/:slug" element={<OneSheetPage />} />
            <Route path="/raleigh" element={gppOnly("/raleigh", <Navigate to="/durham" replace />)} />
            <Route path="/cmohhr0640003jp047krjarz0" element={gppOnly("/cmohhr0640003jp047krjarz0", <Navigate to="/nashville" replace />)} />
            {/* romana-61204: post-event survey — must come before /:slug catch-all */}
            <Route path="/survey/:token" element={<SurveyPage />} />
            {/* claim-later-nft: private attendance-NFT claim link — before /:slug catch-all */}
            <Route path="/nft/claim/:token" element={<NftClaimPage />} />
            {/* panzerotti-58527: post-event host survey — before /:slug catch-all */}
            <Route path="/host-survey/:token" element={<HostSurveyPage />} />
            {/* white-label: public series landing — before /:slug catch-all */}
            <Route path="/series/:slug" element={<SeriesLandingPage />} />
            {/* Catch-all route for custom URLs - must be last */}
            {/* Hackathon PR 6: public gallery + project pages (brand sites too; not in GPP_ONLY_PATHS).
                Two segments, so they never shadow the /:slug catch-all; static first segments
                (/host/:x, /map/swc, ...) still rank above them. */}
            {/* Photo booth: above /:slug, same reasoning as /projects */}
            <Route path="/:slug/booth" element={<Suspense fallback={<PageFallback />}><BoothPage /></Suspense>} />
            <Route path="/:slug/projects" element={<Suspense fallback={<PageFallback />}><HackathonGalleryPage /></Suspense>} />
            <Route path="/:slug/projects/:projectSlug" element={<Suspense fallback={<PageFallback />}><HackathonProjectPage /></Suspense>} />
            <Route path="/:slug" element={<EventPage />} />
            {/* Unknown multi-segment paths used to render nothing. */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
        </ThemeProvider>
      </AuthProvider>
    </HelmetProvider>
  );
}

export default App;
