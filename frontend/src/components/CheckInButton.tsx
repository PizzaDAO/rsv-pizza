import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { hostSelfCheckIn } from '../lib/api';
import { CheckInQRDisplay } from './CheckInQRDisplay';
import { CheckInScanner } from './CheckInScanner';

interface CheckInButtonProps {
  inviteCode: string;
  guestId: string;
  checkedInAt: string | null;
  isHost: boolean;
  guestName: string;
  onCheckIn: (checkedInAt: string) => void;
}

export function CheckInButton({
  inviteCode,
  guestId,
  checkedInAt,
  isHost,
  guestName,
  onCheckIn,
}: CheckInButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [localCheckedInAt, setLocalCheckedInAt] = useState<string | null>(checkedInAt);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync prop changes
  useEffect(() => {
    setLocalCheckedInAt(checkedInAt);
  }, [checkedInAt]);

  // Poll for check-in status while QR is shown (guest waiting to be vouched)
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
    pollRef.current = setInterval(async () => {
      try {
        const token = localStorage.getItem('authToken');
        if (!token) return;
        const resp = await fetch(`${apiUrl}/api/checkin/${inviteCode}/${guestId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.isCheckedIn && data.guest?.checkedInAt) {
            setLocalCheckedInAt(data.guest.checkedInAt);
            onCheckIn(data.guest.checkedInAt);
            setShowQR(false);
          }
        }
      } catch {
        // Silently continue polling
      }
    }, 10000);
  }, [inviteCode, guestId, onCheckIn]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Stop polling when QR modal closes
  useEffect(() => {
    if (!showQR) stopPolling();
  }, [showQR, stopPolling]);

  const isCheckedIn = !!localCheckedInAt;

  // State A: Host self-check-in
  const handleHostCheckIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await hostSelfCheckIn(inviteCode);
      if (result.success && result.guest?.checkedInAt) {
        setLocalCheckedInAt(result.guest.checkedInAt);
        onCheckIn(result.guest.checkedInAt);
      }
    } catch (err: any) {
      setError(err.message || 'Check-in failed');
    } finally {
      setLoading(false);
    }
  };

  // State B: Guest shows QR
  const handleGuestShowQR = () => {
    setShowQR(true);
    startPolling();
  };

  // State C: Checked-in user opens scanner
  const handleOpenScanner = () => {
    setShowScanner(true);
  };

  const handleVouchSuccess = (_guestName: string) => {
    // Scanner stays open for next scan; toast handled inside scanner
  };

  if (isCheckedIn) {
    // State C: Already checked in
    return (
      <>
        <button
          onClick={handleOpenScanner}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm
            bg-green-600 hover:bg-green-700 text-white transition-colors"
        >
          Checked In
        </button>
        {showScanner && (
          <CheckInScanner
            inviteCode={inviteCode}
            onVouchSuccess={handleVouchSuccess}
            onClose={() => setShowScanner(false)}
          />
        )}
      </>
    );
  }

  // State A or B: Not checked in
  return (
    <>
      <button
        onClick={isHost ? handleHostCheckIn : handleGuestShowQR}
        disabled={loading}
        className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm
          bg-[#ff393a] hover:bg-[#e02e2f] text-white transition-colors disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Checking in...
          </>
        ) : (
          'Check In'
        )}
      </button>
      {error && (
        <p className="text-xs text-red-400 mt-1">{error}</p>
      )}
      {showQR && (
        <CheckInQRDisplay
          inviteCode={inviteCode}
          guestId={guestId}
          guestName={guestName}
          onClose={() => setShowQR(false)}
        />
      )}
    </>
  );
}
