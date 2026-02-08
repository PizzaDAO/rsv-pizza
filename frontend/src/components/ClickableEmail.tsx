import React from 'react';
import { extractEmailDomain, extractEmailLocalPart } from '../utils/emailUtils';
import { ExternalLink } from 'lucide-react';

interface ClickableEmailProps {
  email: string;
  className?: string;
}

export const ClickableEmail: React.FC<ClickableEmailProps> = ({ email, className = '' }) => {
  const localPart = extractEmailLocalPart(email);
  const domain = extractEmailDomain(email);

  if (!domain) {
    return <span className={className}>{email}</span>;
  }

  return (
    <span className={className}>
      {localPart}@
      <a
        href={`https://${domain}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-white/70 hover:text-white hover:underline inline-flex items-center gap-0.5"
        onClick={(e) => e.stopPropagation()}
        title={`Visit ${domain}`}
      >
        {domain}
        <ExternalLink size={10} className="opacity-50" />
      </a>
    </span>
  );
};
