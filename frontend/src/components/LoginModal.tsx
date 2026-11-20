import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { Mail, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { IconInput } from './IconInput';
import { Modal } from './Modal';
import { authErrorKey } from '../lib/authErrors';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('auth');
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
      setError(t(authErrorKey(err?.message, 'send', err?.code)));
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
    <Modal onClose={handleClose} labelledBy="login-modal-title">
      <div>
        <div className="mb-6">
          <h2 id="login-modal-title" className="text-2xl font-bold text-theme-text mb-2">{t('loginModal.title')}</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <IconInput
            icon={Mail}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('loginModal.emailPlaceholder')}
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
                {t('loginModal.sending')}
              </>
            ) : (
              t('loginModal.continue')
            )}
          </button>
        </form>
      </div>
    </Modal>
  );
}
