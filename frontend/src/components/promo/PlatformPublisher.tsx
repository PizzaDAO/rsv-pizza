import React, { useState } from 'react';
import { Copy, ExternalLink, Check, MessageSquare } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Party } from '../../types';
import {
  EventPlatform,
  EVENT_PLATFORMS,
  generateEventDescription,
  getRsvpUrl,
  formatEventDateLong,
  getLocationString,
} from './promoUtils';

interface PlatformPublisherProps {
  party: Party;
}

const PLATFORM_ORDER: EventPlatform[] = ['luma', 'meetup', 'eventbrite'];

// Simple platform logos
function LumaLogo() {
  return (
    <div className="w-8 h-8 rounded-lg bg-[#7C5CFC] flex items-center justify-center text-white text-xs font-bold">
      Lu
    </div>
  );
}

function MeetupLogo() {
  return (
    <div className="w-8 h-8 rounded-lg bg-[#ED1C40] flex items-center justify-center text-white text-xs font-bold">
      M
    </div>
  );
}

function EventbriteLogo() {
  return (
    <div className="w-8 h-8 rounded-lg bg-[#F05537] flex items-center justify-center text-white text-xs font-bold">
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

export const PlatformPublisher: React.FC<PlatformPublisherProps> = ({ party }) => {
  const [expandedPlatform, setExpandedPlatform] = useState<EventPlatform | null>(null);
  const [description, setDescription] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

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

  const rsvpUrl = getRsvpUrl(party);

  return (
    <div className="space-y-3">
      {PLATFORM_ORDER.map((platform) => {
        const config = EVENT_PLATFORMS[platform];
        const isExpanded = expandedPlatform === platform;

        return (
          <div key={platform} className="border border-white/10 rounded-xl overflow-hidden">
            {/* Platform Header */}
            <button
              type="button"
              onClick={() => handleExpand(platform)}
              className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                {getPlatformLogo(platform)}
                <div className="text-left">
                  <p className="text-white font-medium text-sm">{config.name}</p>
                  <p className="text-white/40 text-xs">Create event listing</p>
                </div>
              </div>
              <svg
                className={`w-5 h-5 text-white/40 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="border-t border-white/10 p-4 space-y-3">
                {/* Quick Copy Fields */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-white/40">Event Name</span>
                      <p className="text-white text-sm truncate">{party.name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(party.name, `${platform}-name`)}
                      className="ml-2 text-white/40 hover:text-white transition-colors flex-shrink-0"
                    >
                      {copied === `${platform}-name` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>

                  {party.date && (
                    <div className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs text-white/40">Date & Time</span>
                        <p className="text-white text-sm truncate">{formatEventDateLong(party)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(formatEventDateLong(party), `${platform}-date`)}
                        className="ml-2 text-white/40 hover:text-white transition-colors flex-shrink-0"
                      >
                        {copied === `${platform}-date` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  )}

                  {(party.venueName || party.address) && (
                    <div className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs text-white/40">Location</span>
                        <p className="text-white text-sm truncate">{getLocationString(party)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(getLocationString(party), `${platform}-location`)}
                        className="ml-2 text-white/40 hover:text-white transition-colors flex-shrink-0"
                      >
                        {copied === `${platform}-location` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-white/40">RSVP Link</span>
                      <p className="text-white text-sm truncate">{rsvpUrl}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(rsvpUrl, `${platform}-link`)}
                      className="ml-2 text-white/40 hover:text-white transition-colors flex-shrink-0"
                    >
                      {copied === `${platform}-link` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                {/* Description Editor */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-white/40">Description (editable)</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(description, `${platform}-desc`)}
                      className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1 transition-colors"
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

                <p className="text-xs text-white/30 text-center">
                  Copy the details above, then paste them into {config.name}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
