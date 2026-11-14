import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, AlertCircle, Check, Mail, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { IconInput } from '../components/IconInput';
import { Layout } from '../components/Layout';
import { sanitizeNextPath } from '../lib/wallet/handoff';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3006';

export function AuthVerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser, signOut } = useAuth();
  const { t } = useTranslation('auth');
  const [status, setStatus] = useState<'idle' | 'confirm' | 'verifying' | 'name_prompt' | 'saving_name' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [lastSubmittedCode, setLastSubmittedCode] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [name, setName] = useState('');
  const [pendingAuthData, setPendingAuthData] = useState<any>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  // Captured once at first render: the sign-in token (email link / wallet hand-off) and the
  // local `next` path. The token is stripped from the address bar immediately (see effect).
  const initialParams = useRef(new URLSearchParams(location.search));
  const tokenRedeemStarted = useRef(false);
  const redirectTimer = useRef<number | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const signedInAsRef = useRef<string | null>(null);

  const pendingToken = useRef<string | null>(null);
  const nextPath = () => sanitizeNextPath(initialParams.current.get('next'));
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  // Single-use token in the URL (wallet hand-off or emailed magic link). It is NEVER redeemed
  // automatically: anyone can mint a token for their own account and send the link to someone
  // else (login CSRF). So we (1) skip it entirely if this browser is already signed in,
  // (2) look up the account email without spending the token, and (3) require an explicit tap.
  useEffect(() => {
    const token = initialParams.current.get('token');
    if (!token || tokenRedeemStarted.current) return;
    tokenRedeemStarted.current = true;
    // Remove the token from the URL/history right away so it can't leak via the address bar.
    navigate(location.pathname, { replace: true });

    let alreadySignedIn = false;
    try { alreadySignedIn = !!localStorage.getItem('authToken'); } catch { /* storage blocked */ }
    if (alreadySignedIn) {
      navigate(nextPath() || '/', { replace: true });
      return;
    }

    setStatus('verifying');
    (async () => {
      try {
        const response = await fetch(`${API_URL}/api/auth/verify?token=${encodeURIComponent(token)}`);
        if (!response.ok) throw new Error('invalid');
        const data = await response.json();
        pendingToken.current = token;
        setConfirmEmail(data.email);
        setStatus('confirm');
      } catch {
        setStatus('error');
        setError(t('verifyPage.linkExpired', {
          defaultValue: 'This sign-in link has expired or was already used. Enter a code from your email, or request a new one.',
        }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmRedeem() {
    const token = pendingToken.current;
    if (!token) return;
    pendingToken.current = null;
    setStatus('verifying');
    try {
      const response = await fetch(`${API_URL}/api/auth/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error('invalid');
      const data = await response.json();
      // Always the account email, never the display name (which anyone can set).
      signedInAsRef.current = data.user?.email || null;
      setSignedInAs(signedInAsRef.current);
      handleSuccess(data);
    } catch {
      setStatus('error');
      setError(t('verifyPage.linkExpired', {
        defaultValue: 'This sign-in link has expired or was already used. Enter a code from your email, or request a new one.',
      }));
    }
  }

  // Check if this is a new user on mount
  useEffect(() => {
    const newUser = sessionStorage.getItem('isNewUser') === 'true';
    setIsNewUser(newUser);
    inputRefs.current[0]?.focus();
  }, []);

  async function verifyCode(fullCode: string) {
    setStatus('verifying');
    setLastSubmittedCode(fullCode);
    try {
      const response = await fetch(`${API_URL}/api/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: fullCode }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Invalid code');
      }

      const data = await response.json();
      sessionStorage.removeItem('isNewUser');

      // If new user, prompt for name before completing
      if (isNewUser) {
        setPendingAuthData(data);
        // Store token so the name update call is authenticated
        localStorage.setItem('authToken', data.accessToken);
        setStatus('name_prompt');
        setTimeout(() => nameInputRef.current?.focus(), 100);
      } else {
        handleSuccess(data);
      }
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Failed to verify code');
    }
  }

  async function handleNameSubmit() {
    if (!name.trim() || !pendingAuthData) return;
    setStatus('saving_name');
    try {
      const response = await fetch(`${API_URL}/api/user/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pendingAuthData.accessToken}`,
        },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (response.ok) {
        const { user } = await response.json();
        pendingAuthData.user = user;
      }
    } catch {
      // Name update failed but auth succeeded — continue anyway
    }
    handleSuccess(pendingAuthData);
  }

  function handleSuccess(data: any) {
    // Store token and user
    localStorage.setItem('authToken', data.accessToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);

    setStatus('success');

    // Redirect to ?next= (local paths only), else the stored return URL, else home.
    // Hand-off sign-ins stay on the confirmation screen (showing the account email) until the user continues.
    if (signedInAsRef.current) return;
    redirectTimer.current = window.setTimeout(() => {
      const nextParam = sanitizeNextPath(initialParams.current.get('next'));
      const returnUrl = sessionStorage.getItem('authReturnUrl');
      sessionStorage.removeItem('authReturnUrl');
      navigate(nextParam || returnUrl || '/');
    }, 2000);
  }

  function handleCodeChange(index: number, value: string) {
    // Only allow digits
    if (value && !/^\d$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (value && index === 5) {
      const fullCode = newCode.join('');
      if (fullCode.length === 6) {
        verifyCode(fullCode);
      }
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    // Handle backspace
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData.length === 6) {
      const newCode = pastedData.split('');
      setCode(newCode);
      verifyCode(pastedData);
    }
  }

  function handleEnterNewCode() {
    setStatus('idle');
    setError(null);
    setCode(['', '', '', '', '', '']);
    setLastSubmittedCode(null);
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }

  return (
    <Layout>
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="card p-8 max-w-md w-full text-center">
        {status === 'idle' && (
          <>
            <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
              <Mail className="w-8 h-8 text-[#ff393a]" />
            </div>
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('verifyPage.title')}</h1>
            <p className="text-theme-text-secondary mb-6">{t('verifyPage.subtitle')}</p>

            <div className="flex justify-center gap-2 mb-6" onPaste={handlePaste}>
              {code.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (inputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className="w-12 h-14 text-center text-2xl font-bold bg-theme-surface border border-theme-stroke-hover rounded-lg text-theme-text focus:outline-none focus:border-[#ff393a] focus:ring-1 focus:ring-[#ff393a] transition-all"
                  autoFocus={index === 0}
                  data-testid={`verify-code-${index}`}
                />
              ))}
            </div>

            <p className="text-theme-text-muted text-sm">
              {t('verifyPage.didntReceive')}{' '}
              <button
                onClick={() => navigate('/login')}
                className="text-[#ff393a] hover:underline"
              >
                {t('verifyPage.requestNew')}
              </button>
            </p>
          </>
        )}

        {status === 'confirm' && (
          <>
            <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
              <User className="w-8 h-8 text-[#ff393a]" />
            </div>
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('verifyPage.confirmTitle', { defaultValue: 'Continue to sign in' })}</h1>
            <p className="text-theme-text-secondary mb-6 break-all">
              {t('verifyPage.continueAs', { defaultValue: 'Continue as' })} <strong>{confirmEmail}</strong>
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={confirmRedeem} className="btn-primary">
                {t('verifyPage.continueToSignIn', { defaultValue: 'Continue to sign in' })}
              </button>
              <button onClick={() => navigate(nextPath() || '/', { replace: true })} className="btn-secondary">
                {t('verifyPage.continueWithout', { defaultValue: 'Continue without signing in' })}
              </button>
            </div>
          </>
        )}

        {status === 'verifying' && (
          <>
            <Loader2 className="w-16 h-16 animate-spin text-[#ff393a] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('verifyPage.verifying')}</h1>
            <p className="text-theme-text-secondary">{t('verifyPage.pleaseWait')}</p>
          </>
        )}

        {(status === 'name_prompt' || status === 'saving_name') && (
          <>
            <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
              <User className="w-8 h-8 text-[#ff393a]" />
            </div>
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('verifyPage.completeProfile')}</h1>
            <p className="text-theme-text-secondary mb-6">{t('verifyPage.whatToCallYou')}</p>
            <div className="mb-4">
              <IconInput
                ref={nameInputRef}
                icon={User}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('verifyPage.namePlaceholder')}
                disabled={status === 'saving_name'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) {
                    handleNameSubmit();
                  }
                }}
              />
            </div>
            <button
              onClick={handleNameSubmit}
              disabled={!name.trim() || status === 'saving_name'}
              className="btn-primary w-full"
            >
              {status === 'saving_name' ? t('verifyPage.saving') : t('verifyPage.continue')}
            </button>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#39d98a]/30">
              <Check className="w-8 h-8 text-[#39d98a]" />
            </div>
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('verifyPage.welcomeBack')}</h1>
            {!signedInAs && <p className="text-theme-text-secondary">{t('verifyPage.redirecting')}</p>}
            {signedInAs && (
              <button
                type="button"
                className="btn-primary mt-4"
                onClick={() => navigate(nextPath() || '/', { replace: true })}
              >
                {t('verifyPage.continue')}
              </button>
            )}
            {signedInAs && (
              <p className="text-theme-text-muted text-sm mt-4 break-all">
                {t('verifyPage.signedInAs', { defaultValue: 'Signed in as' })} {signedInAs}
                {' \u2014 '}
                <button
                  type="button"
                  className="text-[#ff393a] hover:underline"
                  onClick={() => {
                    if (redirectTimer.current) window.clearTimeout(redirectTimer.current);
                    signOut();
                    setSignedInAs(null);
                    signedInAsRef.current = null;
                    navigate('/login');
                  }}
                >
                  {t('verifyPage.notYou', { defaultValue: 'not you? Sign out' })}
                </button>
              </p>
            )}
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('verifyPage.verificationFailed')}</h1>
            <p className="text-theme-text-secondary mb-6">{error}</p>
            <div className="flex flex-col gap-3">
              {initialParams.current.has('next') || initialParams.current.has('token') ? (
                <button
                  onClick={() => navigate(nextPath() || '/', { replace: true })}
                  className="btn-primary"
                >
                  {t('verifyPage.continueWithout', { defaultValue: 'Continue without signing in' })}
                </button>
              ) : null}
              <button
                onClick={handleEnterNewCode}
                className="btn-primary"
              >
                {t('verifyPage.enterDifferentCode')}
              </button>
              <button
                onClick={() => navigate('/login')}
                className="btn-secondary"
              >
                {t('verifyPage.requestNewCode')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
    </Layout>
  );
}
