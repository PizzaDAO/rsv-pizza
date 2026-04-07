import React, { useState, useMemo } from 'react';
import { Mail, Copy, Check, MessageSquare } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import {
  SWCCandidate,
  OutreachTemplate,
  getOutreachTemplates,
} from './swcUtils';

interface OutreachDrafterProps {
  candidate: SWCCandidate;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  rsvpUrl: string;
  hostName: string;
}

export const OutreachDrafter: React.FC<OutreachDrafterProps> = ({
  candidate,
  eventName,
  eventDate,
  eventLocation,
  rsvpUrl,
  hostName,
}) => {
  const eventData = useMemo(
    () => ({ eventName, eventDate, eventLocation, rsvpUrl, hostName }),
    [eventName, eventDate, eventLocation, rsvpUrl, hostName]
  );

  const templates = useMemo(
    () => getOutreachTemplates(candidate, eventData),
    [candidate, eventData]
  );

  const [templateKey, setTemplateKey] = useState<OutreachTemplate>('invitation');
  const activeTemplate = templates[templateKey];
  const [subject, setSubject] = useState(activeTemplate.subject(candidate, eventData));
  const [body, setBody] = useState(activeTemplate.body(candidate, eventData));
  const [includeRsvpLink, setIncludeRsvpLink] = useState(true);
  const [copied, setCopied] = useState<'subject' | 'body' | null>(null);

  const handleTemplateChange = (key: OutreachTemplate) => {
    setTemplateKey(key);
    const t = templates[key];
    setSubject(t.subject(candidate, eventData));
    setBody(t.body(candidate, eventData));
  };

  const fullBody = useMemo(() => {
    if (!includeRsvpLink) return body;
    // Only append if the body doesn't already contain the RSVP URL
    if (body.includes(rsvpUrl)) return body;
    return body + `\n\nRSVP: ${rsvpUrl}`;
  }, [body, includeRsvpLink, rsvpUrl]);

  const handleCopy = async (text: string, type: 'subject' | 'body') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleOpenMailto = () => {
    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullBody)}`;
    window.location.href = mailto;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Mail size={14} className="text-theme-text-muted" />
        <span className="text-xs text-theme-text-muted">
          Drafting outreach to <span className="text-theme-text font-medium">{candidate.name}</span>
        </span>
      </div>

      {/* Template Selector */}
      <div>
        <span className="text-xs text-theme-text-muted mb-2 block">Template</span>
        <div className="flex gap-2 flex-wrap">
          {(Object.entries(templates) as [OutreachTemplate, typeof activeTemplate][]).map(
            ([key, config]) => (
              <button
                key={key}
                type="button"
                onClick={() => handleTemplateChange(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  templateKey === key
                    ? 'bg-theme-surface-hover text-theme-text border border-theme-stroke-hover'
                    : 'bg-theme-surface text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-surface-hover border border-transparent'
                }`}
              >
                {config.label}
              </button>
            )
          )}
        </div>
      </div>

      {/* Subject Line */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-theme-text-muted">Subject</span>
          <button
            type="button"
            onClick={() => handleCopy(subject, 'subject')}
            className="text-xs text-theme-text-faint hover:text-theme-text-secondary flex items-center gap-1 transition-colors"
          >
            {copied === 'subject' ? (
              <Check size={12} className="text-green-400" />
            ) : (
              <Copy size={12} />
            )}
            Copy
          </button>
        </div>
        <IconInput
          icon={Mail}
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Email subject"
        />
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-theme-text-muted">Body</span>
          <button
            type="button"
            onClick={() => handleCopy(fullBody, 'body')}
            className="text-xs text-theme-text-faint hover:text-theme-text-secondary flex items-center gap-1 transition-colors"
          >
            {copied === 'body' ? (
              <Check size={12} className="text-green-400" />
            ) : (
              <Copy size={12} />
            )}
            Copy
          </button>
        </div>
        <IconInput
          icon={MessageSquare}
          multiline
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Email body..."
        />
      </div>

      {/* Include RSVP Link Toggle */}
      <Checkbox
        checked={includeRsvpLink}
        onChange={() => setIncludeRsvpLink(!includeRsvpLink)}
        label="Include RSVP link in email"
      />

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleCopy(fullBody, 'body')}
          className="flex-1 flex items-center justify-center gap-2 bg-theme-surface-hover hover:bg-theme-surface text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
        >
          <Copy size={16} />
          Copy Email
        </button>

        <button
          type="button"
          onClick={handleOpenMailto}
          className="flex-1 flex items-center justify-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
        >
          <Mail size={16} />
          Open in Email App
        </button>
      </div>

      <p className="text-xs text-theme-text-faint text-center">
        Opens your default email client with the message pre-filled.
      </p>
    </div>
  );
};
