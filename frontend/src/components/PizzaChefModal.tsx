import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';

interface PizzaChefModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PizzaChefModal({ isOpen, onClose }: PizzaChefModalProps) {
  const [isLoading, setIsLoading] = useState(true);

  // Handle ESC key to close
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

  // Reset loading state when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl overflow-hidden"
        style={{ width: '90vw', height: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 text-white/50 hover:text-white transition-colors bg-black/50 rounded-full p-2"
        >
          <X size={24} />
        </button>

        {/* Loading state */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]">
            <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
          </div>
        )}

        {/* Iframe */}
        <iframe
          src="https://pizza-chef-six.vercel.app/"
          className="w-full h-full border-0"
          onLoad={() => setIsLoading(false)}
          title="Pizza Chef"
        />
      </div>
    </div>
  );
}
