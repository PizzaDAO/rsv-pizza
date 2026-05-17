import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, Radio, EyeOff, User, Briefcase, MapPin, AtSign } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { IconInput } from '../components/IconInput';
import { useAuth } from '../contexts/AuthContext';
import { fetchUnderbossMe } from '../lib/api';
import { supabase } from '../lib/supabase';

const CHANNEL_NAME = 'stream-overlay-bpd-2026';

interface SpeakerForm {
  name: string;
  role: string;
  city: string;
  xHandle: string;
}

export function StreamControl() {
  const { user, loading: authLoading } = useAuth();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [form, setForm] = useState<SpeakerForm>({ name: '', role: '', city: '', xHandle: '' });
  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerForm | null>(null);
  const [lastAction, setLastAction] = useState<{ kind: 'push' | 'clear'; at: Date } | null>(null);
  const [busy, setBusy] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [channelReady, setChannelReady] = useState(false);

  // Auth-gate: underboss / admin / graphics admin only.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAuthorized(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchUnderbossMe();
        if (cancelled) return;
        const ok = !!(me.isAdmin || me.isUnderboss || me.isGraphicsAdmin);
        setAuthorized(ok);
        if (!ok) setAuthError('You are not authorized to use the stream control panel.');
      } catch (err: any) {
        if (cancelled) return;
        setAuthorized(false);
        setAuthError(err?.message || 'Failed to verify access');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  // Subscribe to the same broadcast channel so we can confirm what's currently showing.
  useEffect(() => {
    if (authorized !== true) return;
    const channel = supabase.channel(CHANNEL_NAME);
    channel
      .on('broadcast', { event: 'speaker.set' }, (msg: any) => {
        const p = msg?.payload || {};
        setCurrentSpeaker({
          name: p.name || '',
          role: p.role || '',
          city: p.city || '',
          xHandle: p.xHandle || '',
        });
      })
      .on('broadcast', { event: 'speaker.clear' }, () => {
        setCurrentSpeaker(null);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setChannelReady(true);
      });
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setChannelReady(false);
    };
  }, [authorized]);

  async function pushSpeaker() {
    if (!channelRef.current || !channelReady) return;
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'speaker.set',
        payload: {
          name: form.name.trim(),
          role: form.role.trim(),
          city: form.city.trim(),
          xHandle: form.xHandle.trim().replace(/^@/, ''),
        },
      });
      setCurrentSpeaker({ ...form });
      setLastAction({ kind: 'push', at: new Date() });
    } finally {
      setBusy(false);
    }
  }

  async function clearSpeaker() {
    if (!channelRef.current || !channelReady) return;
    setBusy(true);
    try {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'speaker.clear',
        payload: {},
      });
      setCurrentSpeaker(null);
      setLastAction({ kind: 'clear', at: new Date() });
    } finally {
      setBusy(false);
    }
  }

  // Not logged in
  if (!authLoading && !user) {
    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a] text-white">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center">
            <Shield size={48} className="mx-auto mb-4 text-red-500/60" />
            <h1 className="text-2xl font-bold mb-2">Stream Control</h1>
            <p className="text-white/60 mb-6">Sign in with your underboss email to access the producer panel.</p>
            <button
              onClick={() => setShowLoginModal(true)}
              className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-xl font-medium transition-colors"
            >
              Sign in
            </button>
          </div>
        </main>
        <Footer />
        <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </div>
    );
  }

  if (authLoading || authorized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (authorized === false) {
    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a] text-white">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center">
            <Shield size={48} className="mx-auto mb-4 text-red-500/60" />
            <h1 className="text-2xl font-bold mb-2">Not authorized</h1>
            <p className="text-white/60">{authError || 'You do not have access to the stream control panel.'}</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a] text-white">
      <Helmet>
        <title>Stream Control — Bitcoin Pizza Day</title>
      </Helmet>
      <Header />
      <main className="flex-1 px-4 py-10">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <Radio className="text-red-500" />
            <h1 className="text-3xl font-extrabold">Stream Control</h1>
          </div>
          <p className="text-white/50 mb-8">
            Push lower-third updates to the OBS overlay (<code className="text-white/70">/stream/overlay</code>).
            Channel: <code className="text-white/70">{CHANNEL_NAME}</code>
            <span className="ml-2 text-xs">
              {channelReady ? <span className="text-green-400">● live</span> : <span className="text-yellow-400">connecting…</span>}
            </span>
          </p>

          <div className="space-y-3 mb-6">
            <IconInput
              icon={User}
              placeholder="Speaker name (e.g. Pia Mancini)"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            <IconInput
              icon={Briefcase}
              placeholder="Role (e.g. Host of Buenos Aires Party)"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            <IconInput
              icon={MapPin}
              placeholder="City"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            <IconInput
              icon={AtSign}
              placeholder="X handle (optional, without @)"
              value={form.xHandle}
              onChange={(e) => setForm((f) => ({ ...f, xHandle: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
          </div>

          <div className="flex flex-wrap gap-3 mb-8">
            <button
              onClick={pushSpeaker}
              disabled={busy || !channelReady || !form.name.trim()}
              className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 disabled:bg-white/10 disabled:text-white/40 text-white px-5 py-3 rounded-xl font-semibold transition-colors"
            >
              <Radio size={18} />
              Push speaker to overlay
            </button>
            <button
              onClick={clearSpeaker}
              disabled={busy || !channelReady}
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:text-white/30 text-white px-5 py-3 rounded-xl font-semibold transition-colors"
            >
              <EyeOff size={18} />
              Hide lower-third
            </button>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="text-xs uppercase tracking-widest text-white/40 mb-2">Currently showing</div>
            {currentSpeaker ? (
              <div>
                <div className="text-xl font-bold">{currentSpeaker.name}</div>
                <div className="text-white/70">
                  {currentSpeaker.role}
                  {currentSpeaker.role && currentSpeaker.city ? ' — ' : ''}
                  {currentSpeaker.city}
                </div>
                {currentSpeaker.xHandle && (
                  <div className="text-white/50 text-sm">@{currentSpeaker.xHandle.replace(/^@/, '')}</div>
                )}
              </div>
            ) : (
              <div className="text-white/40 italic">Lower-third hidden</div>
            )}
            {lastAction && (
              <div className="mt-3 text-xs text-white/40">
                Last action: {lastAction.kind === 'push' ? 'pushed speaker' : 'cleared'} at {lastAction.at.toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default StreamControl;
