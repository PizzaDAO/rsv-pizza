import React from 'react';

interface FooterProps {
  className?: string;
}

export const Footer: React.FC<FooterProps> = ({ className = '' }) => {
  return (
    <footer className={`py-6 ${className}`}>
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
  );
};
