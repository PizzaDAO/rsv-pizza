import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { IconInput } from '../IconInput';
import { usePizza } from '../../contexts/PizzaContext';
import { getSponsors } from '../../lib/api';
import {
  extractCityAndState,
  formatPressReleaseDate,
  getPressReleaseRsvpUrl,
  DEFAULT_TEMPLATE,
  PLACEHOLDERS,
  generatePressRelease,
} from './pressReleaseUtils';

export function PressReleaseWidget() {
  const { party } = usePizza();

  // Form fields
  const [hostName, setHostName] = useState('');
  const [hostPhone, setHostPhone] = useState('');
  const [pizzeria, setPizzeria] = useState('');
  const [city, setCity] = useState('');
  const [venue, setVenue] = useState('');
  const [sponsors, setSponsors] = useState('');

  // Template and output
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [generatedText, setGeneratedText] = useState('');
  const [copied, setCopied] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Auto-fill fields from party data
  useEffect(() => {
    if (!party) return;

    // Host name
    if (party.hostName) {
      setHostName(party.hostName);
    }

    // Pizzeria — first selected pizzeria
    if (party.selectedPizzerias && party.selectedPizzerias.length > 0) {
      setPizzeria(party.selectedPizzerias[0].name);
    }

    // City — extract from address
    if (party.address) {
      const { city: extractedCity } = extractCityAndState(party.address);
      // Remove any zip/postal code from the city string
      const cleanCity = extractedCity.replace(/\s*\d{5}(-\d{4})?$/, '').trim();
      setCity(cleanCity);
    }

    // Venue
    if (party.venueName) {
      setVenue(party.venueName);
    } else if (party.address) {
      setVenue(party.address);
    }

    // Fetch sponsors
    async function fetchSponsors() {
      if (!party) return;
      try {
        const result = await getSponsors(party.id, { status: 'yes' as any });
        if (result && result.sponsors.length > 0) {
          const sponsorNames = result.sponsors.map(s => s.name).join(', ');
          setSponsors(sponsorNames);
        } else {
          // Try also "paid" sponsors
          const paidResult = await getSponsors(party.id, { status: 'paid' as any });
          if (paidResult && paidResult.sponsors.length > 0) {
            const allNames = paidResult.sponsors.map(s => s.name).join(', ');
            setSponsors(allNames);
          }
        }
      } catch (err) {
        console.error('Failed to fetch sponsors for press release:', err);
      }
    }
    fetchSponsors();
  }, [party]);

  const handleGenerate = () => {
    if (!party) return;

    const fields: Record<string, string> = {
      host_name: hostName,
      host_phone: hostPhone,
      pizzeria: pizzeria,
      city: city,
      venue: venue,
      sponsors: sponsors,
      date: formatPressReleaseDate(party),
      event_name: party.name,
      rsvp_url: getPressReleaseRsvpUrl(party),
    };

    const result = generatePressRelease(template, fields);
    setGeneratedText(result);
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

  const handleReset = () => {
    setTemplate(DEFAULT_TEMPLATE);
  };

  if (!party) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[#39d98a]/15 flex items-center justify-center flex-shrink-0">
            <Newspaper size={20} className="text-[#39d98a]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-theme-text">Press Release Generator</h2>
            <p className="text-xs text-theme-text-muted">
              Generate a press release to send to local media outlets
            </p>
          </div>
        </div>
      </div>

      {/* Form Fields */}
      <div className="card p-6 space-y-3">
        <h3 className="text-sm font-medium text-theme-text-secondary uppercase tracking-wider mb-2">
          Event Details
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IconInput
            icon={User}
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            placeholder="Host name"
          />
          <IconInput
            icon={Phone}
            value={hostPhone}
            onChange={(e) => setHostPhone(e.target.value)}
            placeholder="Phone number (for media inquiries)"
          />
          <IconInput
            icon={Store}
            value={pizzeria}
            onChange={(e) => setPizzeria(e.target.value)}
            placeholder="Pizzeria name"
          />
          <IconInput
            icon={MapPin}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City name"
          />
          <IconInput
            icon={MapPin}
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="Venue / Location"
          />
          <IconInput
            icon={Handshake}
            value={sponsors}
            onChange={(e) => setSponsors(e.target.value)}
            placeholder="Local sponsors (comma-separated)"
          />
        </div>

        <p className="text-xs text-theme-text-faint">
          Auto-filled from your event data. Edit as needed.
        </p>
      </div>

      {/* Template Section */}
      <div className="card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-theme-text-secondary uppercase tracking-wider">
            Template
          </h3>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors"
          >
            <RotateCcw size={12} />
            Reset to default
          </button>
        </div>

        {/* Placeholder chips */}
        <div className="flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map((p) => (
            <span
              key={p.key}
              className="text-[11px] px-2 py-0.5 rounded-full bg-theme-surface-hover text-theme-text-muted font-mono"
            >
              {p.key}
            </span>
          ))}
        </div>

        <IconInput
          icon={FileText}
          multiline
          rows={18}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder="Press release template..."
        />

        <p className="text-xs text-theme-text-faint">
          Edit the template above. Placeholders like {'{city}'} will be replaced with your field values when you generate.
        </p>
      </div>

      {/* Generate Button */}
      <button
        type="button"
        onClick={handleGenerate}
        className="w-full btn-primary flex items-center justify-center gap-2 py-3"
      >
        <Wand2 size={18} />
        Generate Press Release
      </button>

      {/* Generated Output */}
      {hasGenerated && (
        <div className="card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-theme-text-secondary uppercase tracking-wider">
              Generated Press Release
            </h3>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-secondary transition-colors"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-green-400" />
                  <span className="text-green-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy to clipboard
                </>
              )}
            </button>
          </div>

          <div className="bg-theme-surface rounded-lg p-4 border border-theme-stroke">
            <pre className="text-sm text-theme-text whitespace-pre-wrap font-sans leading-relaxed">
              {generatedText}
            </pre>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 bg-theme-surface-hover hover:bg-theme-surface text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            {copied ? (
              <>
                <Check size={16} className="text-green-400" />
                Copied!
              </>
            ) : (
              <>
                <Copy size={16} />
                Copy to Clipboard
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
