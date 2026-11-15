import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Newspaper,
  User,
  Phone,
  Store,
  MapPin,
  Handshake,
  Wand2,
  Copy,
  Check,
  FileText,
  RotateCcw,
  Download,
} from 'lucide-react';
import { IconInput } from '../IconInput';
import { usePizza } from '../../contexts/PizzaContext';
import { getSponsors } from '../../lib/api';
import {
  extractCityAndState,
  cleanCity,
  formatPressReleaseDate,
  getPressReleaseRsvpUrl,
  PLACEHOLDER_KEYS,
  generatePressRelease,
} from './pressReleaseUtils';

/**
 * Press release generator. Pure text generator: fills a template from the event's
 * data and lets the host copy or download it. Nothing is sent anywhere.
 */
export function PressReleaseWidget() {
  const { t, i18n } = useTranslation('host');
  const { party } = usePizza();

  // Form fields
  const [hostName, setHostName] = useState('');
  const [hostPhone, setHostPhone] = useState('');
  const [pizzeria, setPizzeria] = useState('');
  const [city, setCity] = useState('');
  const [venue, setVenue] = useState('');
  const [sponsors, setSponsors] = useState('');

  // Template and output
  const [template, setTemplate] = useState(() => t('pressRelease.defaultTemplate'));
  const [generatedText, setGeneratedText] = useState('');
  const [copied, setCopied] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const partyId = party?.id;

  // Auto-fill fields from party data (only when the event changes, so host edits aren't wiped)
  useEffect(() => {
    if (!party) return;
    let cancelled = false;

    if (party.hostName) setHostName(party.hostName);

    if (party.selectedPizzerias && party.selectedPizzerias.length > 0) {
      setPizzeria(party.selectedPizzerias[0].name);
    }

    if (party.address) {
      setCity(cleanCity(extractCityAndState(party.address).city));
    }

    if (party.venueName) {
      setVenue(party.venueName);
    } else if (party.address) {
      setVenue(party.address);
    }

    (async () => {
      try {
        let result = await getSponsors(party.id, { status: 'yes' });
        if (!result || result.sponsors.length === 0) {
          result = await getSponsors(party.id, { status: 'paid' });
        }
        if (!cancelled && result && result.sponsors.length > 0) {
          setSponsors(result.sponsors.map(s => s.name).join(', '));
        }
      } catch (err) {
        console.error('Failed to fetch sponsors for press release:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [partyId]);

  if (!party) return null;

  const handleGenerate = () => {
    const fields: Record<string, string> = {
      host_name: hostName,
      host_phone: hostPhone,
      pizzeria,
      city,
      venue,
      sponsors,
      date: formatPressReleaseDate(party, i18n.language, t('pressRelease.dateTbd')),
      event_name: party.name,
      rsvp_url: getPressReleaseRsvpUrl(party),
    };

    setGeneratedText(generatePressRelease(template, fields));
    setHasGenerated(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([generatedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'press-release.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setTemplate(t('pressRelease.defaultTemplate'));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[#39d98a]/15 flex items-center justify-center flex-shrink-0">
            <Newspaper size={20} className="text-[#39d98a]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-theme-text">{t('pressRelease.title')}</h2>
            <p className="text-xs text-theme-text-muted">{t('pressRelease.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Form Fields */}
      <div className="card p-6 space-y-3">
        <h3 className="text-sm font-medium text-theme-text-secondary uppercase tracking-wider mb-2">
          {t('pressRelease.eventDetails')}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IconInput
            icon={User}
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            placeholder={t('pressRelease.hostNamePlaceholder')}
          />
          <IconInput
            icon={Phone}
            value={hostPhone}
            onChange={(e) => setHostPhone(e.target.value)}
            placeholder={t('pressRelease.phonePlaceholder')}
          />
          <IconInput
            icon={Store}
            value={pizzeria}
            onChange={(e) => setPizzeria(e.target.value)}
            placeholder={t('pressRelease.pizzeriaPlaceholder')}
          />
          <IconInput
            icon={MapPin}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t('pressRelease.cityPlaceholder')}
          />
          <IconInput
            icon={MapPin}
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder={t('pressRelease.venuePlaceholder')}
          />
          <IconInput
            icon={Handshake}
            value={sponsors}
            onChange={(e) => setSponsors(e.target.value)}
            placeholder={t('pressRelease.sponsorsPlaceholder')}
          />
        </div>

        <p className="text-xs text-theme-text-faint">{t('pressRelease.autoFilled')}</p>
      </div>

      {/* Template Section */}
      <div className="card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-theme-text-secondary uppercase tracking-wider">
            {t('pressRelease.template')}
          </h3>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors"
          >
            <RotateCcw size={12} />
            {t('pressRelease.resetTemplate')}
          </button>
        </div>

        {/* Placeholder chips */}
        <div className="flex flex-wrap gap-1.5">
          {PLACEHOLDER_KEYS.map((key) => (
            <span
              key={key}
              className="text-[11px] px-2 py-0.5 rounded-full bg-theme-surface-hover text-theme-text-muted font-mono"
            >
              {`{${key}}`}
            </span>
          ))}
        </div>

        <IconInput
          icon={FileText}
          multiline
          rows={18}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder={t('pressRelease.templatePlaceholder')}
        />

        <p className="text-xs text-theme-text-faint">{t('pressRelease.templateHelp')}</p>
      </div>

      {/* Generate Button */}
      <button
        type="button"
        onClick={handleGenerate}
        className="w-full btn-primary flex items-center justify-center gap-2 py-3"
      >
        <Wand2 size={18} />
        {t('pressRelease.generate')}
      </button>

      {/* Generated Output */}
      {hasGenerated && (
        <div className="card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-theme-text-secondary uppercase tracking-wider">
              {t('pressRelease.generated')}
            </h3>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-secondary transition-colors"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-green-400" />
                  <span className="text-green-400">{t('pressRelease.copied')}</span>
                </>
              ) : (
                <>
                  <Copy size={14} />
                  {t('pressRelease.copy')}
                </>
              )}
            </button>
          </div>

          <div className="bg-theme-surface rounded-lg p-4 border border-theme-stroke">
            <pre className="text-sm text-theme-text whitespace-pre-wrap font-sans leading-relaxed">
              {generatedText}
            </pre>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 flex items-center justify-center gap-2 bg-theme-surface-hover hover:bg-theme-surface text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              {copied ? (
                <>
                  <Check size={16} className="text-green-400" />
                  {t('pressRelease.copied')}
                </>
              ) : (
                <>
                  <Copy size={16} />
                  {t('pressRelease.copyButton')}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 bg-theme-surface-hover hover:bg-theme-surface text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              <Download size={16} />
              {t('pressRelease.download')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
