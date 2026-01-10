import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { RSVPPage } from './pages/RSVPPage';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rsvp/:inviteCode" element={<RSVPPage />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
