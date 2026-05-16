import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { HomePage } from './pages/HomePage';
import { RSVPPage } from './pages/RSVPPage';
import { HostPage } from './pages/HostPage';
import { EventPage } from './pages/EventPage';
import { AuthVerifyPage } from './pages/AuthVerifyPage';
import { LoginPage } from './pages/LoginPage';
import { NewEventPage } from './pages/NewEventPage';
import { AccountPage } from './pages/AccountPage';
import { GPPLandingPage } from './pages/GPPLandingPage';
import { CheckInPage } from './pages/CheckInPage';
import { DJPage } from './pages/DJPage';
import { PublicReportPage } from './pages/PublicReportPage';
import { PublicVenueReportPage } from './pages/PublicVenueReportPage';
import { DisplayPage } from './pages/DisplayPage';
import { UnderbossDashboard } from './pages/UnderbossDashboard';
import { ShippingDashboard } from './pages/ShippingDashboard';
import { AdminPage } from './pages/AdminPage';
import { PartnerIntakePage } from './pages/PartnerIntakePage';
import { PartnerDashboardPage } from './pages/PartnerDashboardPage';
import { PostComposerPage } from './pages/PostComposerPage';
import { OneSheetPage } from './pages/OneSheetPage';
import { GPPPizzeriasPage } from './pages/GPPPizzeriasPage';
import { EventsMapPage } from './pages/EventsMapPage';
import { PartnersPage } from './pages/PartnersPage';

// Legacy redirect: /sponsor-intake/:token → /partner-intake/:token
// <Navigate> doesn't forward path params, so we wrap useParams().
function SponsorIntakeRedirect() {
  const { token } = useParams<{ token: string }>();
  return <Navigate to={`/partner-intake/${token}`} replace />;
}

const GraphicsDashboard = React.lazy(() => import('./pages/GraphicsDashboard').then(m => ({ default: m.GraphicsDashboard })));
const GraphicsFlyerEdit = React.lazy(() => import('./pages/GraphicsFlyerEdit').then(m => ({ default: m.GraphicsFlyerEdit })));

function App() {
  return (
    <HelmetProvider>
      <AuthProvider>
        <ThemeProvider theme="dark">
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/new" element={<NewEventPage />} />
            <Route path="/gpp" element={<GPPLandingPage />} />
            <Route path="/gpp/pizzerias" element={<GPPPizzeriasPage />} />
            {/* /map must come before /:slug */}
            <Route path="/map" element={<EventsMapPage />} />
            {/* /partners must come before /:slug */}
            <Route path="/partners" element={<PartnersPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/auth/verify" element={<AuthVerifyPage />} />
            <Route path="/report/:slug" element={<PublicReportPage />} />
            <Route path="/venue-report/:slug" element={<PublicVenueReportPage />} />
            <Route path="/rsvp/:inviteCode" element={<RSVPPage />} />
            <Route path="/host/:inviteCode" element={<HostPage />} />
            <Route path="/host/:inviteCode/:tab" element={<HostPage />} />
            <Route path="/checkin/:inviteCode/:guestId" element={<CheckInPage />} />
            <Route path="/dj/:inviteCode" element={<DJPage />} />
            <Route path="/display/:partyId/:slug" element={<DisplayPage />} />
            <Route path="/underboss" element={<UnderbossDashboard />} />
            <Route path="/underboss/:region" element={<UnderbossDashboard />} />
            <Route path="/shipping" element={<ShippingDashboard />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/partner" element={<PartnerDashboardPage />} />
            <Route path="/partner-dashboard" element={<Navigate to="/partner" replace />} />
            <Route path="/sponsor-dashboard" element={<Navigate to="/partner" replace />} />
            <Route path="/partner-intake/:token" element={<PartnerIntakePage />} />
            <Route path="/sponsor-intake/:token" element={<SponsorIntakeRedirect />} />
            <Route path="/graphics" element={<Suspense fallback={null}><GraphicsDashboard /></Suspense>} />
            <Route path="/graphics/:slug/edit" element={<Suspense fallback={null}><GraphicsFlyerEdit /></Suspense>} />
            <Route path="/post" element={<PostComposerPage />} />
            <Route path="/onesheet/:slug" element={<OneSheetPage />} />
            <Route path="/raleigh" element={<Navigate to="/durham" replace />} />
            <Route path="/cmohhr0640003jp047krjarz0" element={<Navigate to="/nashville" replace />} />
            {/* Catch-all route for custom URLs - must be last */}
            <Route path="/:slug" element={<EventPage />} />
          </Routes>
        </BrowserRouter>
        </ThemeProvider>
      </AuthProvider>
    </HelmetProvider>
  );
}

export default App;
