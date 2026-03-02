import React, { useState, useMemo } from 'react';
import { Mail, Copy, Check, Users, AlertCircle, MessageSquare } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { Party, Guest } from '../../types';
import { getRsvpUrl, formatEventDateLong, getLocationString } from './promoUtils';

interface EmailOutreachProps {
  party: Party;
  guests: Guest[];
}

type RecipientFilter = 'all' | 'approved' | 'pending';
type EmailTemplate = 'reminder' | 'update' | 'thankyou' | 'custom';

interface TemplateConfig {
  label: string;
  subject: string;
  body: string;
}

function getTemplates(party: Party): Record<EmailTemplate, TemplateConfig> {
  const rsvpUrl = getRsvpUrl(party);
  const dateStr = formatEventDateLong(party);
  const location = getLocationString(party);

  return {
    reminder: {
      label: 'Event Reminder',
      subject: `Reminder: ${party.name}`,
      body: `Hi there!\n\nJust a friendly reminder about ${party.name}.\n\n${party.date ? `Date: ${dateStr}\n` : ''}${location !== 'TBD' ? `Location: ${location}\n` : ''}\nRSVP: ${rsvpUrl}\n\nSee you there!`,
    },
    update: {
      label: 'Event Update',
      subject: `Update: ${party.name}`,
      body: `Hi there!\n\nWe have an update about ${party.name}.\n\n[Your update here]\n\n${party.date ? `Date: ${dateStr}\n` : ''}${location !== 'TBD' ? `Location: ${location}\n` : ''}\nRSVP: ${rsvpUrl}\n\nSee you there!`,
    },
    thankyou: {
      label: 'Thank You',
      subject: `Thanks for attending ${party.name}!`,
      body: `Hi there!\n\nThank you for coming to ${party.name}! We had a great time and hope you did too.\n\n[Add your personal message here]\n\nUntil next time!`,
    },
    custom: {
      label: 'Custom',
      subject: `${party.name}`,
      body: '',
    },
  };
}

