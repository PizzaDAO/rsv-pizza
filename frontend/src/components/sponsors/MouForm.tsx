import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, FileSignature, Send, Save, Building2,
  User, Mail, Calendar, FileText, Clock, Loader2, AlertCircle
} from 'lucide-react';
import { IconInput } from '../IconInput';
import { Sponsor, Mou, CreateMouData, UpdateMouData } from '../../types';
import { createMou, updateMou, sendMou } from '../../lib/api';

interface MouFormProps {
  sponsor: Sponsor;
  partyId: string;
  existingMou?: Mou | null;
  onClose: () => void;
  onSave: (mou: Mou) => void;
  onSponsorUpdate?: (sponsor: Sponsor) => void;
}

const DEFAULT_MOU_BODY = `This Memorandum of Understanding ("MOU") outlines the mutual understanding between the parties regarding the sponsorship/partnership for the event.

1. Scope of Partnership
   - Describe the deliverables and commitments of each party.

2. Responsibilities
   - Host org responsibilities.
   - Partner responsibilities.

3. Term
   - This MOU is effective as of the effective date and remains in force for the duration described.

This MOU is a statement of intent and good-faith collaboration between the parties.`;

export function MouForm({ sponsor, partyId, existingMou, onClose, onSave }: MouFormProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  // Form state
  const [counterpartyCompany, setCounterpartyCompany] = useState(existingMou?.counterpartyCompany || sponsor.name || '');
  const [counterpartyContact, setCounterpartyContact] = useState(existingMou?.counterpartyContact || sponsor.contactName || '');
  const [counterpartyEmail, setCounterpartyEmail] = useState(existingMou?.counterpartyEmail || sponsor.contactEmail || '');
  const [ccEmails, setCcEmails] = useState(existingMou?.ccEmails?.join(', ') || '');
  const [title, setTitle] = useState(existingMou?.title || 'Memorandum of Understanding');
  const [bodyMarkdown, setBodyMarkdown] = useState(existingMou?.bodyMarkdown || DEFAULT_MOU_BODY);
  const [effectiveDate, setEffectiveDate] = useState(existingMou?.effectiveDate ? existingMou.effectiveDate.split('T')[0] : '');
  const [termText, setTermText] = useState(existingMou?.termText || '');

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const buildData = (): CreateMouData & UpdateMouData => ({
    sponsorId: sponsor.id,
    counterpartyCompany: counterpartyCompany.trim() || undefined,
    counterpartyContact: counterpartyContact.trim() || undefined,
    counterpartyEmail: counterpartyEmail.trim(),
    ccEmails: ccEmails.split(',').map(e => e.trim()).filter(Boolean),
    title: title.trim() || 'Memorandum of Understanding',
    bodyMarkdown: bodyMarkdown.trim(),
    effectiveDate: effectiveDate || undefined,
    termText: termText.trim() || undefined,
    attachments: existingMou?.attachments || [],
  });

  const handleSaveDraft = async () => {
    if (!counterpartyEmail.trim()) {
      setError('Recipient email is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const data = buildData();
      let result;

      if (existingMou) {
        result = await updateMou(partyId, existingMou.id, data);
      } else {
        result = await createMou(partyId, data);
      }

      if (result) {
        onSave(result.mou);
        onClose();
      } else {
        setError('Failed to save MOU');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save MOU');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendMou = async () => {
    if (!counterpartyEmail.trim()) {
      setError('Recipient email is required');
      return;
    }

    if (!bodyMarkdown.trim()) {
      setError('MOU body is required');
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      // Save first, then send
      const data = buildData();
      let mou: Mou;

      if (existingMou) {
        const updateResult = await updateMou(partyId, existingMou.id, data);
        if (!updateResult) {
          setError('Failed to save MOU');
          return;
        }
        mou = updateResult.mou;
      } else {
        const createResult = await createMou(partyId, data);
        if (!createResult) {
          setError('Failed to create MOU');
          return;
        }
        mou = createResult.mou;
      }

      // Send the MOU
      const isResend = existingMou?.status === 'issued' || existingMou?.status === 'viewed';
      const sendResult = await sendMou(partyId, mou.id, isResend);

      if (sendResult) {
        onSave(sendResult.mou);
        onClose();
      } else {
        setError('Failed to send MOU');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send MOU');
    } finally {
      setIsSending(false);
      setShowSendConfirm(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto py-8">
      <div ref={modalRef} className="bg-theme-header border border-theme-stroke rounded-xl w-full max-w-2xl mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
          <div className="flex items-center gap-2">
            <FileSignature size={20} className="text-theme-text-secondary" />
            <h2 className="text-lg font-semibold text-theme-text">
              {existingMou ? `Edit MOU #${existingMou.mouNumber}` : 'New MOU'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-theme-text-muted hover:text-theme-text rounded transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* Counterparty Section */}
          <div>
            <h3 className="text-sm font-medium text-theme-text-secondary mb-2">Counterparty</h3>
            <div className="space-y-2">
              <IconInput
                icon={Building2}
                value={counterpartyCompany}
                onChange={e => setCounterpartyCompany(e.target.value)}
                placeholder="Company / partner name"
              />
              <IconInput
                icon={User}
                value={counterpartyContact}
                onChange={e => setCounterpartyContact(e.target.value)}
                placeholder="Contact person"
              />
              <IconInput
                icon={Mail}
                type="email"
                value={counterpartyEmail}
                onChange={e => setCounterpartyEmail(e.target.value)}
                placeholder="Recipient email (who signs)"
                required
              />
              <IconInput
                icon={Mail}
                value={ccEmails}
                onChange={e => setCcEmails(e.target.value)}
                placeholder="CC emails, comma-separated"
              />
            </div>
          </div>

          {/* MOU Content */}
          <div>
            <h3 className="text-sm font-medium text-theme-text-secondary mb-2">MOU Details</h3>
            <div className="space-y-2">
              <IconInput
                icon={FileText}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="MOU title"
              />
              <IconInput
                icon={FileSignature}
                multiline
                rows={10}
                value={bodyMarkdown}
                onChange={(e: any) => setBodyMarkdown(e.target.value)}
                placeholder="MOU body / terms (markdown supported)"
              />
              <IconInput
                icon={Calendar}
                type="date"
                value={effectiveDate}
                onChange={e => setEffectiveDate(e.target.value)}
                placeholder="Effective date"
              />
              <IconInput
                icon={Clock}
                value={termText}
                onChange={e => setTermText(e.target.value)}
                placeholder="Term / duration (e.g. through Dec 31, 2026)"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-theme-stroke">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveDraft}
              disabled={isSaving || isSending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke text-theme-text rounded-lg transition-colors disabled:opacity-50"
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Draft
            </button>

            {!showSendConfirm ? (
              <button
                onClick={() => setShowSendConfirm(true)}
                disabled={isSaving || isSending}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#ff393a] hover:bg-[#ff393a]/80 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Send size={14} />
                Send MOU
              </button>
            ) : (
              <button
                onClick={handleSendMou}
                disabled={isSaving || isSending}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 animate-pulse"
              >
                {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Confirm Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
