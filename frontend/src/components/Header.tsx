import React, { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { User, LogIn, Globe } from 'lucide-react';
import { LoginModal } from './LoginModal';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
  rightContent?: ReactNode;
  variant?: 'default' | 'transparent';
  showBrandText?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  rightContent,
  variant = 'default',
  showBrandText = true
}) => {
  const { user, loading } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const { t, i18n } = useTranslation('common');

  const bgClass = variant === 'transparent'
    ? 'bg-theme-bg'
    : 'bg-theme-header';

  const currentLang = i18n.language?.startsWith('es') ? 'es' : 'en';

  const toggleLanguage = () => {
    const newLang = currentLang === 'en' ? 'es' : 'en';
    i18n.changeLanguage(newLang);
  };

  return (
    <header className={`site-header border-b border-theme-stroke ${bgClass}`}>
      <div className="max-w-[1212px] mx-auto px-4 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <img
            src="/logo.png"
            alt="RSV.Pizza"
            className="h-8 sm:h-10"
          />
          {showBrandText && (
            <span
              className="text-theme-text hidden sm:inline"
              style={{ fontFamily: "'Bangers', cursive", fontSize: '1.3rem' }}
            >
              RSV.Pizza
            </span>
          )}
        </Link>
        <div className="flex items-center gap-3">
          {rightContent}
          {/* Language Switcher */}
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover transition-all text-sm"
            title={currentLang === 'en' ? 'Cambiar a Espanol' : 'Switch to English'}
          >
            <Globe size={14} />
            <span className={currentLang === 'en' ? 'font-bold text-theme-text' : ''}>EN</span>
            <span className="text-theme-text-muted">/</span>
            <span className={currentLang === 'es' ? 'font-bold text-theme-text' : ''}>ES</span>
          </button>
          {!loading && (
            user ? (
              <Link
                to="/account"
                className="flex items-center gap-2 text-theme-text-secondary hover:text-theme-text transition-colors"
              >
                <User size={18} />
                <span className="text-sm hidden sm:inline">{user.name || user.email}</span>
              </Link>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-theme-surface-hover hover:bg-theme-surface-hover border border-theme-stroke-hover rounded-lg text-theme-text hover:text-theme-text text-sm transition-all"
              >
                <LogIn size={16} />
                <span>{t('header.logIn')}</span>
              </button>
            )
          )}
        </div>
      </div>
      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </header>
  );
};
