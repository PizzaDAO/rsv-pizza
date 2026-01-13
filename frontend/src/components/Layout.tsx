import React, { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <nav className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img
              src="/rsv-pizza/logo.png"
              alt="RSVPizza"
              className="h-8 sm:h-10"
            />
            <span className="text-lg sm:text-xl font-semibold text-white/90">RSVPizza</span>
          </a>
          <a
            href="https://pizzadao.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/60 hover:text-white/90 text-sm transition-colors"
          >
            pizzadao.xyz
          </a>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-6">
        <p className="text-center text-white/40 text-sm">
          RSVPizza by PizzaDAO
        </p>
      </footer>

      {/* Corner Links */}
      <div className="corner-links">
        <a
          href="https://docs.google.com/spreadsheets/d/101pcNQxJN6BoUUrocgVkFnFEE9bh9ipLdnFJW-OylkI/edit?gid=0#gid=0"
          target="_blank"
          rel="noopener noreferrer"
          className="corner-link"
          title="Google Sheets"
        >
          <img
            src="https://cdn.simpleicons.org/googlesheets/ffffff"
            alt="Google Sheets"
          />
        </a>
        <a
          href="https://github.com/PizzaDAO/rsv-pizza"
          target="_blank"
          rel="noopener noreferrer"
          className="corner-link"
          title="GitHub"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="text-white">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        </a>
      </div>
    </div>
  );
};
