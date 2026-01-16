import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { HomePage } from './pages/HomePage';
import { RSVPPage } from './pages/RSVPPage';
import { HostPage } from './pages/HostPage';
import { PartiesListPage } from './pages/PartiesListPage';
import { EventPage } from './pages/EventPage';

function App() {
  return (
    <HelmetProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/parties" element={<PartiesListPage />} />
          <Route path="/rsvp/:inviteCode" element={<RSVPPage />} />
          <Route path="/manage/:inviteCode" element={<HostPage />} />
          {/* Catch-all route for custom URLs - must be last */}
          <Route path="/:slug" element={<EventPage />} />
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
}

export default App;
