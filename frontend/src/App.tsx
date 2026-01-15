import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
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
      console.log('Restoring path from 404 redirect:', redirectPath);
      sessionStorage.removeItem('redirectPath');
      // Extract the path relative to /rsv-pizza/
      // For /rsv-pizza/b4fae265, we want /b4fae265
      // For /rsv-pizza/rsvp/b4fae265, we want /rsvp/b4fae265
      let path = redirectPath;
      if (path.startsWith('/rsv-pizza/')) {
        path = path.substring('/rsv-pizza'.length); // Keep the leading slash after /rsv-pizza
      } else if (path === '/rsv-pizza') {
        path = '/';
      }
      console.log('Navigating to:', path);
      navigate(path, { replace: true });
    }
  }, [navigate]);

  return null;
}

function App() {
  return (
    <HelmetProvider>
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
    </HelmetProvider>
  );
}

export default App;
