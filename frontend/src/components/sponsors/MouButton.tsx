import React, { useState } from 'react';
import {
  FileSignature, Check, Clock, ExternalLink, Copy, Send, Trash2,
  Loader2,
} from 'lucide-react';
import { Sponsor, Mou } from '../../types';
import { sendMou, deleteMou } from '../../lib/api';
import { MouForm } from './MouForm';

interface MouButtonProps {
  sponsor: Sponsor;
  partyId: string;
  mou?: Mou | null;
  onMouUpdate: (mou: Mou) => void;
  onMouDelete?: (mouId: string) => void;
  onSponsorUpdate: (sponsor: Sponsor) => void;
}

export function MouButton({ sponsor, partyId, mou, onMouUpdate, onMouDelete, onSponsorUpdate }: MouButtonProps) {
  const [showForm, setShowForm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const mouUrl = mou?.viewToken
    ? `https://rsv.pizza/mou/${mou.viewToken}`
    : null;

  const handleCopyUrl = async () => {
    if (!mouUrl) return;
    try {
      await navigator.clipboard.writeText(mouUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = mouUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleResend = async () => {
    if (!mou) return;
    setLoading(true);
    try {
      const result = await sendMou(partyId, mou.id, true);
      if (result) {
        onMouUpdate(result.mou);
      }
    } catch (err) {
      console.error('Failed to resend MOU:', err);
    } finally {
      setLoading(false);
      setShowMenu(false);
    }
  };

  const handleDelete = async () => {
    if (!mou) return;
    setLoading(true);
    try {
      const ok = await deleteMou(partyId, mou.id);
      if (ok) {
        onMouDelete?.(mou.id);
      }
    } catch (err) {
      console.error('Failed to delete MOU:', err);
    } finally {
      setLoading(false);
      setShowMenu(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-white/40">
        <Loader2 size={12} className="animate-spin" />
      </span>
    );
  }

  // No MOU yet
  if (!mou) {
    return (
      <>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-theme-text-muted hover:text-theme-text bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke rounded transition-colors"
          title="Create MOU for this partner"
        >
          <FileSignature size={12} />
          MOU
        </button>
        {showForm && (
          <MouForm
            sponsor={sponsor}
            partyId={partyId}
            onClose={() => setShowForm(false)}
            onSave={(m) => {
              onMouUpdate(m);
              setShowForm(false);
            }}
            onSponsorUpdate={onSponsorUpdate}
          />
        )}
      </>
    );
  }

  // Draft MOU
  if (mou.status === 'draft') {
    return (
      <>
        <div className="relative inline-flex items-center gap-1">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-yellow-300 bg-yellow-500/20 rounded cursor-pointer hover:bg-yellow-500/30 transition-colors"
            title="Edit draft MOU"
          >
            <Clock size={12} />
            MOU Draft
          </button>
          {showMenu && (
            <div className="absolute top-full right-0 mt-1 z-10 bg-theme-header border border-theme-stroke rounded-lg shadow-lg py-1 min-w-[140px]">
              <button
                onClick={() => { setShowMenu(false); setShowForm(true); }}
                className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
              >
                <FileSignature size={12} />
                Edit MOU
              </button>
              <button
                onClick={handleDelete}
                className="w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          )}
          {showMenu && (
            <div className="fixed inset-0 z-[5]" onClick={() => setShowMenu(false)} />
          )}
        </div>
        {showForm && (
          <MouForm
            sponsor={sponsor}
            partyId={partyId}
            existingMou={mou}
            onClose={() => setShowForm(false)}
            onSave={(m) => {
              onMouUpdate(m);
              setShowForm(false);
            }}
            onSponsorUpdate={onSponsorUpdate}
          />
        )}
      </>
    );
  }

  // Signed MOU
  if (mou.status === 'signed') {
    return (
      <div className="relative inline-flex items-center gap-1">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-green-300 bg-green-500/20 rounded cursor-pointer hover:bg-green-500/30 transition-colors"
          title={`Signed${mou.signerName ? ` by ${mou.signerName}` : ''}`}
        >
          <Check size={12} />
          MOU Signed
        </button>
        {showMenu && (
          <div className="absolute top-full right-0 mt-1 z-10 bg-theme-header border border-theme-stroke rounded-lg shadow-lg py-1 min-w-[140px]">
            {mouUrl && (
              <button
                onClick={() => { window.open(mouUrl, '_blank'); setShowMenu(false); }}
                className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
              >
                <ExternalLink size={12} />
                View MOU
              </button>
            )}
            <button
              onClick={handleCopyUrl}
              className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
            >
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
        )}
        {showMenu && (
          <div className="fixed inset-0 z-[5]" onClick={() => setShowMenu(false)} />
        )}
      </div>
    );
  }

  // Issued or viewed MOU
  return (
    <div className="relative inline-flex items-center gap-1">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-blue-300 bg-blue-500/20 rounded cursor-pointer hover:bg-blue-500/30 transition-colors"
        title={mou.status === 'viewed' ? 'MOU viewed by recipient' : 'MOU sent'}
      >
        <FileSignature size={12} />
        {mou.status === 'viewed' ? 'MOU Viewed' : 'MOU Issued'}
      </button>
      {showMenu && (
        <div className="absolute top-full right-0 mt-1 z-10 bg-theme-header border border-theme-stroke rounded-lg shadow-lg py-1 min-w-[160px]">
          {mouUrl && (
            <button
              onClick={() => { window.open(mouUrl, '_blank'); setShowMenu(false); }}
              className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
            >
              <ExternalLink size={12} />
              View MOU
            </button>
          )}
          <button
            onClick={handleCopyUrl}
            className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <button
            onClick={handleResend}
            className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
          >
            <Send size={12} />
            Resend
          </button>
          <button
            onClick={() => { setShowMenu(false); setShowForm(true); }}
            className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
          >
            <FileSignature size={12} />
            Edit MOU
          </button>
        </div>
      )}
      {showMenu && (
        <div className="fixed inset-0 z-[5]" onClick={() => setShowMenu(false)} />
      )}

      {/* Edit form */}
      {showForm && (
        <MouForm
          sponsor={sponsor}
          partyId={partyId}
          existingMou={mou}
          onClose={() => setShowForm(false)}
          onSave={(m) => {
            onMouUpdate(m);
            setShowForm(false);
          }}
          onSponsorUpdate={onSponsorUpdate}
        />
      )}
    </div>
  );
}
