import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, Check, Mail, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3006';

export function AuthVerifyPage() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [lastSubmittedCode, setLastSubmittedCode] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [name, setName] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Check if this is a new user on mount
  useEffect(() => {
    const newUser = sessionStorage.getItem('isNewUser') === 'true';
    setIsNewUser(newUser);
    // Focus name input if new user, otherwise focus code input
    if (newUser) {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    } else {
      inputRefs.current[0]?.focus();
    }
  }, []);

  async function verifyCode(fullCode: string) {
    // Validate name for new users
    if (isNewUser && !name.trim()) {
      setStatus('error');
      setError('Please enter your name');
      return;
    }

    setStatus('verifying');
    setLastSubmittedCode(fullCode);
    try {
      const response = await fetch(`${API_URL}/api/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: fullCode,
          ...(isNewUser && name.trim() && { name: name.trim() }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Invalid code');
      }

      const data = await response.json();
      // Clean up session storage
      sessionStorage.removeItem('isNewUser');
      handleSuccess(data);
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Failed to verify code');
    }
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

  function handleRetry() {
    if (lastSubmittedCode) {
      // Resubmit the same code
      verifyCode(lastSubmittedCode);
    } else {
      // Fallback: reset to idle state
      setStatus('idle');
      setError(null);
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    }
  }

  function handleEnterNewCode() {
    setStatus('idle');
    setError(null);
    setCode(['', '', '', '', '', '']);
    setLastSubmittedCode(null);
    inputRefs.current[0]?.focus();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card p-8 max-w-md w-full text-center">
        {status === 'idle' && (
          <>
            <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
              <Mail className="w-8 h-8 text-[#ff393a]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              {isNewUser ? 'Complete Your Profile' : 'Enter Your Code'}
            </h1>
            <p className="text-white/60 mb-6">
              {isNewUser
                ? 'Enter your name and the 6-digit code we sent'
                : 'We sent a 6-digit code to your email'}
            </p>

            {isNewUser && (
              <div className="relative mb-4">
                <User size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                <input
                  ref={nameInputRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-[#ff393a] focus:ring-1 focus:ring-[#ff393a] transition-all"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) {
                      inputRefs.current[0]?.focus();
                    }
                  }}
                />
              </div>
            )}

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
                  className="w-12 h-14 text-center text-2xl font-bold bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:border-[#ff393a] focus:ring-1 focus:ring-[#ff393a] transition-all"
                  autoFocus={!isNewUser && index === 0}
                />
              ))}
            </div>

            <p className="text-white/40 text-sm">
              Didn't receive a code?{' '}
              <button
                onClick={() => navigate('/')}
                className="text-[#ff393a] hover:underline"
              >
                Try again
              </button>
            </p>
          </>
        )}

        {status === 'verifying' && (
          <>
            <Loader2 className="w-16 h-16 animate-spin text-[#ff393a] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Verifying...</h1>
            <p className="text-white/60">Please wait while we sign you in</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#39d98a]/30">
              <Check className="w-8 h-8 text-[#39d98a]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Welcome back!</h1>
            <p className="text-white/60">Redirecting you to the app...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Verification Failed</h1>
            <p className="text-white/60 mb-6">{error}</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleRetry}
                className="btn-primary"
              >
                Try Again
              </button>
              <button
                onClick={handleEnterNewCode}
                className="btn-secondary"
              >
                Enter New Code
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
