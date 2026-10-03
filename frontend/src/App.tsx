import React, { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import BrandHelmet from './components/BrandHelmet';
import { BRAND } from './config/brand';
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
const PaymentsAdminPage = React.lazy(() => import('./pages/PaymentsAdminPage').then(m => ({ default: m.PaymentsAdminPage })));
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
import { EventsMapPage } from './pages/EventsMapPage';
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
    return () => document.documentElement.classList.remove(cls);
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
            <Route path="/gpp" element={<GPPLandingPage />} />
            {/* soppressata-50927: admin/UB-gated 2027 create flow; must come before /:slug */}
            <Route path="/gpp27" element={<GPP27CreatePage />} />
            {/* rigatoni-58919: admin/UB-gated side-event create flow; must come before /:slug */}
            <Route path="/side" element={<SideCreatePage />} />
            <Route path="/gpp/pizzerias" element={<GPPPizzeriasPage />} />
            {/* /map must come before /:slug */}
            <Route path="/map" element={<EventsMapPage />} />
            {/* cacciatore-72814: /map/swc super-admin-only variant; must come before /:slug */}
            <Route path="/map/swc" element={<Suspense fallback={null}><EventsMapSwcPage /></Suspense>} />
            {/* focaccia-58293: /map/all public no-clustering variant; must come before /:slug */}
            <Route path="/map/all" element={<Suspense fallback={null}><EventsMapAllPage /></Suspense>} />
            {/* /partners must come before /:slug */}
            <Route path="/partners" element={<PartnersPage />} />
            {/* stromboli-71593: /leaderboard + /gpp/leaderboard must come before /:slug */}
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/gpp/leaderboard" element={<LeaderboardPage />} />
            {/* /payments must come before /:slug */}
            <Route path="/payments" element={<PaymentsAdminPage />} />
            {/* argentina-92103: regional LATAM portal for the LATAM
                underboss. Wraps PaymentsAdminPage with regionFilter +
                portalSlug. Must come before /:slug. */}
            <Route path="/payments/latam" element={<LatamPaymentsPage />} />
            {/* tortelli-92103: regional /payments/<region> portals for the
                rest of the UB regional split. Each wraps PaymentsAdminPage
                with a fixed regionFilter + portalSlug. Must come before /:slug. */}
            <Route path="/payments/southafrica" element={<SouthAfricaPaymentsPage />} />
            <Route path="/payments/africa" element={<AfricaPaymentsPage />} />
            <Route path="/payments/westafrica" element={<WestAfricaPaymentsPage />} />
            <Route path="/payments/eastafrica" element={<EastAfricaPaymentsPage />} />
            <Route path="/payments/na" element={<NaPaymentsPage />} />
            <Route path="/payments/europe" element={<EuropePaymentsPage />} />
            <Route path="/payments/india" element={<IndiaPaymentsPage />} />
            <Route path="/payments/asia" element={<AsiaPaymentsPage />} />
            {/* margherita-43821: /photos public global feed; must come before /:slug */}
            {/* crespelle-58543: /photos/play fullscreen slideshow — before /:slug */}
            <Route path="/photos/play" element={<PhotosSlideshowPage />} />
            <Route path="/photos" element={<PhotosFeedPage />} />
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
            <Route path="/underboss" element={<UnderbossDashboard />} />
            <Route path="/underboss/:region" element={<UnderbossDashboard />} />
            <Route path="/shipping" element={<ShippingDashboard />} />
            <Route path="/admin" element={<AdminPage />} />
            {/* scarpetta-58472: admin/underboss-only suggestions list — before /:slug catch-all */}
            <Route path="/suggestions" element={<SuggestionsPage />} />
            <Route path="/admin/logo-cleanup" element={<AdminLogoCleanup />} />
            <Route path="/admin/series" element={<AdminSeriesPage />} />
            <Route path="/partner" element={<PartnerDashboardPage />} />
            <Route path="/partner/report" element={<ConsolidatedReportPage />} />
            {/* soppressata-72251: per-partner BizDev industry report — before /:slug catch-all */}
            <Route path="/partner/bizdev" element={<PartnerBizdevPage />} />
            <Route path="/partner-dashboard" element={<Navigate to="/partner" replace />} />
            <Route path="/sponsor-dashboard" element={<Navigate to="/partner" replace />} />
            <Route path="/partner-intake/:token" element={<PartnerIntakePage />} />
            <Route path="/invoice/:viewToken" element={<InvoicePage />} />
            <Route path="/mou/:viewToken" element={<MouPage />} />
            <Route path="/sponsor-intake/:token" element={<SponsorIntakeRedirect />} />
            <Route path="/graphics" element={<Suspense fallback={null}><GraphicsDashboard /></Suspense>} />
            <Route path="/graphics/:slug/edit" element={<Suspense fallback={null}><GraphicsFlyerEdit /></Suspense>} />
            <Route path="/post" element={<PostComposerPage />} />
            <Route path="/onesheet/:slug" element={<OneSheetPage />} />
            <Route path="/raleigh" element={<Navigate to="/durham" replace />} />
            <Route path="/cmohhr0640003jp047krjarz0" element={<Navigate to="/nashville" replace />} />
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
