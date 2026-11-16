import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCodeLib from 'qrcode';
import { Camera, Download, ExternalLink, Loader2, Maximize2, Printer, RotateCcw, X } from 'lucide-react';
import { Checkbox } from '../Checkbox';
import { QRCode } from '../QRCode';
import { BoothCredit } from './BoothCredit';
import { BRAND } from '../../config/brand';
import { getBooth, saveBooth, type BoothSetup } from '../../lib/api';
import { loadBooth } from '../../lib/booth/loadBooth';
import { buildBoothConfig, diffFromDefault, type BoothEventInfo } from '../../lib/booth/buildBoothConfig';
import type { EditorElement } from '../../lib/booth/questpass-booth';

interface BoothTabProps {
  party: BoothEventInfo & { id: string };
}

const PRINT_CSS = `
.booth-print-card { display: none; }
@media print {
  body.booth-printing * { visibility: hidden; }
  body.booth-printing .booth-print-card,
  body.booth-printing .booth-print-card * { visibility: visible; }
  body.booth-printing .booth-print-card { display: block; position: absolute; left: 0; top: 0; width: 100%; text-align: center; color: #000; background: #fff; padding: 48px 24px; }
}`;

/** Host dashboard tab: on/off, QR code and link, and the booth editor. */
export function BoothTab({ party }: BoothTabProps) {
  const [setup, setSetup] = useState<BoothSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const editorRef = useRef<EditorElement | null>(null);
  const latestRef = useRef<Record<string, any> | null>(null);

  const origin = window.location.origin;
  const whiteLabel = BRAND.isBranded ? { name: BRAND.name, logo: BRAND.logoUrl } : null;
  const slug = party.customUrl || party.inviteCode;
  const boothUrl = `${origin}/${slug}/booth`;
  const shortLink = `${origin.replace(/^https?:\/\//, '')}/${slug}/booth`;

  useEffect(() => {
    let cancelled = false;
    getBooth(party.id)
      .then((s) => { if (!cancelled) setSetup(s); })
      .catch((e: Error) => { if (!cancelled) setError(e.message || 'Could not load the photo booth setup.'); });
    return () => { cancelled = true; };
  }, [party.id]);

  useEffect(() => {
    let cancelled = false;
    loadBooth()
      .then(() => { if (!cancelled) setLoaded(true); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  // What the booth looks like with no host changes, and with the saved ones.
  const defaults = useMemo(() => buildBoothConfig({ hostConfig: null, event: party, origin, whiteLabel }),
    [party.name, party.city, party.address, party.date, party.timezone, party.customUrl, party.inviteCode, origin]);
  const effective = useMemo(() => buildBoothConfig({ hostConfig: setup?.config ?? null, event: party, origin, whiteLabel }),
    [setup?.config, party.name, party.city, party.address, party.date, party.timezone, party.customUrl, party.inviteCode, origin]);

  // Give the editor the effective config (so the host sees the party's details) and track edits.
  const ready = loaded && !!setup;
  useEffect(() => {
    const el = editorRef.current;
    if (!ready || !el) return;
    el.config = effective;
    latestRef.current = null;
    setDirty(false);
    const onChange = (e: Event) => {
      const cfg = (e as CustomEvent<{ config: Record<string, any> }>).detail?.config;
      if (!cfg) return;
      latestRef.current = cfg; // fires on every edit: remember it, never save here
      setDirty(JSON.stringify(cfg) !== JSON.stringify(effective));
      setSaved(false);
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, [ready, effective, editorKey]);

  const toggle = useCallback(async () => {
    if (!setup) return;
    setToggling(true);
    setError(null);
    try {
      setSetup(await saveBooth(party.id, { enabled: !setup.hostEnabled }));
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setToggling(false);
    }
  }, [party.id, setup]);

  const save = useCallback(async () => {
    if (!latestRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const changes = diffFromDefault(latestRef.current, defaults);
      setSetup(await saveBooth(party.id, { config: Object.keys(changes).length ? changes : null }));
      setSaved(true);
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }, [party.id, defaults]);

  const reset = useCallback(async () => {
    if (!window.confirm('Reset the photo booth to the PizzaDAO default? Your changes will be lost.')) return;
    setSaving(true);
    setError(null);
    try {
      setSetup(await saveBooth(party.id, { config: null }));
      setSaved(false);
      setEditorKey((k) => k + 1);
    } catch (e: any) {
      setError(e?.message || 'Could not reset.');
    } finally {
      setSaving(false);
    }
  }, [party.id]);

  const downloadQr = useCallback(async () => {
    const url = await QRCodeLib.toDataURL(boothUrl, { margin: 2, width: 1024, errorCorrectionLevel: 'M' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-photo-booth-qr.png`;
    a.click();
  }, [boothUrl, slug]);

  const print = useCallback(() => {
    document.body.classList.add('booth-printing');
    const done = () => {
      document.body.classList.remove('booth-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  }, []);

  if (!setup && !error) {
    return <div className="flex justify-center py-12" data-testid="booth-tab-loading"><Loader2 className="animate-spin text-theme-text-muted" /></div>;
  }

  return (
    <div className="space-y-6 max-w-2xl" data-testid="booth-tab">
      <style>{PRINT_CSS}</style>
      <div>
        <h2 className="text-xl font-bold text-theme-text flex items-center gap-2"><Camera size={20} /> Photo booth</h2>
        <p className="text-sm text-theme-text-secondary mt-1">
          A phone photo booth for your guests, with pizza frames and your party&apos;s name, city and date. Photos stay on the guest&apos;s phone unless they choose to add them to your party photos.
        </p>
      </div>

      {error && <p className="text-sm text-red-400" role="alert" data-testid="booth-tab-error">{error}</p>}

      {setup && (
        <>
          <div className="card p-4 space-y-3">
            <Checkbox
              checked={setup.hostEnabled}
              onChange={toggle}
              disabled={toggling}
              label="Photo booth on for this party"
              checkboxRole
            />
            {!setup.globalEnabled && (
              <p className="text-xs text-yellow-200" data-testid="booth-global-off">
                The photo booth isn&apos;t public yet. Only you can preview it for now.
              </p>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <QRCode value={boothUrl} size={160} alt="Photo booth QR code" className="rounded-lg bg-white" />
              <div className="space-y-2 min-w-0">
                <p className="text-sm text-theme-text break-all" data-testid="booth-link">{shortLink}</p>
                <div className="flex flex-wrap gap-2">
                  <a href={`/${slug}/booth`} target="_blank" rel="noopener noreferrer" className="btn-secondary px-3 py-2 text-sm inline-flex items-center gap-2">
                    <ExternalLink size={14} /> Open booth
                  </a>
                  <button type="button" onClick={downloadQr} className="btn-secondary px-3 py-2 text-sm inline-flex items-center gap-2">
                    <Download size={14} /> Download PNG
                  </button>
                  <button type="button" onClick={print} className="btn-secondary px-3 py-2 text-sm inline-flex items-center gap-2">
                    <Printer size={14} /> Print
                  </button>
                  <button type="button" onClick={() => setShowQr(true)} className="btn-secondary px-3 py-2 text-sm inline-flex items-center gap-2">
                    <Maximize2 size={14} /> Show QR full-screen
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h3 className="text-base font-semibold text-theme-text">Customize</h3>
            {loaded ? (
              <questpass-booth-editor key={editorKey} ref={editorRef} style={{ display: 'block', width: '100%' }} />
            ) : (
              !error && <div className="flex justify-center py-8"><Loader2 className="animate-spin text-theme-text-muted" /></div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="btn-primary px-4 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-50"
                data-testid="booth-save"
              >
                {saving && <Loader2 size={14} className="animate-spin" />} Save
              </button>
              {dirty && <span className="text-xs text-yellow-200" data-testid="booth-unsaved">Unsaved changes</span>}
              {saved && !dirty && <span className="text-xs text-green-400" data-testid="booth-saved">Saved</span>}
              <button
                type="button"
                onClick={reset}
                disabled={saving}
                className="ml-auto text-sm text-theme-text-secondary hover:text-theme-text inline-flex items-center gap-1 disabled:opacity-50"
                data-testid="booth-reset"
              >
                <RotateCcw size={14} /> Reset to PizzaDAO default
              </button>
            </div>
          </div>
        </>
      )}

      <BoothCredit />

      <div className="booth-print-card" id="booth-print-card" aria-hidden="true">
        <h1 style={{ fontSize: 40, fontWeight: 800, margin: 0 }}>{party.name}</h1>
        <p style={{ fontSize: 28, margin: '16px 0' }}>Scan for the photo booth 📸</p>
        <QRCode value={boothUrl} size={420} alt="Photo booth QR code" margin={2} />
        <p style={{ fontSize: 22, marginTop: 16 }}>{shortLink}</p>
      </div>

      {showQr && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setShowQr(false)}
          role="dialog"
          aria-label="Photo booth QR code"
          data-testid="booth-qr-modal"
        >
          <button type="button" className="absolute top-4 right-4 text-white/80 hover:text-white" aria-label="Close" onClick={() => setShowQr(false)}>
            <X size={28} />
          </button>
          <div className="bg-white rounded-2xl p-4 text-center" onClick={(e) => e.stopPropagation()}>
            <QRCode value={boothUrl} size={Math.min(360, Math.max(240, window.innerWidth - 80))} alt="Photo booth QR code" margin={2} />
            <p className="text-black font-semibold mt-2">{party.name}</p>
            <p className="text-black/70 text-sm break-all">{shortLink}</p>
          </div>
        </div>
      )}
    </div>
  );
}
