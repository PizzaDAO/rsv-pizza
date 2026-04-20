import React, { useState, useCallback } from 'react';
import { MapPin, Check, Loader2, AlertCircle } from 'lucide-react';
import { geoCheckIn, GeoCheckInResponse } from '../lib/api';

type CheckInState =
  | 'idle'
  | 'requesting' // getting GPS
  | 'checking'   // sending to server
  | 'success'
  | 'too-far'
  | 'permission-denied'
  | 'error';

interface GeoCheckInButtonProps {
  inviteCode: string;
  checkedInAt: string | null;
  onCheckIn?: (checkedInAt: string) => void;
}

export function GeoCheckInButton({ inviteCode, checkedInAt, onCheckIn }: GeoCheckInButtonProps) {
  const [state, setState] = useState<CheckInState>(checkedInAt ? 'success' : 'idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCheckIn = useCallback(async () => {
    if (state === 'success' || state === 'requesting' || state === 'checking') return;

    setState('requesting');
    setErrorMessage(null);

    try {
      // Request geolocation
      if (!navigator.geolocation) {
        setState('error');
        setErrorMessage('Geolocation is not supported by your browser');
        return;
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 60000,
        });
      });

      setState('checking');

      const response: GeoCheckInResponse = await geoCheckIn(
        inviteCode,
        position.coords.latitude,
        position.coords.longitude,
        position.coords.accuracy
      );

      if (response.success) {
        setState('success');
        if (response.checkedInAt && onCheckIn) {
          onCheckIn(response.checkedInAt);
        }
      } else {
        setState('too-far');
        setErrorMessage(response.message);
      }
    } catch (err: any) {
      if (err instanceof GeolocationPositionError || err?.code) {
        // GeolocationPositionError
        if (err.code === 1) {
          setState('permission-denied');
          setErrorMessage('Location permission denied. Please enable location access.');
        } else if (err.code === 2) {
          setState('error');
          setErrorMessage('Unable to determine your location. Please try again.');
        } else if (err.code === 3) {
          setState('error');
          setErrorMessage('Location request timed out. Please try again.');
        }
      } else {
        // API or network error
        setState('error');
        setErrorMessage(err?.message || 'Check-in failed. Please try again.');
      }
    }
  }, [inviteCode, state, onCheckIn]);

  // Determine button content and styling based on state
  const isSuccess = state === 'success';
  const isLoading = state === 'requesting' || state === 'checking';
  const isError = state === 'too-far' || state === 'permission-denied' || state === 'error';

  const buttonClasses = isSuccess
    ? 'flex-1 flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-200 bg-green-600 text-white cursor-default'
    : isError
      ? 'flex-1 flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-200 bg-theme-surface border border-red-500/50 text-red-400 hover:bg-red-500/10'
      : 'flex-1 btn-primary flex items-center justify-center gap-2';

  return (
    <div className="flex-1 flex flex-col">
      <button
        onClick={handleCheckIn}
        disabled={isSuccess || isLoading}
        className={buttonClasses}
        style={isSuccess || isError ? { padding: '12px 24px' } : undefined}
        title={errorMessage || undefined}
      >
        {isLoading && (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{state === 'requesting' ? 'Getting location...' : 'Checking in...'}</span>
          </>
        )}
        {isSuccess && (
          <>
            <Check className="w-4 h-4" />
            <span>Checked In</span>
          </>
        )}
        {state === 'idle' && (
          <>
            <MapPin className="w-4 h-4" />
            <span>Check In</span>
          </>
        )}
        {state === 'too-far' && (
          <>
            <MapPin className="w-4 h-4" />
            <span>Too Far</span>
          </>
        )}
        {state === 'permission-denied' && (
          <>
            <AlertCircle className="w-4 h-4" />
            <span>No GPS</span>
          </>
        )}
        {state === 'error' && (
          <>
            <AlertCircle className="w-4 h-4" />
            <span>Retry</span>
          </>
        )}
      </button>
      {isError && errorMessage && (
        <p className="text-xs text-red-400/80 mt-1 text-center leading-tight">{errorMessage}</p>
      )}
    </div>
  );
}
