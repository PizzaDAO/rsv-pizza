import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';

interface PizzaDAOModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PizzaDAOModal({ isOpen, onClose }: PizzaDAOModalProps) {
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Reset loading state when modal opens
  useEffect(() => {
    if (isOpen) {
      setIframeLoaded(false);
    }
  }, [isOpen]);

  // ESC key closes modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[90vw] h-[90vh] rounded-2xl overflow-hidden bg-black/80 border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/60 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
        >
          <X size={20} />
        </button>

        {/* Loading spinner */}
        {!iframeLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-[#ff393a]" />
          </div>
        )}

        {/* Iframe */}
        <iframe
          src="https://pizzadao.org"
          className="w-full h-full border-0"
          onLoad={() => setIframeLoaded(true)}
          title="PizzaDAO"
          allow="autoplay"
        />
      </div>
    </div>
  );
}