export const EmailOutreach: React.FC<EmailOutreachProps> = ({ party, guests }) => {
  const templates = useMemo(() => getTemplates(party), [party]);

  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>('all');
  const [template, setTemplate] = useState<EmailTemplate>('reminder');
  const [subject, setSubject] = useState(templates.reminder.subject);
  const [body, setBody] = useState(templates.reminder.body);
  const [includeEventDetails, setIncludeEventDetails] = useState(true);
  const [copied, setCopied] = useState(false);

  // Filter guests by status and who have emails
  const filteredGuests = useMemo(() => {
    const withEmail = guests.filter(g => g.email);
    switch (recipientFilter) {
      case 'approved':
        return withEmail.filter(g => g.approved === true);
      case 'pending':
        return withEmail.filter(g => g.approved === null || g.approved === undefined);
      case 'all':
      default:
        return withEmail;
    }
  }, [guests, recipientFilter]);

  const handleTemplateChange = (newTemplate: EmailTemplate) => {
    setTemplate(newTemplate);
    const config = templates[newTemplate];
    setSubject(config.subject);
    setBody(config.body);
  };

  // Build the full email body with optional event details footer
  const fullBody = useMemo(() => {
    if (!includeEventDetails) return body;

    const rsvpUrl = getRsvpUrl(party);
    const dateStr = formatEventDateLong(party);
    const location = getLocationString(party);

    const details = [];
    details.push('\n---');
    details.push(`${party.name}`);
    if (party.date) details.push(`Date: ${dateStr}`);
    if (location !== 'TBD') details.push(`Location: ${location}`);
    details.push(`RSVP: ${rsvpUrl}`);

    return body + details.join('\n');
  }, [body, includeEventDetails, party]);

  const handleCopyEmails = async () => {
    const emails = filteredGuests.map(g => g.email).filter(Boolean).join(', ');
    try {
      await navigator.clipboard.writeText(emails);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy emails:', err);
    }
  };

  const handleCopyBody = async () => {
    try {
      await navigator.clipboard.writeText(fullBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy body:', err);
    }
  };

  const handleOpenMailto = () => {
    const emails = filteredGuests.map(g => g.email).filter(Boolean);
    // Use BCC for privacy; limit to reasonable count for mailto
    const bcc = emails.slice(0, 50).join(',');
    const mailto = `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullBody)}`;
    window.location.href = mailto;
  };

  return (
    <div className="space-y-4">
      {/* Recipient Filter */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Users size={14} className="text-white/40" />
          <span className="text-xs text-white/40">Recipients</span>
        </div>
        <div className="flex gap-2">
          {([
            { value: 'all' as RecipientFilter, label: 'All Guests' },
            { value: 'approved' as RecipientFilter, label: 'Approved' },
            { value: 'pending' as RecipientFilter, label: 'Pending' },
          ]).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setRecipientFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                recipientFilter === value
                  ? 'bg-white/15 text-white border border-white/20'
                  : 'bg-white/5 text-white/50 hover:text-white/70 hover:bg-white/10 border border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-white/50">
            {filteredGuests.length} guest{filteredGuests.length !== 1 ? 's' : ''} with email
          </p>
          {filteredGuests.length > 0 && (
            <button
              type="button"
              onClick={handleCopyEmails}
              className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1 transition-colors"
            >
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              Copy emails
            </button>
          )}
        </div>
      </div>

      {/* Template Selector */}
      <div>
        <span className="text-xs text-white/40 mb-2 block">Template</span>
        <div className="flex gap-2 flex-wrap">
          {(Object.entries(templates) as [EmailTemplate, TemplateConfig][]).map(([key, config]) => (
            <button
              key={key}
              type="button"
              onClick={() => handleTemplateChange(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                template === key
                  ? 'bg-white/15 text-white border border-white/20'
                  : 'bg-white/5 text-white/50 hover:text-white/70 hover:bg-white/10 border border-transparent'
              }`}
            >
              {config.label}
            </button>
          ))}
        </div>
      </div>

      {/* Subject Line */}
      <IconInput
        icon={Mail}
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Email subject"
      />

      {/* Body */}
      <IconInput
        icon={MessageSquare}
        multiline
        rows={8}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Email body..."
      />

      {/* Include Event Details Toggle */}
      <Checkbox
        checked={includeEventDetails}
        onChange={() => setIncludeEventDetails(!includeEventDetails)}
        label="Include event details footer"
      />

      {/* Preview */}
      {includeEventDetails && (
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <span className="text-xs text-white/40 block mb-1">Event details footer preview:</span>
          <div className="text-xs text-white/60 whitespace-pre-wrap">
            ---{'\n'}
            {party.name}{'\n'}
            {party.date && `Date: ${formatEventDateLong(party)}\n`}
            {getLocationString(party) !== 'TBD' && `Location: ${getLocationString(party)}\n`}
            RSVP: {getRsvpUrl(party)}
          </div>
        </div>
      )}

      {/* No Guests Warning */}
      {filteredGuests.length === 0 && (
        <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
          <AlertCircle size={16} className="text-yellow-500 flex-shrink-0" />
          <span className="text-xs text-yellow-500/80">
            No guests with email addresses in this filter. Guests must provide an email when RSVPing.
          </span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopyBody}
          className="flex-1 flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
        >
          <Copy size={16} />
          Copy Email
        </button>

        <button
          type="button"
          onClick={handleOpenMailto}
          disabled={filteredGuests.length === 0}
          className="flex-1 flex items-center justify-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
        >
          <Mail size={16} />
          Open in Email App
        </button>
      </div>

      <p className="text-xs text-white/30 text-center">
        Opens your default email client with the message pre-filled.
        {filteredGuests.length > 50 && ' Only the first 50 recipients will be included in the mailto link.'}
      </p>
    </div>
  );
};
