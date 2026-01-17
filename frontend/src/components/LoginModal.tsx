import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Mail, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { IconInput } from './IconInput';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

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
      // Store return URL and navigate directly to code entry
      sessionStorage.setItem('authReturnUrl', window.location.pathname);
      onClose();
      navigate('/auth/verify');
    } catch (err: any) {
      setError(err.message || 'Failed to send login code');
      setLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setError(null);
    setLoading(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="card p-8 max-w-md w-full relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
        >
          <X size={24} />
        </button>

        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">Log In or Sign Up</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
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
              'Continue'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
