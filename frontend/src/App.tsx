import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './contexts/AuthContext';
import { HomePage } from './pages/HomePage';
import { RSVPPage } from './pages/RSVPPage';
import { HostPage } from './pages/HostPage';
import { PartiesListPage } from './pages/PartiesListPage';
import { EventPage } from './pages/EventPage';
import { AuthVerifyPage } from './pages/AuthVerifyPage';
import { LoginPage } from './pages/LoginPage';
import { NewEventPage } from './pages/NewEventPage';
import { AccountPage } from './pages/AccountPage';
import { GPPLandingPage } from './pages/GPPLandingPage';
import { CheckInPage } from './pages/CheckInPage';
import { DJPage } from './pages/DJPage';
import { PublicReportPage } from './pages/PublicReportPage';
import { DisplayPage } from './pages/DisplayPage';
import { UnderbossDashboard } from './pages/UnderbossDashboard';
import { AdminPage } from './pages/AdminPage';

function App() {
  return (
    <HelmetProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/new" element={<NewEventPage />} />
            <Route path="/gpp" element={<GPPLandingPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/auth/verify" element={<AuthVerifyPage />} />
            <Route path="/parties" element={<PartiesListPage />} />
            <Route path="/report/:slug" element={<PublicReportPage />} />
            <Route path="/rsvp/:inviteCode" element={<RSVPPage />} />
            <Route path="/host/:inviteCode" element={<HostPage />} />
            <Route path="/host/:inviteCode/:tab" element={<HostPage />} />
            <Route path="/checkin/:inviteCode/:guestId" element={<CheckInPage />} />
            <Route path="/dj/:inviteCode" element={<DJPage />} />
            <Route path="/display/:partyId/:slug" element={<DisplayPage />} />
            <Route path="/underboss" element={<UnderbossDashboard />} />
            <Route path="/underboss/:region" element={<UnderbossDashboard />} />
            <Route path="/admin" element={<AdminPage />} />
            {/* Catch-all route for custom URLs - must be last */}
            <Route path="/:slug" element={<EventPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </HelmetProvider>
  );
}

export default App;
