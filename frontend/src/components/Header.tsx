import React, { ReactNode, useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { User, LogIn, Globe, ChevronDown } from 'lucide-react';
import { LoginModal } from './LoginModal';
import { useTranslation } from 'react-i18next';

const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'fr', label: 'FR', name: 'Français' },
  { code: 'ja', label: 'JA', name: '日本語' },
  { code: 'pt', label: 'PT', name: 'Português' },
  { code: 'zh', label: '中文', name: '中文' },
];

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
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const { t, i18n } = useTranslation('common');

  const bgClass = variant === 'transparent'
    ? 'bg-theme-bg'
    : 'bg-theme-header';

  const currentLang = LANGUAGES.find(l => i18n.language?.startsWith(l.code)) || LANGUAGES[0];

  // Close language menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    }
    if (langMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [langMenuOpen]);

  return (
    <header className={`site-header border-b border-theme-stroke overflow-visible relative z-50 ${bgClass}`}>
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
          <div className="relative" ref={langRef}>
            <button
              onClick={() => setLangMenuOpen(prev => !prev)}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover transition-all text-sm"
            >
              <Globe size={14} />
              <span className="font-bold text-theme-text">{currentLang.label}</span>
              <ChevronDown size={12} className={`transition-transform ${langMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {langMenuOpen && (
              <div className="absolute right-0 mt-1 shadow-lg overflow-hidden min-w-[120px] rounded-xl border border-theme-stroke" style={{ zIndex: 9999, background: 'var(--bg-header)' }}>
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => {
                      i18n.changeLanguage(lang.code);
                      setLangMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      currentLang.code === lang.code
                        ? 'bg-[#ff393a]/10 text-theme-text font-bold'
                        : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text'
                    }`}
                  >
                    <span>{lang.label}</span>
                    <span className="text-xs text-theme-text-muted">{lang.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
