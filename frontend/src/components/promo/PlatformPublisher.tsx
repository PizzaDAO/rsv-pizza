import React, { useState, useEffect } from 'react';
import { Copy, ExternalLink, Check, MessageSquare, Link, Tag, X, Plus, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Party } from '../../types';
import { usePizza } from '../../contexts/PizzaContext';
import { updateParty } from '../../lib/supabase';
import {
  EventPlatform,
  EVENT_PLATFORMS,
  generateEventDescription,
  getRsvpUrl,
  formatEventDateLong,
  getLocationString,
} from './promoUtils';

const PLATFORM_ORDER: EventPlatform[] = ['luma', 'meetup', 'eventbrite'];

// Map platform to party field name (snake_case for updateParty)
const PLATFORM_URL_FIELD: Record<EventPlatform, 'luma_url' | 'meetup_url' | 'eventbrite_url'> = {
  luma: 'luma_url',
  meetup: 'meetup_url',
  eventbrite: 'eventbrite_url',
};

// Map platform to Party property name (camelCase)
const PLATFORM_PARTY_KEY: Record<EventPlatform, 'lumaUrl' | 'meetupUrl' | 'eventbriteUrl'> = {
  luma: 'lumaUrl',
  meetup: 'meetupUrl',
  eventbrite: 'eventbriteUrl',
};

// Simple platform logos
function LumaLogo() {
  return (
    <div className="w-8 h-8 rounded-lg bg-[#7C5CFC] flex items-center justify-center text-theme-text text-xs font-bold">
      Lu
    </div>
  );
}

function MeetupLogo() {
  return (
    <div className="w-8 h-8 rounded-lg bg-[#ED1C40] flex items-center justify-center text-theme-text text-xs font-bold">
      M
    </div>
  );
}

function EventbriteLogo() {
  return (
    <div className="w-8 h-8 rounded-lg bg-[#F05537] flex items-center justify-center text-theme-text text-xs font-bold">
      Eb
    </div>
  );
}

function getPlatformLogo(platform: EventPlatform) {
  switch (platform) {
    case 'luma': return <LumaLogo />;
    case 'meetup': return <MeetupLogo />;
    case 'eventbrite': return <EventbriteLogo />;
  }
}

