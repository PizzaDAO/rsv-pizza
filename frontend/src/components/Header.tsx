import React, { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { User, LogIn } from 'lucide-react';
import { LoginModal } from './LoginModal';

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

  const bgClass = variant === 'transparent'
    ? 'bg-theme-bg'
    : 'bg-theme-header';

  return (
    <header className={`site-header border-b border-theme-stroke ${bgClass}`}>
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
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
                <span>Log In / Sign Up</span>
              </button>
            )
          )}
        </div>
      </div>
      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </header>
  );
};
