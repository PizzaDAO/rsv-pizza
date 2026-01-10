import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { RSVPPage } from './pages/RSVPPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rsvp/:inviteCode" element={<RSVPPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
