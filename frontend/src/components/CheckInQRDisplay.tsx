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
  const qrData = `https://rsv.pizza/checkin/${inviteCode}/${guestId}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrData)}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl p-6 max-w-sm w-full relative text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
        >
          <X size={24} />
        </button>

        <h3 className="text-xl font-bold text-theme-text mb-1">Check In</h3>
        <p className="text-theme-text-secondary text-sm mb-4">{guestName}</p>

        <div className="bg-white rounded-xl p-4 inline-block mb-4">
          <img
            src={qrSrc}
            alt="Check-in QR code"
            width={250}
            height={250}
            className="block"
          />
        </div>

        <p className="text-theme-text-muted text-xs">
          Show this to a checked-in guest to verify your attendance
        </p>
      </div>
    </div>,
    document.body
  );
}
