import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Type, Hash, Image as ImageIcon, Tag } from 'lucide-react';
import { usePizza } from '../../../contexts/PizzaContext';
import { BRAND } from '../../../config/brand';
import { IconInput } from '../../IconInput';
import { Checkbox } from '../../Checkbox';
import { SegmentedButtons } from '../SegmentedButtons';
import { PrintPortal, PrintPreview, usePrintSheets } from '../printSheet';
import { BADGE_LAYOUTS, fillSheetBlanks, getBadgeLayout, pageCount } from '../layouts';
import { blankBadges, buildBadges, typedBadges, type GuestSource } from './nametagData';
import { AlignmentTestPage, NametagPage, NametagSheet } from './NametagSheet';
import { paginate } from '../layouts';

type LogoChoice = 'event' | 'brand' | 'none';
type SourceChoice = GuestSource;

export function NametagBuilder({ canViewGuests }: { canViewGuests: boolean }) {
  const { t, i18n } = useTranslation('host');
  const { party, guests } = usePizza();
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
  const [job, setJob] = useState<'sheet' | 'align'>('sheet');
  const { printing, print } = usePrintSheets();

  const layout = getBadgeLayout(layoutId);
  const effectiveSource: SourceChoice = canViewGuests ? source : 'none';

  const badges = useMemo(() => {
    const fromGuests = buildBadges(canViewGuests ? guests : [], party?.coHosts ?? [], {
      source: effectiveSource,
      includeWaitlist,
      roleLine,
      roleLabels: { host: t('print.nametags.roleHost'), coHost: t('print.nametags.roleCoHost'), partner: t('print.nametags.rolePartner') },
      hostName: party?.hostName,
      locale: i18n.language,
    });
    const named = [...fromGuests, ...typedBadges(typed)];
    const extra = blankBadges(Number(blankCount));
    const withBlanks = [...named, ...extra];
    const fill = fillSheet ? fillSheetBlanks(withBlanks.length, layout) : 0;
    const fillBadges = Array.from({ length: fill }, (_, i) => ({ key: `f-${i}`, name: '', blank: true }));
    return [...withBlanks, ...fillBadges];
  }, [canViewGuests, guests, party?.coHosts, party?.hostName, effectiveSource, includeWaitlist, roleLine, typed, blankCount, fillSheet, layout, i18n.language, t]);

  if (!party) return null;

  const eventImage = party.eventImageUrl || null;
  const logoUrl = logo === 'event' ? eventImage : logo === 'brand' ? BRAND.logoUrl : null;
  const header = { title: headerText.trim() || party.name, logoUrl };
  const cutLines = cutOverride ?? layout.kind === 'plain-paper';
  const pages = pageCount(badges.length, layout);
  const named = badges.filter((b) => !b.blank);

  const startPrint = (j: 'sheet' | 'align') => {
    setJob(j);
    print(layout.page);
  };

  const sourceOptions: { value: SourceChoice; label: string }[] = canViewGuests
    ? [
        { value: 'going', label: t('print.nametags.sourceGoing') },
        { value: 'approved', label: t('print.nametags.sourceApproved') },
        { value: 'checkedIn', label: t('print.nametags.sourceCheckedIn') },
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
      <Checkbox checked={fillSheet} onChange={() => setFillSheet((v) => !v)} label={t('print.nametags.fillSheet')} />

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
