import React, { useState } from 'react';
import { Link2, Copy, Check, X, Clock, CheckCircle, Loader2 } from 'lucide-react';
import { Sponsor } from '../../types';
import { generateSponsorIntakeToken, revokeSponsorIntakeToken } from '../../lib/api';

interface SponsorIntakeButtonProps {
  sponsor: Sponsor;
  partyId: string;
  onUpdate: (sponsor: Sponsor) => void;
}

export function SponsorIntakeButton({ sponsor, partyId, onUpdate }: SponsorIntakeButtonProps) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const intakeUrl = sponsor.intakeToken
    ? `https://rsv.pizza/sponsor-intake/${sponsor.intakeToken}`
    : null;

  const handleGenerateToken = async () => {
    setLoading(true);
    try {
      const result = await generateSponsorIntakeToken(partyId, sponsor.id);
      if (result) {
        onUpdate({
          ...sponsor,
          intakeToken: result.token,
        });
        // Auto copy the URL
        await navigator.clipboard.writeText(result.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.error('Failed to generate intake token:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!intakeUrl) return;
    try {
      await navigator.clipboard.writeText(intakeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = intakeUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRevoke = async () => {
    setLoading(true);
    try {
      const success = await revokeSponsorIntakeToken(partyId, sponsor.id);
      if (success) {
        onUpdate({
          ...sponsor,
          intakeToken: null,
          intakeSubmittedAt: null,
        });
      }
    } catch (err) {
      console.error('Failed to revoke intake token:', err);
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

  // No token yet — show generate button
  if (!sponsor.intakeToken) {
    return (
      <button
        onClick={handleGenerateToken}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-theme-text-muted hover:text-theme-text bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke rounded transition-colors"
        title="Generate intake form link"
      >
        <Link2 size={12} />
        Intake Link
      </button>
    );
  }

  // Token exists, submitted
  if (sponsor.intakeSubmittedAt) {
    const submittedDate = new Date(sponsor.intakeSubmittedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    return (
      <div className="relative inline-flex items-center gap-1">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-green-300 bg-green-500/20 rounded cursor-pointer hover:bg-green-500/30 transition-colors"
          title={`Submitted ${submittedDate}`}
        >
          <CheckCircle size={12} />
          Submitted
        </button>
        {showMenu && (
          <div className="absolute top-full right-0 mt-1 z-10 bg-theme-header border border-theme-stroke rounded-lg shadow-lg py-1 min-w-[140px]">
            <button
              onClick={handleCopyUrl}
              className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
            >
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <button
              onClick={handleRevoke}
              className="w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
            >
              <X size={12} />
              Revoke Link
            </button>
          </div>
        )}
        {/* Click outside to close */}
        {showMenu && (
          <div
            className="fixed inset-0 z-[5]"
            onClick={() => setShowMenu(false)}
          />
        )}
      </div>
    );
  }

  // Token exists, not yet submitted — show pending with copy
  return (
    <div className="relative inline-flex items-center gap-1">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-yellow-300 bg-yellow-500/20 rounded cursor-pointer hover:bg-yellow-500/30 transition-colors"
        title="Intake link sent, awaiting response"
      >
        <Clock size={12} />
        Pending
      </button>
      {showMenu && (
        <div className="absolute top-full right-0 mt-1 z-10 bg-theme-header border border-theme-stroke rounded-lg shadow-lg py-1 min-w-[140px]">
          <button
            onClick={handleCopyUrl}
            className="w-full px-3 py-1.5 text-xs text-left text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface transition-colors flex items-center gap-2"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <button
            onClick={handleRevoke}
            className="w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
          >
            <X size={12} />
            Revoke Link
          </button>
        </div>
      )}
      {/* Click outside to close */}
      {showMenu && (
        <div
          className="fixed inset-0 z-[5]"
          onClick={() => setShowMenu(false)}
        />
      )}
    </div>
  );
}
