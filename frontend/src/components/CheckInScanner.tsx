import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { vouchForGuest } from '../lib/api';

interface CheckInScannerProps {
  inviteCode: string;
  onVouchSuccess: (guestName: string) => void;
  onClose: () => void;
}

export function CheckInScanner({ inviteCode, onVouchSuccess, onClose }: CheckInScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>('Starting camera...');
  const [toast, setToast] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const processingRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, durationMs = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), durationMs);
  }, []);

  // Parse QR data: "checkin:{inviteCode}:{guestId}"
  const parseQR = useCallback((data: string): { inviteCode: string; guestId: string } | null => {
    const parts = data.split(':');
    if (parts.length !== 3 || parts[0] !== 'checkin') return null;
    return { inviteCode: parts[1], guestId: parts[2] };
  }, []);

  const handleScan = useCallback(async (decodedText: string) => {
    if (processingRef.current) return;

    const parsed = parseQR(decodedText);
    if (!parsed) {
      showToast('Invalid QR code');
      return;
    }

    processingRef.current = true;
    setStatus('Verifying...');

    try {
      const result = await vouchForGuest(parsed.inviteCode, parsed.guestId);
      if (result.success) {
        if (result.alreadyCheckedIn) {
          showToast(`${result.guest?.name || 'Guest'} is already checked in`);
        } else {
          const name = result.guest?.name || 'Guest';
          showToast(`${name} checked in!`);
          onVouchSuccess(name);
        }
      } else {
        showToast(result.message || 'Check-in failed');
      }
    } catch (err: any) {
      showToast(err.message || 'Check-in failed');
    } finally {
      processingRef.current = false;
      setStatus('Scan a QR code');
    }
  }, [parseQR, showToast, onVouchSuccess]);

  useEffect(() => {
    const containerId = 'qr-scanner-container';
    let html5Qrcode: Html5Qrcode | null = null;
    let mounted = true;

    const startScanner = async () => {
      try {
        html5Qrcode = new Html5Qrcode(containerId);
        scannerRef.current = html5Qrcode;

        await html5Qrcode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText) => {
            if (mounted) handleScan(decodedText);
          },
          () => {
            // QR scan failure (no code found) - ignored, keep scanning
          }
        );

        if (mounted) setStatus('Scan a QR code');
      } catch (err: any) {
        if (mounted) {
          const msg = err?.message || String(err);
          if (msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('denied')) {
            setCameraError('Camera access needed to scan QR codes. Please allow camera permissions and try again.');
          } else {
            setCameraError(`Could not start camera: ${msg}`);
          }
        }
      }
    };

    startScanner();

    return () => {
      mounted = false;
      if (html5Qrcode) {
        html5Qrcode.stop().catch(() => {});
        html5Qrcode.clear();
      }
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [handleScan]);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50">
        <h3 className="text-white font-semibold text-lg">Scan QR Code</h3>
        <button
          onClick={onClose}
          className="text-white/70 hover:text-white transition-colors p-1"
        >
          <X size={28} />
        </button>
      </div>

      {/* Camera / Error area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        {cameraError ? (
          <div className="text-center max-w-sm">
            <p className="text-white text-lg mb-2">Camera Unavailable</p>
            <p className="text-white/60 text-sm">{cameraError}</p>
          </div>
        ) : (
          <>
            <div
              id="qr-scanner-container"
              ref={containerRef}
              className="w-full max-w-sm rounded-xl overflow-hidden"
            />
            <p className="text-white/60 text-sm mt-4">{status}</p>
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-white/95 text-black px-6 py-3 rounded-xl shadow-lg text-sm font-medium max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>,
    document.body
  );
}