export const PlatformPublisher: React.FC = () => {
  const { party, loadParty } = usePizza();
  const [expandedPlatform, setExpandedPlatform] = useState<EventPlatform | null>(null);
  const [description, setDescription] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // Local URL state for each platform
  const [platformUrls, setPlatformUrls] = useState<Record<EventPlatform, string>>({
    luma: '',
    meetup: '',
    eventbrite: '',
  });

  // Saving state per field
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);

  // Custom links local state
  const [customLinks, setCustomLinks] = useState<Array<{label: string; url: string}>>([]);

  // Sync from party to local state
  useEffect(() => {
    if (party) {
      setPlatformUrls({
        luma: party.lumaUrl || '',
        meetup: party.meetupUrl || '',
        eventbrite: party.eventbriteUrl || '',
      });
      setCustomLinks(party.externalLinks || []);
    }
  }, [party]);

  if (!party) return null;

  const handleExpand = (platform: EventPlatform) => {
    if (expandedPlatform === platform) {
      setExpandedPlatform(null);
    } else {
      setExpandedPlatform(platform);
      setDescription(generateEventDescription(party));
    }
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleOpenPlatform = (platform: EventPlatform) => {
    const config = EVENT_PLATFORMS[platform];
    window.open(config.createUrl, '_blank', 'noopener,noreferrer');
  };

  const savePlatformUrl = async (platform: EventPlatform) => {
    const fieldName = PLATFORM_URL_FIELD[platform];
    const value = platformUrls[platform].trim();
    const partyKey = PLATFORM_PARTY_KEY[platform];

    // Skip if unchanged
    if (value === (party[partyKey] || '')) return;

    setSavingField(fieldName);
    setSavedField(null);

    try {
      const success = await updateParty(party.id, { [fieldName]: value || null });
      if (success) {
        setSavedField(fieldName);
        setTimeout(() => setSavedField(null), 2000);
      } else if (party.inviteCode) {
        await loadParty(party.inviteCode);
      }
    } catch (error) {
      console.error(`Error saving ${fieldName}:`, error);
      if (party.inviteCode) {
        await loadParty(party.inviteCode);
      }
    } finally {
      setSavingField(null);
    }
  };

  const saveCustomLinks = async (links: Array<{label: string; url: string}>) => {
    setSavingField('external_links');
    setSavedField(null);

    try {
      const success = await updateParty(party.id, { external_links: links });
      if (success) {
        setSavedField('external_links');
        setTimeout(() => setSavedField(null), 2000);
      } else if (party.inviteCode) {
        await loadParty(party.inviteCode);
      }
    } catch (error) {
      console.error('Error saving custom links:', error);
      if (party.inviteCode) {
        await loadParty(party.inviteCode);
      }
    } finally {
      setSavingField(null);
    }
  };

  const addCustomLink = () => {
    if (customLinks.length >= 10) return;
    setCustomLinks([...customLinks, { label: '', url: '' }]);
  };

  const removeCustomLink = (index: number) => {
    const updated = customLinks.filter((_, i) => i !== index);
    setCustomLinks(updated);
    saveCustomLinks(updated);
  };

  const updateCustomLink = (index: number, field: 'label' | 'url', value: string) => {
    const updated = customLinks.map((link, i) =>
      i === index ? { ...link, [field]: value } : link
    );
    setCustomLinks(updated);
  };

  const handleCustomLinkBlur = () => {
    // Filter out completely empty rows before saving
    const nonEmpty = customLinks.filter(link => link.label.trim() || link.url.trim());
    saveCustomLinks(nonEmpty);
  };

  const rsvpUrl = getRsvpUrl(party);

  const renderSaveIndicator = (fieldName: string) => {
    if (savingField === fieldName) {
      return <Loader2 size={12} className="animate-spin text-theme-text-muted" />;
    }
    if (savedField === fieldName) {
      return <Check size={12} className="text-green-400" />;
    }
    return null;
  };

  return (
    <div className="space-y-3">
      {PLATFORM_ORDER.map((platform) => {
        const config = EVENT_PLATFORMS[platform];
        const isExpanded = expandedPlatform === platform;
        const partyKey = PLATFORM_PARTY_KEY[platform];
        const hasUrl = !!(party[partyKey]);

        return (
          <div key={platform} className="border border-theme-stroke rounded-xl overflow-hidden">
            {/* Platform Header */}
            <button
              type="button"
              onClick={() => handleExpand(platform)}
              className="w-full flex items-center justify-between p-4 hover:bg-theme-surface transition-colors"
            >
              <div className="flex items-center gap-3">
                {getPlatformLogo(platform)}
                <div className="text-left">
                  <p className="text-theme-text font-medium text-sm">{config.name}</p>
                  <p className="text-theme-text-muted text-xs">Create event listing</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {hasUrl && (
                  <Check size={16} className="text-green-400" />
                )}
                <svg
                  className={`w-5 h-5 text-theme-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="border-t border-theme-stroke p-4 space-y-3">
                {/* URL Input */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-theme-text-muted">{config.name} Event URL</span>
                    {renderSaveIndicator(PLATFORM_URL_FIELD[platform])}
                  </div>
                  <IconInput
                    icon={Link}
                    type="url"
                    value={platformUrls[platform]}
                    onChange={(e) => setPlatformUrls(prev => ({ ...prev, [platform]: e.target.value }))}
                    onBlur={() => savePlatformUrl(platform)}
                    placeholder={`Paste your ${config.name} event URL`}
                  />
                </div>

                {/* Quick Copy Fields */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-theme-surface rounded-lg px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-theme-text-muted">Event Name</span>
                      <p className="text-theme-text text-sm truncate">{party.name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(party.name, `${platform}-name`)}
                      className="ml-2 text-theme-text-muted hover:text-theme-text transition-colors flex-shrink-0"
                    >
                      {copied === `${platform}-name` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>

                  {party.date && (
                    <div className="flex items-center justify-between bg-theme-surface rounded-lg px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs text-theme-text-muted">Date & Time</span>
                        <p className="text-theme-text text-sm truncate">{formatEventDateLong(party)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(formatEventDateLong(party), `${platform}-date`)}
                        className="ml-2 text-theme-text-muted hover:text-theme-text transition-colors flex-shrink-0"
                      >
                        {copied === `${platform}-date` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  )}

                  {(party.venueName || party.address) && (
                    <div className="flex items-center justify-between bg-theme-surface rounded-lg px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs text-theme-text-muted">Location</span>
                        <p className="text-theme-text text-sm truncate">{getLocationString(party)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(getLocationString(party), `${platform}-location`)}
                        className="ml-2 text-theme-text-muted hover:text-theme-text transition-colors flex-shrink-0"
                      >
                        {copied === `${platform}-location` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between bg-theme-surface rounded-lg px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-theme-text-muted">RSVP Link</span>
                      <p className="text-theme-text text-sm truncate">{rsvpUrl}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(rsvpUrl, `${platform}-link`)}
                      className="ml-2 text-theme-text-muted hover:text-theme-text transition-colors flex-shrink-0"
                    >
                      {copied === `${platform}-link` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                {/* Description Editor */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-theme-text-muted">Description (editable)</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(description, `${platform}-desc`)}
                      className="text-xs text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 transition-colors"
                    >
                      {copied === `${platform}-desc` ? (
                        <>
                          <Check size={12} className="text-green-400" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <IconInput
                    icon={MessageSquare}
                    multiline
                    rows={6}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Event description..."
                  />
                </div>

                {/* Open Platform Button */}
                <button
                  type="button"
                  onClick={() => handleOpenPlatform(platform)}
                  className="w-full flex items-center justify-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
                >
                  <ExternalLink size={16} />
                  Create on {config.name}
                </button>

                <p className="text-xs text-theme-text-faint text-center">
                  Copy the details above, then paste them into {config.name}
                </p>

                {platform === 'luma' && (
                  <p className="text-xs text-theme-text-muted text-center mt-1">
                    Add <span className="font-medium text-theme-text-secondary">hello@rarepizzas.com</span> as a host on your Luma event
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Custom External Links */}
      <div className="border border-theme-stroke rounded-xl overflow-hidden">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Link size={16} className="text-theme-text-muted" />
              <span className="text-theme-text font-medium text-sm">Custom Links</span>
            </div>
            <div className="flex items-center gap-2">
              {renderSaveIndicator('external_links')}
              {customLinks.length > 0 && (
                <span className="text-xs text-theme-text-muted">{customLinks.length}/10</span>
              )}
            </div>
          </div>
          <p className="text-xs text-theme-text-muted mb-3">
            Add links to other platforms where your event is listed
          </p>

          {customLinks.length > 0 && (
            <div className="space-y-2 mb-3">
              {customLinks.map((link, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <IconInput
                      icon={Tag}
                      value={link.label}
                      onChange={(e) => updateCustomLink(index, 'label', e.target.value)}
                      onBlur={handleCustomLinkBlur}
                      placeholder="Label (e.g. Facebook)"
                    />
                  </div>
                  <div className="flex-[2] min-w-0">
                    <IconInput
                      icon={Link}
                      type="url"
                      value={link.url}
                      onChange={(e) => updateCustomLink(index, 'url', e.target.value)}
                      onBlur={handleCustomLinkBlur}
                      placeholder="https://..."
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCustomLink(index)}
                    className="text-theme-text-muted hover:text-red-400 transition-colors flex-shrink-0 p-1"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {customLinks.length < 10 && (
            <button
              type="button"
              onClick={addCustomLink}
              className="flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text transition-colors"
            >
              <Plus size={14} />
              Add link
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
