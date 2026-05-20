import React, { useState } from 'react';
import { Send, Megaphone, Loader2, MessageCircle, Mail } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { sendDayOfAnnouncement, AnnounceResponse } from '../../lib/api';

interface AnnouncePanelProps {
  partyId: string;
  onSent?: (res: AnnounceResponse) => void;
}

/**
 * Day-of broadcast composer. Sends to Telegram (host's connected chat) and/or
 * Email (individual confirmed guests). No confirm modal — reversible enough
 * via not re-sending. Audit row is always persisted.
 */
export const AnnouncePanel: React.FC<AnnouncePanelProps> = ({ partyId, onSent }) => {
  const [telegramOn, setTelegramOn] = useState(true);
  const [emailOn, setEmailOn] = useState(true);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<AnnounceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSend =
    body.trim().length > 0 &&
    (telegramOn || emailOn) &&
    (!emailOn || subject.trim().length > 0);

  const handleSend = async () => {
    if (!canSend || sending) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const channels: Array<'telegram' | 'email'> = [];
      if (telegramOn) channels.push('telegram');
      if (emailOn) channels.push('email');
      const res = await sendDayOfAnnouncement(partyId, {
        subject: subject.trim() || undefined,
        body: body.trim(),
        channels,
      });
      setResult(res);
      setBody('');
      setSubject('');
      onSent?.(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to send announcement');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Megaphone size={18} className="text-[#ff393a]" />
        <h3 className="text-lg font-semibold text-theme-text">Announce</h3>
      </div>

      <div className="flex flex-wrap gap-4">
        <Checkbox
          checked={telegramOn}
          onChange={() => setTelegramOn((v) => !v)}
          label="Telegram"
        >
          <MessageCircle size={14} className="text-theme-text-muted ml-1" />
        </Checkbox>
        <Checkbox
          checked={emailOn}
          onChange={() => setEmailOn((v) => !v)}
          label="Email"
        >
          <Mail size={14} className="text-theme-text-muted ml-1" />
        </Checkbox>
      </div>

      {emailOn && (
        <IconInput
          icon={Mail}
          placeholder="Subject (required for email)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      )}

      <IconInput
        icon={Megaphone}
        multiline
        rows={5}
        placeholder="Message to send your guests…"
        value={body}
        onChange={(e) => setBody((e.target as HTMLTextAreaElement).value)}
      />

      {body && (
        <div className="text-xs text-theme-text-muted bg-white/5 rounded p-3 whitespace-pre-line border border-white/10">
          <p className="uppercase tracking-wide mb-1 text-[10px]">Preview</p>
          {subject && <p className="font-semibold text-theme-text mb-1">{subject}</p>}
          {body}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className="text-sm text-green-400 bg-green-500/5 border border-green-500/20 rounded p-3">
          Sent — Telegram: {result.channelsSent.telegram ? 'delivered' : 'skipped'}, Email:{' '}
          {result.channelsSent.email}/{result.recipientCount}
        </div>
      )}

      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend || sending}
        className="w-full bg-[#ff393a] text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {sending ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Send size={16} />
            Send announcement
          </>
        )}
      </button>
    </div>
  );
};
