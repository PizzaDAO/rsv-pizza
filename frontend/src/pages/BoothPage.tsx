import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Camera, Eye, Loader2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { BoothCredit } from '../components/booth/BoothCredit';
import { BoothShareConsent, type ConsentStatus } from '../components/booth/BoothShareConsent';
import { useAuth } from '../contexts/AuthContext';
import { BRAND } from '../config/brand';
import { getBooth, getEventBySlug, uploadPhoto, type BoothSetup, type PublicEvent } from '../lib/api';
import { uploadEventPhoto } from '../lib/supabase';
import { loadBooth } from '../lib/booth/loadBooth';
import { buildBoothConfig } from '../lib/booth/buildBoothConfig';
import type { BoothElement, BoothPerson, BoothPhotoDetail } from '../lib/booth/questpass-booth';

const stripAt = (s: string) => s.trim().replace(/^@+/, '');

interface PendingPhoto {
  blob: Blob;
  name: string;
}

/** Public photo booth at /:slug/booth. Photos stay on the phone unless the guest taps Add. */
export function BoothPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [missing, setMissing] = useState(false);
  const [setup, setSetup] = useState<BoothSetup | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<Blob | null>(null);

  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>('asking');
  const [consentMessage, setConsentMessage] = useState<string | null>(null);

  const boothRef = useRef<BoothElement | null>(null);
  // Read by the photo listener without re-attaching it.
  const photosEnabledRef = useRef(false);
  const dontAskRef = useRef(false); // this visit only; nothing is stored

  // 1. The event, then its booth setup.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setEvent(null);
    setSetup(null);
    setMissing(false);
    getEventBySlug(slug)
      .then((r) => {
        if (cancelled) return;
        if (r && 'redirect' in r) navigate(`/${r.slug}/booth`, { replace: true });
        else if (!r) setMissing(true);
        else setEvent(r);
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [slug, navigate]);

  useEffect(() => {
    if (!event) return;
    let cancelled = false;
    getBooth(event.id)
      .then((s) => { if (!cancelled) setSetup(s); })
      // If the setup can't be read, fall back to what the event already told us.
      .catch(() => {
        if (!cancelled) setSetup({ enabled: !!event.boothEnabled, hostEnabled: true, globalEnabled: !!event.boothEnabled, config: null, updatedAt: null, canEdit: false });
      });
    return () => { cancelled = true; };
  }, [event]);

  const show = !!setup && (setup.enabled || setup.canEdit);

  // 2. Load the vendored booth only when it will be shown.
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    loadBooth()
      .then(() => { if (!cancelled) setLoaded(true); })
      .catch((e: Error) => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [show]);

  // 3. Logged-in guest's picture, fetched in the page. No credentials; skipped if it fails.
  const profilePictureUrl = user?.profilePictureUrl;
  useEffect(() => {
    setAvatar(null);
    if (!profilePictureUrl) return;
    let cancelled = false;
    fetch(profilePictureUrl, { credentials: 'omit' })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (!cancelled && b && b.type.startsWith('image/')) setAvatar(b); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [profilePictureUrl]);

  const config = useMemo(() => {
    if (!event) return null;
    return buildBoothConfig({
      hostConfig: setup?.config ?? null,
      event,
      origin: window.location.origin,
      whiteLabel: BRAND.isBranded ? { name: BRAND.name, logo: BRAND.logoUrl } : null,
    });
  }, [event, setup]);

  const person = useMemo<BoothPerson>(() => {
    if (!user) return {};
    const twitter = user.twitter ? stripAt(user.twitter) : '';
    return {
      ...(user.name ? { name: user.name } : {}),
      ...(twitter ? { handle: twitter, network: 'x' as const } : {}),
      ...(avatar ? { avatar } : {}),
    };
  }, [user, avatar]);

  const photosEnabled = !!event?.photosEnabled;
  useEffect(() => { photosEnabledRef.current = photosEnabled; }, [photosEnabled]);

  // 4. Hand the config and person to the element, and listen for finished photos.
  useEffect(() => {
    const el = boothRef.current;
    if (!loaded || !el || !config) return;
    el.config = config;
    el.person = person;
  }, [loaded, config, person]);

  useEffect(() => {
    const el = boothRef.current;
    if (!loaded || !el) return;
    const onPhoto = (e: Event) => {
      // Videos (questpass:video) are not offered in v1.
      if (!photosEnabledRef.current || dontAskRef.current) return;
      const d = (e as CustomEvent<BoothPhotoDetail>).detail;
      if (!d?.blob) return;
      setConsentStatus('asking');
      setConsentMessage(null);
      setPending({ blob: d.blob, name: d.name || 'booth.jpg' });
    };
    el.addEventListener('questpass:photo', onPhoto);
    return () => el.removeEventListener('questpass:photo', onPhoto);
  }, [loaded]);

  const addPhoto = useCallback(async () => {
    if (!pending || !event) return;
    setConsentStatus('uploading');
    setConsentMessage(null);
    try {
      const file = new File([pending.blob], pending.name, { type: pending.blob.type || 'image/jpeg' });
      const up = await uploadEventPhoto(file, event.id);
      if (!up) throw new Error('Could not upload the photo. Check its size and try again.');
      const res = await uploadPhoto(event.id, {
        url: up.url,
        fileName: up.fileName,
        fileSize: up.fileSize,
        mimeType: up.mimeType,
        width: up.width,
        height: up.height,
        uploaderName: user?.name || undefined,
        uploaderEmail: user?.email || undefined,
        tags: ['booth'],
        caption: undefined,
      });
      const approved = res?.photo?.status === 'approved';
      setConsentMessage(approved ? 'Added' : 'Added. The host will review it');
      setConsentStatus('done');
    } catch (err: any) {
      setConsentMessage(err?.message || 'Could not add the photo.');
      setConsentStatus('error');
    }
  }, [pending, event, user]);

  const dismiss = useCallback((dontAskAgain: boolean) => {
    if (dontAskAgain) dontAskRef.current = true;
    setPending(null);
    setConsentStatus('asking');
    setConsentMessage(null);
  }, []);

  const back = slug ? `/${slug}` : '/';

  if (missing) {
    return (
      <Shell>
        <Message title="Event not found" back={{ to: '/', label: 'Home' }} />
      </Shell>
    );
  }
  if (!event || !setup) {
    return (
      <Shell>
        <div className="flex justify-center py-16" data-testid="booth-loading"><Loader2 className="animate-spin text-theme-text-muted" /></div>
      </Shell>
    );
  }
  if (!show) {
    return (
      <Shell>
        <Message title="This party doesn't have a photo booth" back={{ to: back, label: `Back to ${event.name}` }} />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="max-w-md mx-auto w-full">
        <Link to={back} className="inline-flex items-center gap-1 text-sm text-theme-text-secondary hover:text-theme-text mb-3">
          <ArrowLeft size={14} /> Back to {event.name}
        </Link>
        <h1 className="text-xl font-bold text-theme-text">{event.name}</h1>
        <p className="text-sm text-theme-text-secondary mb-4 flex items-center gap-1"><Camera size={14} /> Photo booth</p>

        {!setup.enabled && (
          <div className="flex items-start gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 mb-4 text-sm text-yellow-200" data-testid="booth-preview-banner">
            <Eye size={16} className="mt-0.5 shrink-0" />
            <span>Preview: not public yet</span>
          </div>
        )}

        {loadError ? (
          <p className="text-sm text-red-400" role="alert" data-testid="booth-load-error">{loadError}</p>
        ) : loaded ? (
          <questpass-booth ref={boothRef} style={{ display: 'block', width: '100%' }} />
        ) : (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-theme-text-muted" /></div>
        )}

        <p className="text-xs text-white/40 mt-4" data-testid="booth-privacy">
          Photos stay on your phone unless you choose to add them to the party&apos;s photos.
        </p>
        <BoothCredit className="mt-2 mb-24" />
      </div>

      {pending && (
        <BoothShareConsent
          partyName={event.name}
          status={consentStatus}
          message={consentMessage}
          onAdd={addPhoto}
          onDismiss={dismiss}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <main className="flex-1 w-full px-4 py-6 sm:py-10 min-w-0" data-testid="booth-page">{children}</main>
    </Layout>
  );
}

function Message({ title, back }: { title: string; back: { to: string; label: string } }) {
  return (
    <div className="card p-6 sm:p-8 text-center max-w-md mx-auto" data-testid="booth-message">
      <Camera size={28} className="mx-auto text-theme-text-muted mb-3" />
      <p className="text-lg font-semibold text-theme-text">{title}</p>
      <Link to={back.to} className="inline-block mt-4 text-sm text-theme-accent underline">{back.label}</Link>
    </div>
  );
}
