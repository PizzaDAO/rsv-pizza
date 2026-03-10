import React, { ReactNode } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { CornerLinks } from './CornerLinks';
import { useTheme } from '../contexts/ThemeContext';

interface LayoutProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Layout: React.FC<LayoutProps> = ({ children, className = '', style }) => {
  const { themeClass, backgroundStyle } = useTheme();
  return (
    <div
      className={`min-h-screen flex flex-col ${themeClass} ${className}`}
      style={{ ...backgroundStyle, ...style }}
    >
      <Header />

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>

      <Footer className="border-t border-white/10" />

      <CornerLinks />
    </div>
  );
};
