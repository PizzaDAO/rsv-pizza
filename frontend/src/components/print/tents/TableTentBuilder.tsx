import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Type, Link as LinkIcon, Hash, Table, Wifi, KeyRound, Eye, EyeOff } from 'lucide-react';
import { usePizza } from '../../../contexts/PizzaContext';
import { BRAND } from '../../../config/brand';
import { getSponsors } from '../../../lib/api';
import { IconInput } from '../../IconInput';
import { Checkbox } from '../../Checkbox';
import { SegmentedButtons } from '../SegmentedButtons';
import { PrintPortal, PrintPreview, usePrintSheets } from '../printSheet';
import { defaultPaper, type PaperSize } from '../layouts';
import { BODY_MAX, HEADLINE_MAX, isHttpUrl, presetContent, tentQrUrl, type TentContent, type TentPreset, type TentQrTarget } from './tentPresets';
import { MAX_TENT_SPONSORS, TableTentPage, TableTentSheet, type TentFaceData } from './TableTentSheet';
import { wifiQrString, type WifiSecurity } from './wifiQr';

interface TentSponsor {
  id: string;
  name: string;
  logoUrl: string;
}

function formatDateLine(date: string | null | undefined, tz: string | null | undefined, lang: string): string | null {
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeStyle: 'short', timeZone: tz || undefined }).format(new Date(date));
  } catch {
    return null;
  }
}

