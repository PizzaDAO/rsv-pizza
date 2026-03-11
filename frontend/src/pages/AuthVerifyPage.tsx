import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, Check, Mail, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { IconInput } from '../components/IconInput';
import { Layout } from '../components/Layout';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3006';

export function AuthVerifyPage() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [status, setStatus] = useState<'idle' | 'verifying' | 'name_prompt' | 'saving_name' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [lastSubmittedCode, setLastSubmittedCode] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [name, setName] = useState('');
  const [pendingAuthData, setPendingAuthData] = useState<any>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

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

    // Redirect to stored return URL or /host/ after 2 seconds
    setTimeout(() => {
      const returnUrl = sessionStorage.getItem('authReturnUrl');
      sessionStorage.removeItem('authReturnUrl');
      navigate(returnUrl || '/');
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
            <h1 className="text-2xl font-bold text-theme-text mb-2">Enter Your Code</h1>
            <p className="text-theme-text-secondary mb-6">We sent a 6-digit code to your email</p>

            <div className="flex justify-center gap-2 mb-6" onPaste={handlePaste}>
              {code.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (inputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className="w-12 h-14 text-center text-2xl font-bold bg-theme-surface border border-theme-stroke-hover rounded-lg text-theme-text focus:outline-none focus:border-[#ff393a] focus:ring-1 focus:ring-[#ff393a] transition-all"
                  autoFocus={index === 0}
                />
              ))}
            </div>

            <p className="text-theme-text-muted text-sm">
              Didn't receive a code?{' '}
              <button
                onClick={() => navigate('/login')}
                className="text-[#ff393a] hover:underline"
              >
                Request a new code
              </button>
            </p>
          </>
        )}

        {status === 'verifying' && (
          <>
            <Loader2 className="w-16 h-16 animate-spin text-[#ff393a] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-theme-text mb-2">Verifying...</h1>
            <p className="text-theme-text-secondary">Please wait while we sign you in</p>
          </>
        )}

        {(status === 'name_prompt' || status === 'saving_name') && (
          <>
            <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
              <User className="w-8 h-8 text-[#ff393a]" />
            </div>
            <h1 className="text-2xl font-bold text-theme-text mb-2">Complete Your Profile</h1>
            <p className="text-theme-text-secondary mb-6">What should we call you?</p>
            <div className="mb-4">
              <IconInput
                ref={nameInputRef}
                icon={User}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
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
              {status === 'saving_name' ? 'Saving...' : 'Continue'}
            </button>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#39d98a]/30">
              <Check className="w-8 h-8 text-[#39d98a]" />
            </div>
            <h1 className="text-2xl font-bold text-theme-text mb-2">Welcome back!</h1>
            <p className="text-theme-text-secondary">Redirecting you to the app...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-theme-text mb-2">Verification Failed</h1>
            <p className="text-theme-text-secondary mb-6">{error}</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleEnterNewCode}
                className="btn-primary"
              >
                Enter Different Code
              </button>
              <button
                onClick={() => navigate('/login')}
                className="btn-secondary"
              >
                Request New Code
              </button>
            </div>
          </>
        )}
      </div>
    </div>
    </Layout>
  );
}
