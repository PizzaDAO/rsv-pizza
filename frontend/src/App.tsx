import React, { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import BrandHelmet from './components/BrandHelmet';
import { BRAND } from './config/brand';
import { GPP_ONLY_PATHS, IS_SERIES_SCOPED } from './config/brandScope';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { HomePage } from './pages/HomePage';
import { RSVPPage } from './pages/RSVPPage';
import { HostPage } from './pages/HostPage';
const DayOfRunPage = React.lazy(() => import('./pages/DayOfRunPage').then(m => ({ default: m.DayOfRunPage })));
const ArtDisplayPage = React.lazy(() => import('./pages/ArtDisplayPage').then(m => ({ default: m.ArtDisplayPage })));
import { EventPage } from './pages/EventPage';
import { AuthVerifyPage } from './pages/AuthVerifyPage';
import { LoginPage } from './pages/LoginPage';
import { NewEventPage } from './pages/NewEventPage';
import { AccountPage } from './pages/AccountPage';
import { GPPLandingPage } from './pages/GPPLandingPage';
import { GPP27CreatePage } from './pages/GPP27CreatePage';
import { SideCreatePage } from './pages/SideCreatePage';
import { CheckInPage } from './pages/CheckInPage';
const DJPage = React.lazy(() => import('./pages/DJPage').then(m => ({ default: m.DJPage })));
const PublicReportPage = React.lazy(() => import('./pages/PublicReportPage').then(m => ({ default: m.PublicReportPage })));
const PublicVenueReportPage = React.lazy(() => import('./pages/PublicVenueReportPage').then(m => ({ default: m.PublicVenueReportPage })));
const DisplayPage = React.lazy(() => import('./pages/DisplayPage').then(m => ({ default: m.DisplayPage })));
const UnderbossDashboard = React.lazy(() => import('./pages/UnderbossDashboard').then(m => ({ default: m.UnderbossDashboard })));
const ShippingDashboard = React.lazy(() => import('./pages/ShippingDashboard').then(m => ({ default: m.ShippingDashboard })));
const AdminPage = React.lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const AdminSeriesPage = React.lazy(() => import('./pages/AdminSeriesPage').then(m => ({ default: m.AdminSeriesPage })));
import { SeriesLandingPage } from './pages/SeriesLandingPage';
const SuggestionsPage = React.lazy(() => import('./pages/SuggestionsPage').then(m => ({ default: m.SuggestionsPage })));
const TaxFormRequestPage = React.lazy(() => import('./pages/TaxFormRequestPage').then(m => ({ default: m.TaxFormRequestPage })));
const PaymentsAdminPage = React.lazy(() => import('./pages/PaymentsAdminPage').then(m => ({ default: m.PaymentsAdminPage })));
const PaymentsHostsPage = React.lazy(() => import('./pages/PaymentsHostsPage').then(m => ({ default: m.PaymentsHostsPage })));
const LatamPaymentsPage = React.lazy(() => import('./pages/LatamPaymentsPage').then(m => ({ default: m.LatamPaymentsPage })));
const SouthAfricaPaymentsPage = React.lazy(() => import('./pages/SouthAfricaPaymentsPage').then(m => ({ default: m.SouthAfricaPaymentsPage })));
const AfricaPaymentsPage = React.lazy(() => import('./pages/AfricaPaymentsPage').then(m => ({ default: m.AfricaPaymentsPage })));
const WestAfricaPaymentsPage = React.lazy(() => import('./pages/WestAfricaPaymentsPage').then(m => ({ default: m.WestAfricaPaymentsPage })));
const EastAfricaPaymentsPage = React.lazy(() => import('./pages/EastAfricaPaymentsPage').then(m => ({ default: m.EastAfricaPaymentsPage })));
const NaPaymentsPage = React.lazy(() => import('./pages/NaPaymentsPage').then(m => ({ default: m.NaPaymentsPage })));
const EuropePaymentsPage = React.lazy(() => import('./pages/EuropePaymentsPage').then(m => ({ default: m.EuropePaymentsPage })));
const IndiaPaymentsPage = React.lazy(() => import('./pages/IndiaPaymentsPage').then(m => ({ default: m.IndiaPaymentsPage })));
const AsiaPaymentsPage = React.lazy(() => import('./pages/AsiaPaymentsPage').then(m => ({ default: m.AsiaPaymentsPage })));
const PartnerIntakePage = React.lazy(() => import('./pages/PartnerIntakePage').then(m => ({ default: m.PartnerIntakePage })));
const PartnerDashboardPage = React.lazy(() => import('./pages/PartnerDashboardPage').then(m => ({ default: m.PartnerDashboardPage })));
const InvoicePage = React.lazy(() => import('./pages/InvoicePage').then(m => ({ default: m.InvoicePage })));
const MouPage = React.lazy(() => import('./pages/MouPage').then(m => ({ default: m.MouPage })));
const ConsolidatedReportPage = React.lazy(() => import('./pages/ConsolidatedReportPage').then(m => ({ default: m.ConsolidatedReportPage })));
const PartnerBizdevPage = React.lazy(() => import('./pages/PartnerBizdevPage').then(m => ({ default: m.PartnerBizdevPage })));
const PostComposerPage = React.lazy(() => import('./pages/PostComposerPage').then(m => ({ default: m.PostComposerPage })));
const OneSheetPage = React.lazy(() => import('./pages/OneSheetPage').then(m => ({ default: m.OneSheetPage })));
import { GPPPizzeriasPage } from './pages/GPPPizzeriasPage';
const PizzaIndexPage = React.lazy(() => import('./pages/PizzaIndexPage').then(m => ({ default: m.PizzaIndexPage })));
import { EventsMapPage } from './pages/EventsMapPage';
const EventsSearchPage = React.lazy(() => import('./pages/EventsSearchPage').then(m => ({ default: m.EventsSearchPage })));
const AdminLogoCleanup = React.lazy(() => import('./pages/AdminLogoCleanup').then(m => ({ default: m.AdminLogoCleanup })));
import { PartnersPage } from './pages/PartnersPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
const PhotosFeedPage = React.lazy(() => import('./pages/PhotosFeedPage').then(m => ({ default: m.PhotosFeedPage })));
const PhotosSlideshowPage = React.lazy(() => import('./pages/PhotosSlideshowPage').then(m => ({ default: m.PhotosSlideshowPage })));
const SurveyPage = React.lazy(() => import('./pages/SurveyPage').then(m => ({ default: m.SurveyPage })));
const HostSurveyPage = React.lazy(() => import('./pages/HostSurveyPage').then(m => ({ default: m.HostSurveyPage })));

// Legacy redirect: /sponsor-intake/:token → /partner-intake/:token
// <Navigate> doesn't forward path params, so we wrap useParams().
function SponsorIntakeRedirect() {
  const { token } = useParams<{ token: string }>();
  return <Navigate to={`/partner-intake/${token}`} replace />;
}

const GraphicsDashboard = React.lazy(() => import('./pages/GraphicsDashboard').then(m => ({ default: m.GraphicsDashboard })));
const GraphicsFlyerEdit = React.lazy(() => import('./pages/GraphicsFlyerEdit').then(m => ({ default: m.GraphicsFlyerEdit })));
// cacciatore-72814: super-admin-only SWC variant of /map (lazy because the
// page is admin-only and rarely visited).
const EventsMapSwcPage = React.lazy(() => import('./pages/EventsMapSwcPage').then(m => ({ default: m.EventsMapSwcPage })));
// focaccia-58293: public no-clustering variant of /map (lazy to keep main bundle small).
const EventsMapAllPage = React.lazy(() => import('./pages/EventsMapAllPage').then(m => ({ default: m.EventsMapAllPage })));

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
    if (cls === 'doge-theme') {
      fontLink = document.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&display=swap';
      document.head.appendChild(fontLink);
    }
    return () => {
      document.documentElement.classList.remove(cls);
      fontLink?.remove();
    };
  }, []);

  return (
    <HelmetProvider>
      <BrandHelmet />
      <AuthProvider>
        <ThemeProvider theme="dark">
        <BrowserRouter>
          <Suspense fallback={null}>
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
            <Route path="/pizza-index" element={gppOnly("/pizza-index", <Suspense fallback={null}><PizzaIndexPage /></Suspense>)} />
            {/* /map must come before /:slug */}
            <Route path="/events" element={<Suspense fallback={null}><EventsSearchPage /></Suspense>} />
            <Route path="/map" element={gppOnly("/map", <EventsMapPage />)} />
            {/* cacciatore-72814: /map/swc super-admin-only variant; must come before /:slug */}
            <Route path="/map/swc" element={gppOnly("/map/swc", <Suspense fallback={null}><EventsMapSwcPage /></Suspense>)} />
            {/* focaccia-58293: /map/all public no-clustering variant; must come before /:slug */}
            <Route path="/map/all" element={gppOnly("/map/all", <Suspense fallback={null}><EventsMapAllPage /></Suspense>)} />
            {/* /partners must come before /:slug */}
            <Route path="/partners" element={gppOnly("/partners", <PartnersPage />)} />
            {/* stromboli-71593: /leaderboard + /gpp/leaderboard must come before /:slug */}
            <Route path="/leaderboard" element={gppOnly("/leaderboard", <LeaderboardPage />)} />
            <Route path="/gpp/leaderboard" element={gppOnly("/gpp/leaderboard", <LeaderboardPage />)} />
            {/* /payments must come before /:slug */}
            <Route path="/tax-form" element={gppOnly("/tax-form", <Suspense fallback={null}><TaxFormRequestPage /></Suspense>)} />
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
            <Route path="/report/:slug" element={<PublicReportPage />} />
            <Route path="/venue-report/:slug" element={<PublicVenueReportPage />} />
            <Route path="/rsvp/:inviteCode" element={<RSVPPage />} />
            <Route path="/host/:inviteCode" element={<HostPage />} />
            <Route path="/host/:inviteCode/:tab" element={<HostPage />} />
            {/* pepperoni-58341: mobile day-of dashboard for hosts/cohosts */}
            <Route path="/run/:inviteCode" element={<DayOfRunPage />} />
            <Route path="/checkin/:inviteCode/:guestId" element={<CheckInPage />} />
            <Route path="/dj/:inviteCode" element={<DJPage />} />
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
            <Route path="/graphics" element={gppOnly("/graphics", <Suspense fallback={null}><GraphicsDashboard /></Suspense>)} />
            <Route path="/graphics/:slug/edit" element={gppOnly("/graphics/:slug/edit", <Suspense fallback={null}><GraphicsFlyerEdit /></Suspense>)} />
            <Route path="/post" element={gppOnly("/post", <PostComposerPage />)} />
            <Route path="/onesheet/:slug" element={<OneSheetPage />} />
            <Route path="/raleigh" element={gppOnly("/raleigh", <Navigate to="/durham" replace />)} />
            <Route path="/cmohhr0640003jp047krjarz0" element={gppOnly("/cmohhr0640003jp047krjarz0", <Navigate to="/nashville" replace />)} />
            {/* romana-61204: post-event survey — must come before /:slug catch-all */}
            <Route path="/survey/:token" element={<SurveyPage />} />
            {/* panzerotti-58527: post-event host survey — before /:slug catch-all */}
            <Route path="/host-survey/:token" element={<HostSurveyPage />} />
            {/* white-label: public series landing — before /:slug catch-all */}
            <Route path="/series/:slug" element={<SeriesLandingPage />} />
            {/* Catch-all route for custom URLs - must be last */}
            <Route path="/:slug" element={<EventPage />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
        </ThemeProvider>
      </AuthProvider>
    </HelmetProvider>
  );
}

export default App;
