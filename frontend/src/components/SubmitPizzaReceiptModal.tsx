import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, FileText, Loader2, Mail, Ruler, Store, Upload, X, CheckCircle2 } from 'lucide-react';
import { IconInput } from './IconInput';
import { LocationAutocomplete, type CityData } from './LocationAutocomplete';
import { createPizzaSubmission, requestPizzaSubmissionUpload } from '../lib/api';
import { supabase } from '../lib/supabase';

/**
 * sfincione-40417 (submissions): anyone can send a pizza receipt to the Pizza Price Index.
 * No login. The file goes straight to a private bucket via a signed upload token (it never
 * passes through our API), then the details are posted. A reviewer checks it before it counts.
 */

const BUCKET = 'pizza-index-submissions';
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf',
};
const ALLOWED = new Set(Object.values(MIME_BY_EXT));

function mimeOf(file: File): string | null {
  if (ALLOWED.has(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? null;
}

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function SubmitPizzaReceiptModal({ isOpen, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [locationText, setLocationText] = useState('');
  const [place, setPlace] = useState<{ city: string; country: string; countryCode: string } | null>(null);
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState('');
  const [sizeNote, setSizeNote] = useState('');
  const [email, setEmail] = useState('');
  const [trap, setTrap] = useState(''); // honeypot: real users never see or fill this
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/') || file.type === 'image/heic') { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!isOpen) return null;

  const reset = () => {
    setFile(null); setLocationText(''); setPlace(null); setMerchant(''); setDate(''); setSizeNote('');
    setEmail(''); setTrap(''); setBusy(false); setError(null); setDone(false);
  };
  const close = () => { reset(); onClose(); };

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!mimeOf(f)) { setError('Please choose a JPEG, PNG, WebP, HEIC or PDF.'); return; }
    if (f.size > MAX_BYTES) { setError('That file is too big (10 MB max).'); return; }
    setFile(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const mime = file ? mimeOf(file) : null;
    if (!file || !mime) { setError('Add a photo or PDF of the receipt.'); return; }
    if (!place?.country) { setError('Pick the pizzeria\'s city from the list so we know the country.'); return; }
    if (!merchant.trim()) { setError('Add the pizzeria name.'); return; }
    if (!date) { setError('Add the receipt date.'); return; }
    setBusy(true);
    try {
      const { path, token } = await requestPizzaSubmissionUpload(mime, file.size);
      const up = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, file, { contentType: mime });
      if (up.error) throw new Error('The upload failed. Please try again.');
      await createPizzaSubmission({
        path,
        receiptDate: date,
        merchant: merchant.trim(),
        city: place.city,
        country: place.country,
        countryCode: place.countryCode,
        sizeNote: sizeNote.trim() || undefined,
        email: email.trim() || undefined,
        website: trap,
      });
      setDone(true);
    } catch (err: any) {
      // 409 (already sent), 413, 429 and 503 messages come straight from the server in plain words.
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={close}>
      <div className="card p-6 sm:p-8 max-w-md w-full relative max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={close} aria-label="Close" className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors">
          <X size={24} />
        </button>

        {done ? (
          <div className="text-center space-y-3 py-4">
            <CheckCircle2 size={40} className="mx-auto text-emerald-400" />
            <h2 className="text-2xl font-bold text-theme-text">Thanks, we'll review it</h2>
            <p className="text-sm text-theme-text-muted">
              Once a reviewer has checked your receipt it can count towards the index.{email.trim() ? " We'll email you when it's reviewed." : ''}
            </p>
            <button type="button" onClick={close} className="btn-primary w-full">Done</button>
          </div>
        ) : (
          <>
            <div className="mb-5 pr-8">
              <h2 className="text-2xl font-bold text-theme-text mb-1">Submit a pizza receipt</h2>
              <p className="text-sm text-theme-text-muted">Help us map what pizza really costs. A reviewer checks every receipt first.</p>
            </div>

            <form onSubmit={submit} className="space-y-3">
              {/* Honeypot: hidden from people and screen readers, bots fill it. */}
              <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
                <IconInput name="website" tabIndex={-1} autoComplete="off" placeholder="Website" value={trap} onChange={(e) => setTrap(e.target.value)} />
              </div>

              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp,image/heic,.heic,application/pdf"
                onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-xl border border-dashed border-theme-stroke hover:bg-white/5 p-4 flex flex-col items-center gap-2 text-sm text-theme-text-muted"
              >
                {preview ? (
                  <img src={preview} alt="Receipt preview" className="max-h-40 rounded-lg object-contain" />
                ) : file ? (
                  <FileText size={28} />
                ) : (
                  <Upload size={28} />
                )}
                <span className="truncate max-w-full">{file ? file.name : 'Add a photo or PDF of the receipt'}</span>
              </button>

              <LocationAutocomplete
                value={locationText}
                onChange={(v) => { setLocationText(v); setPlace(null); }}
                types={['(cities)']}
                placeholder="City where you bought the pizza"
                onCitySelected={(c: CityData) => setPlace({ city: c.cityName, country: c.country, countryCode: c.countryCode })}
              />
              <IconInput icon={Store} placeholder="Pizzeria name" value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={120} required />
              <IconInput icon={Calendar} type="date" placeholder="Receipt date" value={date} min="2021-01-01" max={todayLocal()} onChange={(e) => setDate(e.target.value)} required />
              <IconInput icon={Ruler} multiline rows={2} placeholder="Pizza size, e.g. 12 inch / 30 cm (optional)" value={sizeNote} onChange={(e) => setSizeNote(e.target.value)} maxLength={200} />
              <IconInput icon={Mail} type="email" placeholder="Email (optional) — we'll tell you when it's reviewed" value={email} onChange={(e) => setEmail(e.target.value)} />
              <p className="text-xs text-white/40">Receipts are only seen by our reviewers. Cover card numbers if you like.</p>

              {error && (
                <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">{error}</div>
              )}

              <button type="submit" disabled={busy} className="w-full btn-primary flex items-center justify-center gap-2">
                {busy ? <><Loader2 size={18} className="animate-spin" />Sending...</> : 'Send receipt'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
