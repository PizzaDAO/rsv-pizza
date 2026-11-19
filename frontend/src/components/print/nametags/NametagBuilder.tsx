import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Type, Hash, Image as ImageIcon, Tag, Search, Link as LinkIcon } from 'lucide-react';
import { usePizza } from '../../../contexts/PizzaContext';
import { BRAND } from '../../../config/brand';
import type { Guest } from '../../../types';
import { IconInput } from '../../IconInput';
import { Checkbox } from '../../Checkbox';
import { SegmentedButtons } from '../SegmentedButtons';
import { PrintPortal, PrintPreview, usePrintSheets } from '../printSheet';
import { BADGE_LAYOUTS, fillSheetBlanks, getBadgeLayout, pageCount, paginate } from '../layouts';
import { isHttpUrl, tentQrUrl } from '../tents/tentPresets';
import { blankBadges, buildBadges, typedBadges, type GuestSource } from './nametagData';
import { AlignmentTestPage, NametagPage, NametagSheet } from './NametagSheet';

type LogoChoice = 'event' | 'brand' | 'none';
type SourceChoice = GuestSource;
type BadgeQr = 'none' | 'event' | 'custom';

const NO_GUESTS: Guest[] = [];

/**
 * Privacy gate: the guest list is only read from the PizzaContext when the viewer has Guests
 * access. Without it the body below never touches `usePizza().guests`.
 */
function WithGuests({ children }: { children: (guests: Guest[]) => ReactNode }) {
  const { guests } = usePizza();
  return <>{children(guests)}</>;
}

export function NametagBuilder({ canViewGuests }: { canViewGuests: boolean }) {
  if (!canViewGuests) return <NametagBuilderBody canViewGuests={false} guests={NO_GUESTS} />;
  return <WithGuests>{(guests) => <NametagBuilderBody canViewGuests guests={guests} />}</WithGuests>;
}

