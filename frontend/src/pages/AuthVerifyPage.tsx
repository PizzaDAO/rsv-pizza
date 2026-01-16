import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3006';

export function AuthVerifyPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setError('No token provided');
      return;
    }

    async function verify() {
      try {
        const response = await fetch(`${API_URL}/api/auth/verify?token=${token}`);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Verification failed');
        }

        const data = await response.json();

        // Store token and user
        localStorage.setItem('authToken', data.accessToken);
        localStorage.setItem('user', JSON.stringify(data.user));
        setUser(data.user);

        setStatus('success');

        // Redirect to home after 2 seconds
        setTimeout(() => {
          navigate('/');
        }, 2000);
      } catch (err: any) {
        setStatus('error');
        setError(err.message || 'Failed to verify magic link');
      }
    }

    verify();
  }, [searchParams, navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card p-8 max-w-md w-full text-center">
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
            <button
              onClick={() => navigate('/')}
              className="btn-primary"
            >
              Go to Home
            </button>
          </>
        )}
      </div>
    </div>
  );
}
