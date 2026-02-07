import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Lock } from 'lucide-react';
import { getDisplayForViewer, getDisplayPhotos } from '../lib/api';
import { DisplayViewerData, SlideshowConfig, QRCodeConfig, PhotosConfig, EventInfoConfig, Photo } from '../types';
import { IconInput } from '../components/IconInput';

export function DisplayPage() {
  const { partyId, slug } = useParams<{ partyId: string; slug: string }>();
  const [data, setData] = useState<DisplayViewerData | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const loadDisplay = useCallback(async (pw?: string) => {
    if (!partyId || !slug) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getDisplayForViewer(partyId, slug, pw);
      if (result) {
        setData(result);
        setNeedsPassword(false);
        if (result.photos) setPhotos(result.photos);
      } else {
        setNeedsPassword(true);
      }
    } catch (err) {
      setError('Failed to load display');
    } finally {
      setLoading(false);
    }
  }, [partyId, slug]);

  useEffect(() => {
    loadDisplay();
  }, [loadDisplay]);

  // Clock update
  useEffect(() => {
    if (!data?.display.showClock) return;
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, [data?.display.showClock]);

  // Photo auto-refresh
  useEffect(() => {
    if (!data || data.display.contentType !== 'photos') return;
    const config = data.display.contentConfig as PhotosConfig;
    const refreshMs = (config.autoRefresh || 30) * 1000;
    const interval = setInterval(async () => {
      if (!partyId || !slug) return;
      const result = await getDisplayPhotos(partyId, slug);
      if (result) setPhotos(result.photos);
    }, refreshMs);
    return () => clearInterval(interval);
  }, [data, partyId, slug]);

  // Slideshow / photo rotation
  useEffect(() => {
    if (!data) return;
    const { contentType, rotationInterval } = data.display;
    if (contentType !== 'photos' || !photos.length) return;
    const config = data.display.contentConfig as PhotosConfig;
    if (config.layout !== 'slideshow') return;
    const interval = setInterval(() => {
      setCurrentSlideIndex((i) => (i + 1) % photos.length);
    }, rotationInterval * 1000);
    return () => clearInterval(interval);
  }, [data, photos.length]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadDisplay(password);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white/50" />
      </div>
    );
  }

  if (needsPassword) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <form onSubmit={handlePasswordSubmit} className="w-full max-w-sm space-y-4">
          <div className="text-center mb-6">
            <Lock className="w-12 h-12 text-white/30 mx-auto mb-3" />
            <p className="text-white/50">This display is password protected</p>
          </div>
          <IconInput
            icon={Lock}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoFocus
          />
          <button type="submit" className="w-full btn-primary">
            View Display
          </button>
        </form>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-white/50">{error || 'Display not found'}</p>
      </div>
    );
  }

  const { display, party } = data;
  const rsvpUrl = party.customUrl
    ? `https://rsv.pizza/${party.customUrl}`
    : `https://rsv.pizza/rsvp/${party.inviteCode}`;

  return (
    <>
      <Helmet>
        <title>{display.name} - {party.name}</title>
      </Helmet>
      <div
        className="min-h-screen w-full relative overflow-hidden"
        style={{ backgroundColor: display.backgroundColor }}
      >
        {/* Clock overlay */}
        {display.showClock && (
          <div className="absolute top-4 right-4 z-10 text-white/80 text-2xl font-mono">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        {/* Event name overlay */}
        {display.showEventName && (
          <div className="absolute top-4 left-4 z-10 text-white/80 text-xl font-semibold">
            {party.name}
          </div>
        )}

        {/* Content */}
        <div className="w-full h-screen flex items-center justify-center">
          {display.contentType === 'qr_code' && <QRCodeDisplay config={display.contentConfig as QRCodeConfig} rsvpUrl={rsvpUrl} party={party} />}
          {display.contentType === 'event_info' && <EventInfoDisplay config={display.contentConfig as EventInfoConfig} party={party} />}
          {display.contentType === 'slideshow' && <SlideshowDisplay config={display.contentConfig as SlideshowConfig} />}
          {display.contentType === 'photos' && <PhotosDisplay config={display.contentConfig as PhotosConfig} photos={photos} currentIndex={currentSlideIndex} />}
        </div>
      </div>
    </>
  );
}

function QRCodeDisplay({ config, rsvpUrl, party }: { config: QRCodeConfig; rsvpUrl: string; party: DisplayViewerData['party'] }) {
  const sizeMap = { small: 200, medium: 300, large: 400 };
  const size = sizeMap[config.size || 'large'];
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(rsvpUrl)}`;

  return (
    <div className="flex flex-col items-center gap-8">
      {config.message && (
        <p className="text-white text-3xl font-semibold text-center">{config.message}</p>
      )}
      <div className="bg-white p-6 rounded-2xl">
        <img src={qrSrc} alt="RSVP QR Code" width={size} height={size} />
      </div>
      {config.showEventInfo && (
        <div className="text-center text-white/70 space-y-1">
          {party.venueName && <p className="text-lg">{party.venueName}</p>}
          {party.address && <p className="text-sm">{party.address}</p>}
        </div>
      )}
    </div>
  );
}

function EventInfoDisplay({ config, party }: { config: EventInfoConfig; party: DisplayViewerData['party'] }) {
  return (
    <div className="text-center text-white space-y-8 px-8 max-w-2xl">
      <h1 className="text-5xl font-bold">{party.name}</h1>
      {config.showLocation && party.venueName && (
        <div className="space-y-1">
          <p className="text-2xl">{party.venueName}</p>
          {party.address && <p className="text-lg text-white/60">{party.address}</p>}
        </div>
      )}
      {config.showCountdown && party.date && <CountdownTimer date={party.date} />}
    </div>
  );
}

function CountdownTimer({ date }: { date: string }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const target = new Date(date);
  const diff = target.getTime() - now.getTime();

  if (diff <= 0) {
    return <p className="text-3xl text-green-400 font-semibold">Event is live!</p>;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  return (
    <div className="flex gap-6 justify-center">
      {days > 0 && <TimeUnit value={days} label="days" />}
      <TimeUnit value={hours} label="hours" />
      <TimeUnit value={minutes} label="min" />
      <TimeUnit value={seconds} label="sec" />
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-5xl font-mono font-bold text-white">{String(value).padStart(2, '0')}</div>
      <div className="text-sm text-white/50 uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

function SlideshowDisplay({ config }: { config: SlideshowConfig }) {
  if (!config.googleSlidesUrl) {
    return <p className="text-white/50 text-xl">No Google Slides URL configured</p>;
  }

  // Convert share URL to embed URL
  let embedUrl = config.googleSlidesUrl;
  if (embedUrl.includes('/pub')) {
    // Already a published URL - append embed params
    embedUrl = embedUrl.replace(/\/pub.*/, '/embed?start=true&loop=true&delayms=5000');
  } else if (embedUrl.includes('/edit') || embedUrl.includes('/d/')) {
    // Regular share URL - convert to embed
    const match = embedUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
      embedUrl = `https://docs.google.com/presentation/d/${match[1]}/embed?start=true&loop=true&delayms=5000`;
    }
  }

  return (
    <iframe
      src={embedUrl}
      className="w-full h-full border-0"
      allowFullScreen
      title="Slideshow"
    />
  );
}

function PhotosDisplay({ config, photos, currentIndex }: { config: PhotosConfig; photos: Photo[]; currentIndex: number }) {
  if (!photos.length) {
    return <p className="text-white/50 text-xl">No photos yet</p>;
  }

  if (config.layout === 'slideshow') {
    const photo = photos[currentIndex % photos.length];
    return (
      <img
        src={photo.url}
        alt={photo.caption || ''}
        className="max-w-full max-h-full object-contain"
      />
    );
  }

  // Grid layout
  const columns = config.columns || 3;
  return (
    <div
      className="w-full h-full p-4 grid gap-2 auto-rows-fr"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      {photos.slice(0, columns * 4).map((photo) => (
        <div key={photo.id} className="overflow-hidden rounded-lg">
          <img
            src={photo.thumbnailUrl || photo.url}
            alt={photo.caption || ''}
            className="w-full h-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}