function NametagBuilderBody({ canViewGuests, guests }: { canViewGuests: boolean; guests: Guest[] }) {
  const { t, i18n } = useTranslation('host');
  const { party } = usePizza();
  const [source, setSource] = useState<SourceChoice>('going');
  const [includeWaitlist, setIncludeWaitlist] = useState(false);
  const [roleLine, setRoleLine] = useState(false);
  const [typed, setTyped] = useState('');
  const [blankCount, setBlankCount] = useState('0');
  const [fillSheet, setFillSheet] = useState(false);
  const [layoutId, setLayoutId] = useState(BADGE_LAYOUTS[0].id);
  const [logo, setLogo] = useState<LogoChoice>('brand');
  const [headerText, setHeaderText] = useState('');
  const [cutOverride, setCutOverride] = useState<boolean | null>(null);
  const [pronouns, setPronouns] = useState<Record<string, string>>({});
  const [splitNames, setSplitNames] = useState(false);
  const [qr, setQr] = useState<BadgeQr>('none');
  const [customUrl, setCustomUrl] = useState('');
  // Guest picker: everyone starts ticked; we track the unticked ones. In memory only.
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [job, setJob] = useState<'sheet' | 'align'>('sheet');
  const { printing, print } = usePrintSheets();

  const layout = getBadgeLayout(layoutId);
  const effectiveSource: SourceChoice = canViewGuests ? source : 'none';

  const candidates = useMemo(
    () =>
      buildBadges(canViewGuests ? guests : NO_GUESTS, party?.coHosts ?? [], {
        source: effectiveSource,
        includeWaitlist,
        roleLine,
        roleLabels: { host: t('print.nametags.roleHost'), coHost: t('print.nametags.roleCoHost'), partner: t('print.nametags.rolePartner') },
        hostName: party?.hostName,
        locale: i18n.language,
      }),
    [canViewGuests, guests, party?.coHosts, party?.hostName, effectiveSource, includeWaitlist, roleLine, i18n.language, t],
  );

  const badges = useMemo(() => {
    const fromGuests = effectiveSource === 'pick' ? candidates.filter((b) => !unchecked.has(b.key)) : candidates;
    const named = [...fromGuests, ...typedBadges(typed)];
    const extra = blankBadges(Number(blankCount));
    const withBlanks = [...named, ...extra];
    const fill = fillSheet ? fillSheetBlanks(withBlanks.length, layout) : 0;
    const fillBadges = Array.from({ length: fill }, (_, i) => ({ key: `f-${i}`, name: '', blank: true }));
    return [...withBlanks, ...fillBadges];
  }, [candidates, effectiveSource, unchecked, typed, blankCount, fillSheet, layout]);

  const visibleCandidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? candidates.filter((b) => b.name.toLowerCase().includes(q)) : candidates;
  }, [candidates, query]);

  if (!party) return null;

  const eventImage = party.eventImageUrl || null;
  const logoUrl = logo === 'event' ? eventImage : logo === 'brand' ? BRAND.logoUrl : null;
  const qrUrl = qr === 'none' ? null : tentQrUrl(qr, party, customUrl);
  const customInvalid = qr === 'custom' && !!customUrl && !isHttpUrl(customUrl);
  const header = { title: headerText.trim() || party.name, logoUrl, splitName: splitNames, qrUrl };
  const cutLines = cutOverride ?? layout.kind === 'plain-paper';
  const pages = pageCount(badges.length, layout);
  const named = badges.filter((b) => !b.blank);
  const pickedCount = candidates.filter((b) => !unchecked.has(b.key)).length;

  const startPrint = (j: 'sheet' | 'align') => {
    setJob(j);
    print(layout.page);
  };

  const toggleKey = (key: string) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setVisible = (checked: boolean) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      for (const b of visibleCandidates) {
        if (checked) next.delete(b.key);
        else next.add(b.key);
      }
      return next;
    });

  const sourceOptions: { value: SourceChoice; label: string }[] = canViewGuests
    ? [
        { value: 'going', label: t('print.nametags.sourceGoing') },
        { value: 'approved', label: t('print.nametags.sourceApproved') },
        { value: 'checkedIn', label: t('print.nametags.sourceCheckedIn') },
        { value: 'pick', label: t('print.nametags.sourcePick') },
        { value: 'none', label: t('print.nametags.sourceNone') },
      ]
    : [{ value: 'none', label: t('print.nametags.sourceNone') }];

  return (
    <section id="nametags" className="card p-4 space-y-4" data-testid="nametag-builder">
      <div>
        <h3 className="text-lg font-semibold text-theme-text flex items-center gap-2">
          <Tag size={18} /> {t('print.nametags.title')}
        </h3>
        <p className="text-xs text-white/40 mt-1">{t('print.nametags.help')}</p>
      </div>

      <div className="space-y-2">
        <SegmentedButtons ariaLabel={t('print.nametags.source')} options={sourceOptions} value={effectiveSource} onChange={setSource} />
        {!canViewGuests && <p className="text-xs text-white/40">{t('print.nametags.noGuestAccess')}</p>}
        {canViewGuests && effectiveSource !== 'none' && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox checked={includeWaitlist} onChange={() => setIncludeWaitlist((v) => !v)} label={t('print.nametags.includeWaitlist')} />
            <Checkbox checked={roleLine} onChange={() => setRoleLine((v) => !v)} label={t('print.nametags.roleLine')} />
          </div>
        )}
        {canViewGuests && effectiveSource === 'pick' && (
          <div className="space-y-2" data-testid="guest-picker">
            <IconInput icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('print.nametags.pickSearch')} />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button type="button" onClick={() => setVisible(true)} className="px-3 py-1 rounded-lg bg-theme-surface text-theme-text">
                {t('print.nametags.pickAll')}
              </button>
              <button type="button" onClick={() => setVisible(false)} className="px-3 py-1 rounded-lg bg-theme-surface text-theme-text">
                {t('print.nametags.pickNone')}
              </button>
              <span className="text-theme-text-muted">{t('print.nametags.pickCount', { selected: pickedCount, total: candidates.length })}</span>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {visibleCandidates.length === 0 && <p className="text-xs text-white/40">{t('print.nametags.pickEmpty')}</p>}
              {visibleCandidates.map((b) => (
                <Checkbox key={b.key} checked={!unchecked.has(b.key)} onChange={() => toggleKey(b.key)} label={b.name} />
              ))}
            </div>
          </div>
        )}
      </div>

      <IconInput
        icon={Type}
        multiline
        rows={3}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={t('print.nametags.typedPlaceholder')}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput
          icon={Hash}
          type="number"
          min={0}
          max={48}
          value={blankCount}
          onChange={(e) => setBlankCount(e.target.value)}
          placeholder={t('print.nametags.blanksPlaceholder')}
        />
        <IconInput icon={Type} value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder={`${t('print.nametags.headerPlaceholder')} (${party.name})`} />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox checked={fillSheet} onChange={() => setFillSheet((v) => !v)} label={t('print.nametags.fillSheet')} />
        <Checkbox checked={splitNames} onChange={() => setSplitNames((v) => !v)} label={t('print.nametags.splitNames')} />
      </div>

      <div className="space-y-2">
        <SegmentedButtons
          ariaLabel={t('print.nametags.layout')}
          options={BADGE_LAYOUTS.map((l) => ({ value: l.id, label: t(l.labelKey) }))}
          value={layoutId}
          onChange={(v) => { setLayoutId(v); setCutOverride(null); }}
        />
        <div className="flex items-center gap-2">
          <ImageIcon size={16} className="text-theme-text-muted" />
          <SegmentedButtons
            ariaLabel={t('print.nametags.logo')}
            options={[
              { value: 'brand' as const, label: t('print.nametags.logoBrand') },
              ...(eventImage ? [{ value: 'event' as const, label: t('print.nametags.logoEvent') }] : []),
              { value: 'none' as const, label: t('print.nametags.logoNone') },
            ]}
            value={logo}
            onChange={setLogo}
          />
        </div>
        <Checkbox checked={cutLines} onChange={() => setCutOverride(!cutLines)} label={t('print.sheet.cutLines')} />
      </div>

      <div className="space-y-2">
        <SegmentedButtons
          ariaLabel={t('print.nametags.qr')}
          options={[
            { value: 'none' as BadgeQr, label: t('print.nametags.qrNone') },
            { value: 'event' as BadgeQr, label: t('print.nametags.qrEvent') },
            { value: 'custom' as BadgeQr, label: t('print.nametags.qrCustom') },
          ]}
          value={qr}
          onChange={setQr}
        />
        {qr === 'custom' && (
          <div>
            <IconInput icon={LinkIcon} value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder={t('print.tents.customUrlPlaceholder')} />
            {customInvalid && <p className="text-xs text-red-400 mt-1">{t('print.tents.customUrlInvalid')}</p>}
          </div>
        )}
      </div>

      {named.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-theme-text-muted">{t('print.nametags.pronounsHeading')}</summary>
          <div className="mt-2 max-h-64 overflow-y-auto space-y-2 pr-1">
            {named.map((b) => (
              <div key={b.key} className="flex items-center gap-2">
                <span className="w-1/3 truncate text-theme-text">{b.name}</span>
                <div className="flex-1">
                  <IconInput
                    value={pronouns[b.key] ?? ''}
                    onChange={(e) => setPronouns((p) => ({ ...p, [b.key]: e.target.value }))}
                    placeholder={t('print.nametags.pronounsPlaceholder')}
                    maxLength={30}
                  />
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="text-sm text-theme-text-muted">{t('print.nametags.count', { count: badges.length, pages })}</p>

      <PrintPreview
        paper={layout.page}
        pageCount={pages}
        moreLabel={(shown, total) => t('print.sheet.showingPages', { shown, total })}
        renderPage={(i) => (
          <NametagPage layout={layout} badges={paginate(badges, layout)[i]} header={header} outline={cutLines ? 'cut' : 'preview'} pronouns={pronouns} />
        )}
      />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => startPrint('sheet')}
          disabled={badges.length === 0 || !!printing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ff393a] text-white font-medium disabled:opacity-40"
        >
          <Printer size={16} /> {t('print.sheet.print')}
        </button>
        <button
          type="button"
          onClick={() => startPrint('align')}
          disabled={!!printing}
          className="px-4 py-2 rounded-lg bg-theme-surface text-theme-text text-sm"
        >
          {t('print.nametags.alignmentTest')}
        </button>
      </div>
      <p className="text-xs text-white/40">{t('print.sheet.instructions')}</p>
      {layout.id === 'avery-5395' && <p className="text-xs text-white/40">{t('print.nametags.averyNote')}</p>}
      {layout.id === 'avery-5392' && <p className="text-xs text-white/40">{t('print.nametags.avery5392Note')}</p>}
      {layout.id === 'avery-l4785' && <p className="text-xs text-white/40">{t('print.nametags.averyL4785Note')}</p>}

      {printing && (
        <PrintPortal paper={printing}>
          {job === 'align' ? (
            <AlignmentTestPage layout={layout} text={t('print.nametags.alignmentText')} rulerLabel={t('print.nametags.rulerLabel')} />
          ) : (
            <NametagSheet layout={layout} badges={badges} header={header} outline={cutLines ? 'cut' : 'none'} pronouns={pronouns} />
          )}
        </PrintPortal>
      )}
    </section>
  );
}
