import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Mail, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { IconInput } from '../components/IconInput';

export function LoginPage() {
  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      const returnUrl = sessionStorage.getItem('authReturnUrl') || '/';
      sessionStorage.removeItem('authReturnUrl');
      navigate(returnUrl);
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signIn(email);
      // Store whether this is a new user (no name set) for the verify page
      if (result.isNewUser) {
        sessionStorage.setItem('isNewUser', 'true');
      } else {
        sessionStorage.removeItem('isNewUser');
      }
      // Navigate directly to code entry
      navigate('/auth/verify');
    } catch (err: any) {
      setError(err.message || 'Failed to send login code');
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="card p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white mb-2">Log In or Sign Up</h1>
            <p className="text-white/60 text-sm">
              Enter your email to receive a login code.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <IconInput
              icon={Mail}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              autoFocus
            />

            {error && (
              <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail size={18} />
                  Continue
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </Layout>
  );
}
