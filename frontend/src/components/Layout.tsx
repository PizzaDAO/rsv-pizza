import React, { ReactNode } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { CornerLinks } from './CornerLinks';

interface LayoutProps {
  children: ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col">
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
