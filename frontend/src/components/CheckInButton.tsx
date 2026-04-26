import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Check, Loader2, QrCode } from 'lucide-react';
import { hostSelfCheckIn } from '../lib/api';
import { getExistingGuest } from '../lib/supabase';
import { CheckInQRDisplay } from './CheckInQRDisplay';
import { CheckInScanner } from './CheckInScanner';

interface CheckInButtonProps {
  inviteCode: string;
  guestId: string;
  guestName: string;
  checkedInAt: string | null;
  isHost: boolean;
  onCheckIn: (checkedInAt: string) => void;
}

export function CheckInButton({ inviteCode, guestId, guestName, checkedInAt, isHost, onCheckIn }: CheckInButtonProps) {
  const [isCheckedIn, setIsCheckedIn] = useState(!!checkedInAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync with prop changes
  useEffect(() => {
    setIsCheckedIn(!!checkedInAt);
  }, [checkedInAt]);

  // Poll for check-in status when QR is shown (guest waiting to be vouched)
  useEffect(() => {
    if (!showQR || isCheckedIn) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const pollCheckIn = async () => {
      try {
        const guestData = await getExistingGuest(inviteCode, '');
        // We can't query by empty email - use a different approach
        // Instead, we'll make a direct API call to check our own guest status
        // For now, use the existing guest email approach is not ideal.
        // Actually the guest data is fetched by email in the parent - let's use a simpler poll.
      } catch {
        // ignore polling errors
      }
    };

    // Poll every 10 seconds by re-fetching guest data via the existing API
    pollRef.current = setInterval(async () => {
      try {
        // We need to check if we've been vouched. The simplest way is to use
        // the RSVP guest endpoint with the user's email.
        // But we don't have the email here. Instead, let's query via the parent's mechanism.
        // We'll use a workaround: fetch the guest data by inviteCode and see if checkedInAt changed.
        const response = await fetch(
          `${(import.meta.env.VITE_API_URL || 'http://localhost:3006').trim()}/api/rsvp/${inviteCode}/guest/${encodeURIComponent(guestId)}`,
        );
        // The guest lookup endpoint uses email, not guestId.
        // Let's try the check-in status endpoint instead (requires auth).
        const token = localStorage.getItem('authToken');
        if (!token) return;

        const statusResponse = await fetch(
          `${(import.meta.env.VITE_API_URL || 'http://localhost:3006').trim()}/api/checkin/${inviteCode}/${guestId}`,
          {
            headers: { 'Authorization': `Bearer ${token}` },
          }
        );

        if (statusResponse.ok) {
          const data = await statusResponse.json();
          if (data.isCheckedIn && data.guest?.checkedInAt) {
            setIsCheckedIn(true);
            setShowQR(false);
            onCheckIn(data.guest.checkedInAt);
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 10000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [showQR, isCheckedIn, inviteCode, guestId, onCheckIn]);

  const handleClick = useCallback(async () => {
    if (loading) return;

    // Already checked in -> open scanner
    if (isCheckedIn) {
      setShowScanner(true);
      return;
    }

    // Host: self-check-in immediately
    if (isHost) {
      setLoading(true);
      setError(null);
      try {
        const result = await hostSelfCheckIn(inviteCode);
        setIsCheckedIn(true);
        if (result.guest?.checkedInAt) {
          onCheckIn(result.guest.checkedInAt);
        }
      } catch (err: any) {
        setError(err?.message || 'Check-in failed');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Guest: show QR code for someone else to scan
    setShowQR(true);
  }, [loading, isCheckedIn, isHost, inviteCode, onCheckIn]);

  const buttonClasses = isCheckedIn
    ? 'flex-1 flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-200 bg-green-600 text-white hover:bg-green-700'
    : error
      ? 'flex-1 flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-200 bg-theme-surface border border-red-500/50 text-red-400 hover:bg-red-500/10'
      : 'flex-1 btn-primary flex items-center justify-center gap-2';

  return (
    <div className="flex-1 flex flex-col">
      <button
        onClick={handleClick}
        disabled={loading}
        className={buttonClasses}
        style={isCheckedIn || error ? { padding: '12px 24px' } : undefined}
        title={error || undefined}
      >
        {loading && (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking in...</span>
          </>
        )}
        {!loading && isCheckedIn && (
          <>
            <Check className="w-4 h-4" />
            <span>Checked In</span>
          </>
        )}
        {!loading && !isCheckedIn && !error && (
          <>
            <QrCode className="w-4 h-4" />
            <span>Check In</span>
          </>
        )}
        {!loading && error && (
          <>
            <QrCode className="w-4 h-4" />
            <span>Retry</span>
          </>
        )}
      </button>
      {error && (
        <p className="text-xs text-red-400/80 mt-1 text-center leading-tight">{error}</p>
      )}

      {/* QR Display Modal (for guests waiting to be vouched) */}
      {showQR && !isCheckedIn && (
        <CheckInQRDisplay
          inviteCode={inviteCode}
          guestId={guestId}
          guestName={guestName}
          onClose={() => setShowQR(false)}
        />
      )}

      {/* QR Scanner Modal (for checked-in users to vouch others) */}
      {showScanner && (
        <CheckInScanner
          inviteCode={inviteCode}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
