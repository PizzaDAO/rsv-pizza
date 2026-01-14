import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { RSVPPage } from './pages/RSVPPage';
import { HostPage } from './pages/HostPage';
import { PartiesListPage } from './pages/PartiesListPage';
import { EventPage } from './pages/EventPage';

// Component to handle 404 redirect restoration
function RedirectHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    // Check if we were redirected from a 404
    const redirectPath = sessionStorage.getItem('redirectPath');
    if (redirectPath) {
      sessionStorage.removeItem('redirectPath');
      // Extract the path relative to /rsv-pizza/
      const path = redirectPath.replace('/rsv-pizza', '') || '/';
      navigate(path, { replace: true });
    }
  }, [navigate]);

  return null;
}

function App() {
  return (
    <BrowserRouter basename="/rsv-pizza">
      <RedirectHandler />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/parties" element={<PartiesListPage />} />
        <Route path="/rsvp/:inviteCode" element={<RSVPPage />} />
        <Route path="/party/:inviteCode" element={<HostPage />} />
        {/* Catch-all route for custom URLs - must be last */}
        <Route path="/:slug" element={<EventPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
