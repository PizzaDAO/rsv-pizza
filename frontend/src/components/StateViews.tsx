import React from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';

interface LoadingStateProps {
  /** Accessible text announced to screen readers (visually hidden). */
  label?: string;
  /** Fill the viewport (page-level) or a 50vh block. */
  fullScreen?: boolean;
  className?: string;
}

/** Spinner announced via role=status / aria-busy. */
export const LoadingState: React.FC<LoadingStateProps> = ({ label = 'Loading', fullScreen = false, className = '' }) => (
  <div
    role="status"
    aria-busy="true"
    aria-live="polite"
    className={`flex items-center justify-center ${fullScreen ? 'min-h-screen' : 'min-h-[50vh]'} ${className}`}
  >
    <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </div>
);

interface MessageStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** "Nothing here yet" panel. */
export const EmptyState: React.FC<MessageStateProps> = ({ title, description, icon, action, className = '' }) => (
  <div role="status" className={`flex flex-col items-center text-center gap-2 py-10 px-4 ${className}`}>
    {icon}
    <p className="text-theme-text font-semibold">{title}</p>
    {description && <p className="text-sm text-theme-text-secondary max-w-sm">{description}</p>}
    {action}
  </div>
);

/** Error panel announced assertively. */
export const ErrorState: React.FC<MessageStateProps> = ({ title, description, icon, action, className = '' }) => (
  <div role="alert" className={`flex flex-col items-center text-center gap-2 py-10 px-4 ${className}`}>
    {icon ?? <AlertTriangle className="w-8 h-8 text-[#ff393a]" aria-hidden="true" />}
    <p className="text-theme-text font-semibold">{title}</p>
    {description && <p className="text-sm text-theme-text-secondary max-w-sm">{description}</p>}
    {action}
  </div>
);
