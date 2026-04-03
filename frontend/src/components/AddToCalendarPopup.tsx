import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PublicEvent } from '../lib/api';
import {
  buildCalendarEvent,
  generateGoogleCalendarUrl,
  generateOutlookUrl,
  generateICSFile,
  downloadICSFile,
} from '../utils/calendarUtils';

interface AddToCalendarPopupProps {
  isOpen: boolean;
  onClose: () => void;
  event: PublicEvent;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function AddToCalendarPopup({ isOpen, onClose, event, anchorRef }: AddToCalendarPopupProps) {
  const desktopRef = useRef<HTMLDivElement>(null);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Close on click outside (desktop only; mobile uses backdrop click)
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        desktopRef.current && !desktopRef.current.contains(target) &&
        anchorRef.current && !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    };
    // Use setTimeout to avoid the click that opened the popup from immediately closing it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  const calendarEvent = buildCalendarEvent(event);
  if (!calendarEvent) return null;

  const handleGoogleCalendar = () => {
    window.open(generateGoogleCalendarUrl(calendarEvent), '_blank', 'noopener');
    onClose();
  };

  const handleAppleCalendar = () => {
    const ics = generateICSFile(calendarEvent);
    const filename = `${event.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.ics`;
    downloadICSFile(ics, filename);
    onClose();
  };

  const handleOutlook = () => {
    window.open(generateOutlookUrl(calendarEvent), '_blank', 'noopener');
    onClose();
  };

  // Desktop: position relative to anchor
  const desktopPopup = (
    <div
      ref={desktopRef}
      className="hidden md:block absolute left-0 top-full mt-2 z-50 w-64 bg-theme-header border border-theme-stroke rounded-xl shadow-xl overflow-hidden animate-fade-in"
    >
      <div className="p-1">
        <button
          onClick={handleGoogleCalendar}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10 transition-colors text-left"
        >
          <GoogleCalendarIcon />
          <span className="text-sm font-medium text-theme-text">Google Calendar</span>
        </button>
        <button
          onClick={handleAppleCalendar}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10 transition-colors text-left"
        >
          <AppleCalendarIcon />
          <span className="text-sm font-medium text-theme-text">Apple Calendar</span>
        </button>
        <button
          onClick={handleOutlook}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10 transition-colors text-left"
        >
          <OutlookIcon />
          <span className="text-sm font-medium text-theme-text">Outlook</span>
        </button>
      </div>
    </div>
  );

  // Mobile: bottom sheet via portal
  const mobilePopup = createPortal(
    <div className="md:hidden fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="absolute bottom-0 left-0 right-0 bg-theme-header border-t border-theme-stroke rounded-t-2xl shadow-xl p-4 pb-8 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
        <p className="text-xs text-theme-text-secondary uppercase tracking-wider font-semibold mb-3 px-1">Add to Calendar</p>
        <div className="space-y-1">
          <button
            onClick={handleGoogleCalendar}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/10 transition-colors text-left"
          >
            <GoogleCalendarIcon />
            <span className="text-base font-medium text-theme-text">Google Calendar</span>
          </button>
          <button
            onClick={handleAppleCalendar}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/10 transition-colors text-left"
          >
            <AppleCalendarIcon />
            <span className="text-base font-medium text-theme-text">Apple Calendar</span>
          </button>
          <button
            onClick={handleOutlook}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/10 transition-colors text-left"
          >
            <OutlookIcon />
            <span className="text-base font-medium text-theme-text">Outlook</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      {desktopPopup}
      {mobilePopup}
    </>
  );
}

// --- Calendar provider icons (inline SVGs for zero dependencies) ---

function GoogleCalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.316 5.684H5.684v12.632h12.632V5.684z" fill="#fff" />
      <path d="M18.316 24l5.684-5.684h-5.684V24z" fill="#EA4335" />
      <path d="M24 5.684h-5.684v12.632H24V5.684z" fill="#FBBC04" />
      <path d="M18.316 18.316H5.684V24l12.632-0V18.316z" fill="#34A853" />
      <path d="M0 18.316v2.842A2.842 2.842 0 002.842 24h2.842V18.316H0z" fill="#188038" />
      <path d="M24 5.684V2.842A2.842 2.842 0 0021.158 0H18.316v5.684H24z" fill="#EA4335" />
      <path d="M18.316 0H2.842A2.842 2.842 0 000 2.842v15.474h5.684V5.684h12.632V0z" fill="#4285F4" />
      <path
        d="M8.477 16.29a2.882 2.882 0 01-1.18-.934l.945-.774c.218.324.476.566.774.726.298.16.627.24.988.24.375 0 .7-.096.974-.288a.923.923 0 00.411-.788.888.888 0 00-.435-.792c-.29-.186-.659-.279-1.107-.279h-.685v-1.135h.616c.388 0 .708-.082.96-.247a.823.823 0 00.379-.73.78.78 0 00-.337-.671c-.225-.16-.515-.24-.87-.24-.34 0-.63.072-.87.216a1.84 1.84 0 00-.596.596l-.903-.774c.224-.345.537-.626.94-.843a2.87 2.87 0 011.403-.332c.42 0 .796.068 1.128.205.332.137.593.332.783.585.19.253.285.546.285.879 0 .358-.1.658-.3.9-.2.242-.456.418-.768.528v.055c.374.118.67.308.886.57.216.262.324.585.324.97 0 .374-.1.705-.3.993a2.001 2.001 0 01-.844.683c-.362.164-.783.246-1.263.246a3.25 3.25 0 01-1.33-.266z"
        fill="#EA4335"
      />
      <path
        d="M14.298 9.07l-1.038.756-.576-.878 1.887-1.36h.794v8.7h-1.067V9.07z"
        fill="#4285F4"
      />
    </svg>
  );
}

function AppleCalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="3" width="22" height="19" rx="3" fill="#fff" />
      <rect x="1" y="3" width="22" height="6" rx="3" fill="#FF3B30" />
      <rect x="1" y="7" width="22" height="2" fill="#FF3B30" />
      <line x1="6" y1="1" x2="6" y2="5" stroke="#555" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="18" y1="1" x2="18" y2="5" stroke="#555" strokeWidth="1.5" strokeLinecap="round" />
      <text x="12" y="18.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#333" fontFamily="system-ui, sans-serif">
        {new Date().getDate()}
      </text>
    </svg>
  );
}

function OutlookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 7.387v10.478a1.2 1.2 0 01-1.2 1.2H9.6v-12.87H22.8a1.2 1.2 0 011.2 1.192z" fill="#1490DF" />
      <path d="M24 7.387L16.2 12.6 9.6 7.387V6.195h.6L16.2 11.1l6.6-4.905h.6c.331 0 .6.269.6.6v.592z" fill="#33AFEC" />
      <path d="M9.6 6.195h13.2a.6.6 0 01.6.6v.592L16.2 12.6 9.6 7.387V6.195z" fill="#28A8EA" />
      <path d="M8.4 4.395H1.2A1.2 1.2 0 000 5.595v13.2a1.2 1.2 0 001.2 1.2h7.2a1.2 1.2 0 001.2-1.2v-13.2a1.2 1.2 0 00-1.2-1.2z" fill="#0078D4" />
      <path
        d="M4.8 9.195c-1.82 0-2.9 1.396-2.9 3.1 0 1.704 1.08 3.1 2.9 3.1s2.9-1.396 2.9-3.1c0-1.704-1.08-3.1-2.9-3.1zm0 5c-.994 0-1.6-.856-1.6-1.9s.606-1.9 1.6-1.9 1.6.856 1.6 1.9-.606 1.9-1.6 1.9z"
        fill="#fff"
      />
    </svg>
  );
}
