import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const CHANNEL_NAME = 'stream-overlay-bpd-2026';
const COUNTER_POLL_MS = 8000;
const PHOTO_ROTATE_MS = 8000;

interface Speaker {
  name?: string;
  role?: string;
  city?: string;
  xHandle?: string;
}

interface Counters {
  cities: number;
  donationsUsd: number | null;
  photoUrls: string[];
}

async function fetchCounters(): Promise<Counters> {
  const { count: cityCount } = await supabase
    .from('parties')
    .select('id', { count: 'exact', head: true })
    .eq('underboss_status', 'approved');

  // Donations: sum succeeded donations across approved parties. Approved party ids
  // first, then sum donations for those parties.
  let donationsUsd: number | null = null;
  try {
    const { data: approvedIds } = await supabase
      .from('parties')
      .select('id')
      .eq('underboss_status', 'approved');
    const ids = (approvedIds || []).map((r: any) => r.id);
    if (ids.length > 0) {
      const { data: donRows } = await supabase
        .from('donations')
        .select('amount, status, party_id')
        .in('party_id', ids)
        .eq('status', 'succeeded');
      if (donRows) {
        donationsUsd = donRows.reduce((s: number, d: any) => s + Number(d.amount || 0), 0);
      } else {
        donationsUsd = 0;
      }
    } else {
      donationsUsd = 0;
    }
  } catch {
    donationsUsd = null;
  }

  let photoUrls: string[] = [];
  try {
    const { data: photoRows } = await supabase
      .from('photos')
      .select('url, party_id, parties!inner(underboss_status)')
      .eq('status', 'approved')
      .eq('parties.underboss_status', 'approved')
      .order('created_at', { ascending: false })
      .limit(60);
    if (photoRows) {
      photoUrls = photoRows.map((r: any) => r.url).filter(Boolean);
    }
  } catch {
    photoUrls = [];
  }

  return {
    cities: cityCount ?? 0,
    donationsUsd,
    photoUrls,
  };
}

export function StreamOverlay() {
  const [counters, setCounters] = useState<Counters>({ cities: 0, donationsUsd: null, photoUrls: [] });
  const [speaker, setSpeaker] = useState<Speaker | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const photoUrlsRef = useRef<string[]>([]);

  // Force a transparent body so OBS Browser Source captures only the overlay layer.
  useEffect(() => {
    const prevBg = document.body.style.background;
    const prevHtmlBg = document.documentElement.style.background;
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    const style = document.createElement('style');
    style.setAttribute('data-stream-overlay', 'true');
    style.textContent = `
      html, body, #root { background: transparent !important; }
      body { margin: 0; padding: 0; }
    `;
    document.head.appendChild(style);
    return () => {
      document.body.style.background = prevBg;
      document.documentElement.style.background = prevHtmlBg;
      const el = document.querySelector('style[data-stream-overlay]');
      if (el) el.remove();
    };
  }, []);

  // Counters polling
  useEffect(() => {
    let mounted = true;
    async function tick() {
      try {
        const c = await fetchCounters();
        if (mounted) {
          setCounters(c);
          photoUrlsRef.current = c.photoUrls;
        }
      } catch {
        // ignore — keep last values
      }
    }
    tick();
    const t = setInterval(tick, COUNTER_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  // Photo rotation
  useEffect(() => {
    const t = setInterval(() => {
      setPhotoIdx((i) => {
        const urls = photoUrlsRef.current;
        if (urls.length === 0) return 0;
        return (i + 1) % urls.length;
      });
    }, PHOTO_ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  // Realtime: lower-third speaker
  useEffect(() => {
    const channel = supabase.channel(CHANNEL_NAME);
    channel
      .on('broadcast', { event: 'speaker.set' }, (msg: any) => {
        const p = msg?.payload || {};
        setSpeaker({
          name: p.name,
          role: p.role,
          city: p.city,
          xHandle: p.xHandle,
        });
      })
      .on('broadcast', { event: 'speaker.clear' }, () => {
        setSpeaker(null);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const currentPhoto = counters.photoUrls[photoIdx] || null;

  const formatUsd = (cents: number) => {
    const dollars = cents / 100;
    if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
    if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}k`;
    return `$${Math.round(dollars).toLocaleString()}`;
  };

  return (
    <div className="fixed inset-0 w-screen h-screen text-white pointer-events-none overflow-hidden" style={{ background: 'transparent' }}>
      {/* Top-left branding lockup */}
      <div className="fixed top-6 left-6">
        <div className="backdrop-blur-md bg-black/40 rounded-2xl border border-white/10 px-5 py-3 flex items-center gap-3">
          <div className="text-3xl leading-none">🍕</div>
          <div className="leading-tight">
            <div className="text-xs uppercase tracking-widest text-white/60">PizzaDAO presents</div>
            <div className="text-lg font-extrabold">Bitcoin Pizza Day 2026</div>
          </div>
        </div>
      </div>

      {/* Top-right counters */}
      <div className="fixed top-6 right-6">
        <div className="backdrop-blur-md bg-black/40 rounded-2xl border border-white/10 px-6 py-4 flex flex-col items-end gap-3 min-w-[260px]">
          <div className="flex flex-col items-end">
            <div className="text-5xl font-extrabold tabular-nums">{counters.cities.toLocaleString()}</div>
            <div className="text-xs uppercase tracking-widest text-white/60">cities celebrating</div>
          </div>
          {counters.donationsUsd !== null && counters.donationsUsd > 0 && (
            <div className="flex flex-col items-end">
              <div className="text-3xl font-extrabold tabular-nums">{formatUsd(counters.donationsUsd)}</div>
              <div className="text-xs uppercase tracking-widest text-white/60">raised for charity</div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom-right rotating photo */}
      {currentPhoto && (
        <div className="fixed bottom-6 right-6">
          <div className="backdrop-blur-md bg-black/40 rounded-2xl border border-white/10 p-2 overflow-hidden">
            <img
              key={currentPhoto}
              src={currentPhoto}
              alt=""
              className="block w-[320px] h-[240px] object-cover rounded-xl transition-opacity duration-700"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        </div>
      )}

      {/* Bottom lower-third */}
      <div
        className={`fixed left-6 transition-all duration-500 ease-out ${
          speaker ? 'bottom-10 opacity-100 translate-y-0' : '-bottom-40 opacity-0 translate-y-10'
        }`}
        style={{ maxWidth: '60vw' }}
      >
        <div className="backdrop-blur-md bg-black/55 rounded-2xl border border-white/10 px-8 py-5">
          {speaker?.name && (
            <div className="text-5xl font-extrabold leading-tight">{speaker.name}</div>
          )}
          {(speaker?.role || speaker?.city) && (
            <div className="text-xl text-white/80 mt-1">
              {speaker?.role || ''}
              {speaker?.role && speaker?.city ? ' — ' : ''}
              {speaker?.city || ''}
            </div>
          )}
          {speaker?.xHandle && (
            <div className="text-lg text-white/60 mt-1">@{speaker.xHandle.replace(/^@/, '')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StreamOverlay;
