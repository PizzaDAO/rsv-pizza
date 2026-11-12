import React from 'react';
import { BRAND } from '../config/brand';

interface FooterProps {
  className?: string;
}

export const Footer: React.FC<FooterProps> = ({ className = '' }) => {
  return (
    <footer className={`py-6 ${className}`}>
      <div className="flex flex-col items-center gap-1">
        <a
          href="https://pizzadao.org"
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
        {BRAND.isBranded && (
          <a
            href="https://rsv.pizza" // brand-check-ignore-line
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-white/40 hover:text-white/60 transition-colors"
          >
            powered by RSV.Pizza {/* brand-check-ignore-line */}
          </a>
        )}
      </div>
    </footer>
  );
};
