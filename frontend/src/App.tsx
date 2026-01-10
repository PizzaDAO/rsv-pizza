import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { RSVPPage } from './pages/RSVPPage';
import { HostPage } from './pages/HostPage';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rsvp/:inviteCode" element={<RSVPPage />} />
        <Route path="/party/:inviteCode" element={<HostPage />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
