import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface CheckInQRDisplayProps {
  inviteCode: string;
  guestId: string;
  guestName: string;
  onClose: () => void;
}

export function CheckInQRDisplay({ inviteCode, guestId, guestName, onClose }: CheckInQRDisplayProps) {
  const qrData = `checkin:${inviteCode}:${guestId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrData)}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl max-w-sm mx-4 p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-theme-text-secondary hover:text-theme-text transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <h3 className="text-lg font-semibold text-theme-text text-center mb-4 pr-6">
          {guestName}
        </h3>

        {/* QR Code with white background */}
        <div className="flex justify-center mb-4">
          <div className="bg-white p-4 rounded-xl">
            <img
              src={qrUrl}
              alt="Check-in QR Code"
              width={250}
              height={250}
              className="block"
            />
          </div>
        </div>

        {/* Helper text */}
        <p className="text-sm text-theme-text-secondary text-center">
          Show this to a checked-in guest
        </p>
      </div>
    </div>,
    document.body
  );
}
