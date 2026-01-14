import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { RSVPPage } from './pages/RSVPPage';
import { HostPage } from './pages/HostPage';
import { PartiesListPage } from './pages/PartiesListPage';
import { EventPage } from './pages/EventPage';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/parties" element={<PartiesListPage />} />
        <Route path="/rsvp/:inviteCode" element={<RSVPPage />} />
        <Route path="/party/:inviteCode" element={<HostPage />} />
        {/* Catch-all route for custom URLs - must be last */}
        <Route path="/:slug" element={<EventPage />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
