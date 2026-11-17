import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Type, Link as LinkIcon, Hash, Table } from 'lucide-react';
import { usePizza } from '../../../contexts/PizzaContext';
import { BRAND } from '../../../config/brand';
import { IconInput } from '../../IconInput';
import { Checkbox } from '../../Checkbox';
import { SegmentedButtons } from '../SegmentedButtons';
import { PrintPortal, PrintPreview, usePrintSheets } from '../printSheet';
import { defaultPaper, type PaperSize } from '../layouts';
import { BODY_MAX, HEADLINE_MAX, isHttpUrl, presetContent, tentQrUrl, type TentContent, type TentPreset, type TentQrTarget } from './tentPresets';
import { TableTentPage, TableTentSheet, type TentFaceData } from './TableTentSheet';

function formatDateLine(date: string | null | undefined, tz: string | null | undefined, lang: string): string | null {
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeStyle: 'short', timeZone: tz || undefined }).format(new Date(date));
  } catch {
    return null;
  }
}

export function TableTentBuilder() {
  const { t, i18n } = useTranslation('host');
  const { party } = usePizza();
  const [paper, setPaper] = useState<PaperSize>(() => defaultPaper(typeof navigator !== 'undefined' ? navigator.language : undefined));
  const [preset, setPreset] = useState<TentPreset>('rsvp');
  const [content, setContent] = useState<TentContent | null>(null);
  const [copies, setCopies] = useState('1');
  const [useLogo, setUseLogo] = useState(false);
  const { printing, print } = usePrintSheets();

  const strings = useMemo(
    () => ({ rsvpHeadline: t('print.tents.rsvpHeadline'), rsvpBody: t('print.tents.rsvpBody'), wifiHeadline: t('print.tents.wifiHeadline') }),
    [t],
  );
  const c: TentContent = content ?? presetContent('rsvp', party ?? {}, strings);

  const data = useMemo<TentFaceData>(() => {
    const qrUrl = party ? tentQrUrl(c.qr, party, c.customUrl) : null;
    return {
      eventName: c.showEventName ? party?.name ?? null : null,
      headline: c.headline,
      body: c.body,
      dateLine: c.showDate ? formatDateLine(party?.date, party?.timezone, i18n.language) : null,
      qrUrl,
      logoUrl: useLogo ? BRAND.logoUrl : null,
    };
  }, [c, party, useLogo, i18n.language]);

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

      <IconInput icon={Hash} type="number" min={1} max={20} value={copies} onChange={(e) => setCopies(e.target.value)} placeholder={t('print.tents.copiesPlaceholder')} />

      <PrintPreview paper={paper} pageCount={1} renderPage={() => <TableTentPage paper={paper} data={data} />} />

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
          <TableTentSheet paper={printing} data={data} copies={n} />
        </PrintPortal>
      )}
    </section>
  );
}
