import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Loader2, X, MessageSquare } from 'lucide-react';
import { IconInput } from '../IconInput';
import {
  OUTREACH_CHANNEL_LABELS,
  getTemplate,
  renderTemplate,
  type OutreachChannel,
} from '../../lib/outreachTemplates';
import { logOutreachAttempt, type OutreachCommunityRow } from '../../lib/api';

interface OutreachTemplateModalProps {
  community: OutreachCommunityRow;
  channel: OutreachChannel;
  senderName?: string | null;
  onClose: () => void;
  onLogged: () => void;
}

export function OutreachTemplateModal({
  community,
  channel,
  senderName,
  onClose,
  onLogged,
}: OutreachTemplateModalProps) {
  const template = useMemo(() => getTemplate(channel), [channel]);

  const rendered = useMemo(() => {
    if (!template) return { body: '', subject: undefined as string | undefined };
    return renderTemplate(template, {
      community_name: community.name,
      city: community.city,
      sender_name: senderName || undefined,
    });
  }, [template, community, senderName]);

  const [notes, setNotes] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'body' | 'subject'>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (copyState === 'idle') return;
    const t = setTimeout(() => setCopyState('idle'), 2000);
    return () => clearTimeout(t);
  }, [copyState]);

  if (!template) return null;

  const handleCopyBody = async () => {
    try {
      await navigator.clipboard.writeText(rendered.body);
      setCopyState('body');
    } catch {
      // ignore — user can manually select
    }
  };

  const handleCopySubject = async () => {
    if (!rendered.subject) return;
    try {
      await navigator.clipboard.writeText(rendered.subject);
      setCopyState('subject');
    } catch {
      // ignore
    }
  };

  const handleMarkSent = async () => {
    setSaving(true);
    setError(null);
    try {
      await logOutreachAttempt({
        communityId: community.id,
        channel,
        templateId: template.id,
        notes: notes.trim() || undefined,
      });
      onLogged();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to log attempt');
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-theme-text flex items-center gap-2">
              <MessageSquare size={18} />
              Outreach template — {OUTREACH_CHANNEL_LABELS[channel]}
            </h3>
            <p className="text-sm text-theme-text-muted mt-1">
              {community.name} · {community.city}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-theme-text-faint hover:text-theme-text-secondary"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {rendered.subject && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-theme-text-muted">Subject</span>
              <button
                type="button"
                onClick={handleCopySubject}
                className="inline-flex items-center gap-1 text-xs text-theme-text-secondary hover:text-theme-text"
              >
                {copyState === 'subject' ? <Check size={14} /> : <Copy size={14} />}
                {copyState === 'subject' ? 'Copied' : 'Copy subject'}
              </button>
            </div>
            <div className="px-3 py-2 rounded-lg bg-theme-surface border border-theme-stroke text-sm text-theme-text font-mono">
              {rendered.subject}
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wide text-theme-text-muted">Message</span>
            <button
              type="button"
              onClick={handleCopyBody}
              className="inline-flex items-center gap-1 text-xs text-theme-text-secondary hover:text-theme-text"
            >
              {copyState === 'body' ? <Check size={14} /> : <Copy size={14} />}
              {copyState === 'body' ? 'Copied' : 'Copy to clipboard'}
            </button>
          </div>
          <textarea
            readOnly
            value={rendered.body}
            rows={Math.max(6, rendered.body.split('\n').length + 1)}
            className="w-full px-3 py-2 rounded-lg bg-theme-surface border border-theme-stroke text-sm text-theme-text font-mono resize-y"
          />
        </div>

        <div className="mb-4">
          <IconInput
            multiline
            rows={2}
            placeholder="Notes (optional, internal only)..."
            value={notes}
            onChange={(e: any) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-theme-text-secondary hover:text-theme-text disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleMarkSent}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold inline-flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Mark as sent
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
