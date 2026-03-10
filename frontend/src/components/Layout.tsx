import React, { ReactNode } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { CornerLinks } from './CornerLinks';

interface LayoutProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Layout: React.FC<LayoutProps> = ({ children, className = '', style }) => {
  return (
    <div className={`min-h-screen flex flex-col ${className}`} style={style}>
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