export function TableTentBuilder({ canViewSponsors = false }: { canViewSponsors?: boolean }) {
  const { t, i18n } = useTranslation('host');
  const { party } = usePizza();
  const [paper, setPaper] = useState<PaperSize>(() => defaultPaper(typeof navigator !== 'undefined' ? navigator.language : undefined));
  const [preset, setPreset] = useState<TentPreset>('rsvp');
  const [content, setContent] = useState<TentContent | null>(null);
  const [copies, setCopies] = useState('1');
  const [useLogo, setUseLogo] = useState(false);
  // Wifi credentials live only in component state: never saved, logged or put in a URL.
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiSecurity, setWifiSecurity] = useState<WifiSecurity>('WPA');
  const [showPassword, setShowPassword] = useState(false);
  const [differentBack, setDifferentBack] = useState(false);
  const [backHeadline, setBackHeadline] = useState('');
  const [backBody, setBackBody] = useState('');
  const [showSponsors, setShowSponsors] = useState(false);
  const [sponsors, setSponsors] = useState<TentSponsor[] | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const { printing, print } = usePrintSheets();
  const partyId = party?.id;

  // Sponsor logos need Partners access; the API 403s otherwise, so don't even ask.
  useEffect(() => {
    if (!canViewSponsors || !partyId) return;
    let cancelled = false;
    getSponsors(partyId)
      .then((r) => {
        if (cancelled) return;
        setSponsors(
          (r?.sponsors ?? [])
            .filter((s) => s.logoUrl && (s.status === 'yes' || s.status === 'paid'))
            .map((s) => ({ id: s.id, name: s.name, logoUrl: s.logoUrl as string })),
        );
      })
      .catch(() => {
        if (!cancelled) setSponsors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canViewSponsors, partyId]);

  const strings = useMemo(
    () => ({ rsvpHeadline: t('print.tents.rsvpHeadline'), rsvpBody: t('print.tents.rsvpBody'), wifiHeadline: t('print.tents.wifiHeadline') }),
    [t],
  );
  const c: TentContent = content ?? presetContent('rsvp', party ?? {}, strings);

  const data = useMemo<TentFaceData>(() => {
    const wifiPayload = c.qr === 'wifi' ? wifiQrString({ ssid: wifiSsid, password: wifiPassword, security: wifiSecurity }) : null;
    const qrUrl = c.qr === 'wifi' ? wifiPayload : party ? tentQrUrl(c.qr, party, c.customUrl) : null;
    const logos = canViewSponsors && showSponsors ? (sponsors ?? []).filter((sp) => !skipped.has(sp.id)).map((sp) => sp.logoUrl) : [];
    return {
      eventName: c.showEventName ? party?.name ?? null : null,
      headline: c.headline,
      body: c.body,
      dateLine: c.showDate ? formatDateLine(party?.date, party?.timezone, i18n.language) : null,
      qrUrl,
      qrSensitive: c.qr === 'wifi',
      qrCaptionText: wifiPayload ? t('print.tents.wifiCaption', { ssid: wifiSsid.trim() }) : null,
      logoUrl: useLogo ? BRAND.logoUrl : null,
      sponsorLogos: logos.slice(0, MAX_TENT_SPONSORS),
    };
  }, [c, party, useLogo, i18n.language, wifiSsid, wifiPassword, wifiSecurity, canViewSponsors, showSponsors, sponsors, skipped, t]);

  // Back panel (the upside-down half): same layout, its own headline and text.
  const backData = useMemo<TentFaceData | undefined>(
    () => (differentBack ? { ...data, headline: backHeadline, body: backBody } : undefined),
    [differentBack, data, backHeadline, backBody],
  );

  if (!party) return null;

  const choosePreset = (p: TentPreset) => {
    setPreset(p);
    setContent(presetContent(p, party, strings));
  };
  const patch = (p: Partial<TentContent>) => setContent({ ...c, ...p });
  const customInvalid = c.qr === 'custom' && !!c.customUrl && !isHttpUrl(c.customUrl);
  const n = Math.max(1, Math.min(20, Math.floor(Number(copies)) || 1));

  return (
    <section id="tents" className="card p-4 space-y-4" data-testid="tent-builder">
      <div>
        <h3 className="text-lg font-semibold text-theme-text flex items-center gap-2">
          <Table size={18} /> {t('print.tents.title')}
        </h3>
        <p className="text-xs text-white/40 mt-1">{t('print.tents.help')}</p>
      </div>

      <SegmentedButtons
        ariaLabel={t('print.tents.preset')}
        options={[
          { value: 'rsvp' as const, label: t('print.tents.presetRsvp') },
          { value: 'wifi' as const, label: t('print.tents.presetWifi') },
          { value: 'custom' as const, label: t('print.tents.presetCustom') },
        ]}
        value={preset}
        onChange={choosePreset}
      />
      <SegmentedButtons
        ariaLabel={t('print.tents.paper')}
        options={[
          { value: 'letter' as const, label: t('print.sheet.paperLetter') },
          { value: 'a4' as const, label: t('print.sheet.paperA4') },
        ]}
        value={paper}
        onChange={setPaper}
      />

      <IconInput icon={Type} value={c.headline} maxLength={HEADLINE_MAX} onChange={(e) => patch({ headline: e.target.value })} placeholder={t('print.tents.headlinePlaceholder')} />
      <IconInput icon={Type} multiline rows={3} value={c.body} maxLength={BODY_MAX} onChange={(e) => patch({ body: e.target.value })} placeholder={t('print.tents.bodyPlaceholder')} />

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox checked={c.showEventName} onChange={() => patch({ showEventName: !c.showEventName })} label={t('print.tents.showEventName')} />
        <Checkbox checked={c.showDate} onChange={() => patch({ showDate: !c.showDate })} label={t('print.tents.showDate')} />
        <Checkbox checked={useLogo} onChange={() => setUseLogo((v) => !v)} label={t('print.tents.showLogo')} />
      </div>

      <SegmentedButtons
        ariaLabel={t('print.tents.qr')}
        options={[
          { value: 'none' as TentQrTarget, label: t('print.tents.qrNone') },
          { value: 'event' as TentQrTarget, label: t('print.tents.qrEvent') },
          { value: 'booth' as TentQrTarget, label: t('print.tents.qrBooth') },
          { value: 'wifi' as TentQrTarget, label: t('print.tents.qrWifi') },
          { value: 'custom' as TentQrTarget, label: t('print.tents.qrCustom') },
        ]}
        value={c.qr}
        onChange={(qr) => patch({ qr })}
      />
      {c.qr === 'custom' && (
        <div>
          <IconInput icon={LinkIcon} value={c.customUrl} onChange={(e) => patch({ customUrl: e.target.value })} placeholder={t('print.tents.customUrlPlaceholder')} />
          {customInvalid && <p className="text-xs text-red-400 mt-1">{t('print.tents.customUrlInvalid')}</p>}
        </div>
      )}

      {c.qr === 'wifi' && (
        <div className="space-y-2">
          <IconInput icon={Wifi} value={wifiSsid} onChange={(e) => setWifiSsid(e.target.value)} placeholder={t('print.tents.wifiSsidPlaceholder')} autoComplete="off" />
          {wifiSecurity !== 'nopass' && (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <IconInput
                  icon={KeyRound}
                  type={showPassword ? 'text' : 'password'}
                  value={wifiPassword}
                  onChange={(e) => setWifiPassword(e.target.value)}
                  placeholder={t('print.tents.wifiPasswordPlaceholder')}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('print.tents.wifiHidePassword') : t('print.tents.wifiShowPassword')}
                aria-pressed={showPassword}
                className="p-2 rounded-lg bg-theme-surface text-theme-text-muted hover:text-theme-text"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          )}
          {wifiSecurity !== 'nopass' && !wifiPassword && <p className="text-xs text-amber-400">{t('print.tents.wifiPasswordHint')}</p>}
          <SegmentedButtons
            ariaLabel={t('print.tents.wifiSecurity')}
            options={[
              { value: 'WPA' as WifiSecurity, label: t('print.tents.wifiWpa') },
              { value: 'WEP' as WifiSecurity, label: t('print.tents.wifiWep') },
              { value: 'nopass' as WifiSecurity, label: t('print.tents.wifiNone') },
            ]}
            value={wifiSecurity}
            onChange={setWifiSecurity}
          />
          <p className="text-xs text-white/40">{t('print.tents.wifiNote')}</p>
        </div>
      )}

      {canViewSponsors && (
        <div className="space-y-2" data-testid="tent-sponsors">
          <Checkbox checked={showSponsors} onChange={() => setShowSponsors((v) => !v)} label={t('print.tents.sponsorsShow')} />
          {showSponsors && sponsors !== null && sponsors.length === 0 && <p className="text-xs text-white/40">{t('print.tents.sponsorsNone')}</p>}
          {showSponsors && sponsors && sponsors.length > 0 && (
            <div className="space-y-1">
              {sponsors.map((sp) => (
                <Checkbox
                  key={sp.id}
                  checked={!skipped.has(sp.id)}
                  onChange={() =>
                    setSkipped((prev) => {
                      const next = new Set(prev);
                      if (next.has(sp.id)) next.delete(sp.id);
                      else next.add(sp.id);
                      return next;
                    })
                  }
                  label={sp.name}
                />
              ))}
              {sponsors.length - skipped.size > MAX_TENT_SPONSORS && <p className="text-xs text-white/40">{t('print.tents.sponsorsMax', { max: MAX_TENT_SPONSORS })}</p>}
            </div>
          )}
        </div>
      )}

      <Checkbox checked={differentBack} onChange={() => setDifferentBack((v) => !v)} label={t('print.tents.differentBack')} />
      {differentBack && (
        <div className="space-y-2" data-testid="tent-back">
          <IconInput icon={Type} value={backHeadline} maxLength={HEADLINE_MAX} onChange={(e) => setBackHeadline(e.target.value)} placeholder={t('print.tents.backHeadlinePlaceholder')} />
          <IconInput icon={Type} multiline rows={3} value={backBody} maxLength={BODY_MAX} onChange={(e) => setBackBody(e.target.value)} placeholder={t('print.tents.backBodyPlaceholder')} />
        </div>
      )}

      <IconInput icon={Hash} type="number" min={1} max={20} value={copies} onChange={(e) => setCopies(e.target.value)} placeholder={t('print.tents.copiesPlaceholder')} />

      <PrintPreview paper={paper} pageCount={1} renderPage={() => <TableTentPage paper={paper} data={data} backData={backData} />} />

      <button
        type="button"
        onClick={() => print(paper)}
        disabled={!!printing}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ff393a] text-white font-medium disabled:opacity-40"
      >
        <Printer size={16} /> {t('print.sheet.print')}
      </button>
      <p className="text-xs text-white/40">{t('print.sheet.instructions')}</p>

      {printing && (
        <PrintPortal paper={printing}>
          <TableTentSheet paper={printing} data={data} backData={backData} copies={n} />
        </PrintPortal>
      )}
    </section>
  );
}
