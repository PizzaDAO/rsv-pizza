import React, { ReactNode } from 'react';
import { Header } from './Header';
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

      {/* Footer */}
      <footer className="border-t border-white/10 py-6">
        <div className="flex flex-col items-center gap-1">
          <span className="text-white/40 text-sm">Powered by</span>
          <a
            href="https://pizzadao.xyz/join"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-80 transition-opacity"
          >
            <img
              src="/pizzadao-logo.svg"
              alt="PizzaDAO"
              className="h-7"
            />
          </a>
        </div>
      </footer>

      <CornerLinks />
    </div>
  );
};
