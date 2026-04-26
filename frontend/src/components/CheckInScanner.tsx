import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { vouchForGuest } from '../lib/api';

interface CheckInScannerProps {
  inviteCode: string;
  onClose: () => void;
}

type ScanMessage = {
  text: string;
  type: 'success' | 'info' | 'error';
};

export function CheckInScanner({ inviteCode, onClose }: CheckInScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [message, setMessage] = useState<ScanMessage | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingRef = useRef(false);
  const scannerDivId = 'checkin-qr-scanner';

  const showMessage = useCallback((msg: ScanMessage, durationMs = 2000) => {
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
    }
    setMessage(msg);
    messageTimerRef.current = setTimeout(() => {
      setMessage(null);
      messageTimerRef.current = null;
    }, durationMs);
  }, []);

  const handleScan = useCallback(async (decodedText: string) => {
    // Prevent concurrent processing
    if (processingRef.current) return;

    // Parse QR data: checkin:{inviteCode}:{guestId}
    const parts = decodedText.split(':');
    if (parts.length !== 3 || parts[0] !== 'checkin') {
      showMessage({ text: 'Invalid QR code', type: 'error' }, 1500);
      return;
    }

    const [, qrInviteCode, targetGuestId] = parts;
    if (!qrInviteCode || !targetGuestId) {
      showMessage({ text: 'Invalid QR code', type: 'error' }, 1500);
      return;
    }

    processingRef.current = true;
    try {
      const result = await vouchForGuest(qrInviteCode, targetGuestId);

      if (result.alreadyCheckedIn) {
        showMessage({ text: `${result.guest.name} is already checked in`, type: 'info' }, 2000);
      } else {
        showMessage({ text: `${result.guest.name} checked in!`, type: 'success' }, 2000);
      }
    } catch (err: any) {
      showMessage({ text: err?.message || 'Check-in failed', type: 'error' }, 2000);
    } finally {
      // Small delay before allowing next scan
      setTimeout(() => {
        processingRef.current = false;
      }, 1500);
    }
  }, [inviteCode, showMessage]);

  useEffect(() => {
    let html5Qrcode: Html5Qrcode | null = null;
    let mounted = true;

    const startScanner = async () => {
      try {
        html5Qrcode = new Html5Qrcode(scannerDivId);
        scannerRef.current = html5Qrcode;

        await html5Qrcode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText) => {
            handleScan(decodedText);
          },
          () => {
            // QR scan error (no QR found in frame) - ignore
          }
        );
      } catch (err: any) {
        if (!mounted) return;
        if (err?.toString?.().includes('NotAllowedError') || err?.toString?.().includes('Permission')) {
          setCameraError('Camera access needed to scan QR codes. Please enable camera permissions in your browser settings.');
        } else {
          setCameraError(err?.message || 'Could not start camera');
        }
      }
    };

    startScanner();

    return () => {
      mounted = false;
      if (messageTimerRef.current) {
        clearTimeout(messageTimerRef.current);
      }
      if (html5Qrcode) {
        html5Qrcode.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [handleScan]);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-full transition-colors"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      {/* Scanner area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        {cameraError ? (
          <div className="text-center max-w-sm">
            <Camera className="w-12 h-12 text-white/50 mx-auto mb-4" />
            <p className="text-white/80 text-base">{cameraError}</p>
          </div>
        ) : (
          <>
            <p className="text-white/70 text-sm mb-4">Point camera at a guest's QR code</p>
            <div
              id={scannerDivId}
              className="w-full max-w-sm rounded-xl overflow-hidden"
            />
          </>
        )}

        {/* Scan result message */}
        {message && (
          <div
            className={`mt-4 px-6 py-3 rounded-xl text-center font-medium text-base ${
              message.type === 'success'
                ? 'bg-green-600/90 text-white'
                : message.type === 'info'
                  ? 'bg-blue-600/90 text-white'
                  : 'bg-red-600/90 text-white'
            }`}
          >
            {message.text}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
