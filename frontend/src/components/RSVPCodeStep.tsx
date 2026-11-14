import React, { useState } from 'react';
import { KeyRound, Loader2, X } from 'lucide-react';
import { IconInput } from './IconInput';
import { useAuth } from '../contexts/AuthContext';
import type { useRSVPForm } from '../hooks/useRSVPForm';

interface RSVPCodeStepProps {
  form: ReturnType<typeof useRSVPForm>;
  onClose: () => void;
}

/**
 * invite-verify: inline 6-digit code step of the RSVP form. Shown when the submitted email
 * is already on the event (RSVP'd or invited) and this browser can't prove it's theirs.
 * The code is the normal sign-in code; entering it signs the browser in as that email and
 * the same answers are re-submitted, so an invitee completes their invite and an existing
 * guest updates their RSVP without leaving the form.
 */
export function RSVPCodeStep({ form, onClose }: RSVPCodeStepProps) {
  const { user, setUser } = useAuth();
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const email = form.verificationEmail || '';
  const signedInElsewhere = !!user?.email && user.email.trim().toLowerCase() !== email.toLowerCase();
  const busy = form.verifyingCode || form.submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await form.verifyCode(code, (u) => setUser({ ...u, name: u.name ?? undefined }));
  };

  const resend = async () => {
    setCode('');
    await form.resendCode();
    setResent(true);
  };

  return (
    <div className="card p-8 max-w-md w-full relative" data-testid="rsvp-code-step">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
        aria-label="Close"
      >
        <X size={24} />
      </button>

      <h1 className="text-2xl font-bold text-theme-text mb-2">Check your email</h1>
      <p className="text-theme-text-secondary mb-1">
        This email is already on the guest list. We sent a code to <strong className="text-theme-text">{email}</strong>.
      </p>
      <p className="text-xs text-theme-text-muted mb-5">
        Enter it to confirm it&apos;s you and save your RSVP.
      </p>

      <form onSubmit={submit} className="space-y-3">
        <IconInput
          icon={KeyRound}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="6-digit code"
          aria-label="6-digit code"
          value={code}
          onChange={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))}
          autoFocus
        />
        {form.codeError && (
          <p className="text-sm text-[#ff393a]" role="alert">{form.codeError}</p>
        )}
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          Confirm & RSVP
        </button>
      </form>

      <p className="text-xs text-theme-text-muted mt-3">
        {signedInElsewhere
          ? `Entering the code signs you in as ${email} instead of ${user!.email}.`
          : `Entering the code signs you in as ${email}.`}
      </p>

      <div className="flex items-center justify-between mt-4 text-sm">
        <button
          type="button"
          onClick={resend}
          disabled={busy}
          className="text-theme-text-secondary hover:text-theme-text underline disabled:opacity-50"
        >
          Send a new code
        </button>
        <button
          type="button"
          onClick={form.cancelCodeStep}
          disabled={busy}
          className="text-theme-text-secondary hover:text-theme-text underline disabled:opacity-50"
        >
          Use a different email
        </button>
      </div>
      {resent && (
        <p className="text-xs text-theme-text-muted mt-2">
          A new code is on its way unless one was sent just now. Codes last 15 minutes.
        </p>
      )}
    </div>
  );
}
