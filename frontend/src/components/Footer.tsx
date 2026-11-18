import React from 'react';
import { BRAND } from '../config/brand';

interface FooterProps {
  className?: string;
}

export const Footer: React.FC<FooterProps> = ({ className = '' }) => {
  // White-label builds carry no PizzaDAO footer branding; nothing
  // brand-relevant lives here, so render nothing (no empty bar or border).
  if (BRAND.isBranded) return null;

  return (
    <footer className={`py-6 ${className}`}>
      <div className="flex flex-col items-center gap-1">
        <a
          href="https://pizzadao.org"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="PizzaDAO (opens in a new tab)"
          className="tap-target inline-block hover:opacity-80 transition-opacity"
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
