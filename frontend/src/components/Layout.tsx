import React, { ReactNode } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { CornerLinks } from './CornerLinks';
import { GPPClouds } from './GPPClouds';
import { useTheme } from '../contexts/ThemeContext';

interface LayoutProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Layout: React.FC<LayoutProps> = ({ children, className = '', style }) => {
  const { theme, themeClass, backgroundStyle } = useTheme();
  return (
    <div
      className={`min-h-screen flex flex-col ${themeClass} ${className}`}
      style={{ ...backgroundStyle, ...style }}
    >
      {theme === 'gpp' && <GPPClouds />}

      <Header />

      {/* Main content */}
      <main className="flex-1 relative z-[1]">
        {children}
      </main>

      <Footer className="border-t border-theme-stroke relative z-[1]" />

      <CornerLinks />
    </div>
  );
};
