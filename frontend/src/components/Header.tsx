import React, { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { User, LogIn } from 'lucide-react';

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

  const bgClass = variant === 'transparent'
    ? 'bg-[#0b0b10]/95'
    : 'bg-[#1a1a2e]';

  return (
    <header className={`site-header border-b border-white/10 ${bgClass}`}>
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <img
            src="/logo.png"
            alt="RSV.Pizza"
            className="h-8 sm:h-10"
          />
          {showBrandText && (
            <span
              className="text-white/90 hidden sm:inline"
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
                className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
              >
                <User size={18} />
                <span className="text-sm hidden sm:inline">{user.name || user.email}</span>
              </Link>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white/80 hover:text-white text-sm transition-all"
              >
                <LogIn size={16} />
                <span>Log In / Sign Up</span>
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
};
