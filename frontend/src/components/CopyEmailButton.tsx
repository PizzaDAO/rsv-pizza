import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyEmailButtonProps {
  email: string;
  size?: number;
  className?: string;
}

export function CopyEmailButton({ email, size = 12, className = '' }: CopyEmailButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`shrink-0 opacity-40 hover:opacity-100 transition-opacity text-theme-text-faint ${className}`}
      title="Copy email"
    >
      {copied ? <Check size={size} className="text-green-400" /> : <Copy size={size} />}
    </button>
  );
}
