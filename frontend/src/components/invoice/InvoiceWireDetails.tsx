import React, { useState } from 'react';
import { Copy, Check, Building2 } from 'lucide-react';

interface InvoiceWireDetailsProps {
  paymentInstructions: string | null;
}

export const InvoiceWireDetails: React.FC<InvoiceWireDetailsProps> = ({
  paymentInstructions,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!paymentInstructions) return;
    try {
      await navigator.clipboard.writeText(paymentInstructions);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  if (!paymentInstructions) {
    return (
      <div className="text-center py-6">
        <Building2 size={32} className="mx-auto text-white/30 mb-3" />
        <p className="text-white/50 text-sm">
          Wire transfer details are not available for this invoice.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Wire details box */}
      <div className="bg-[#0f0f23] rounded-xl p-4 border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-white/50 text-xs uppercase tracking-wider font-medium">
            Wire Transfer Details
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-white/70 hover:text-white"
          >
            {copied ? (
              <>
                <Check size={12} className="text-[#39d98a]" />
                Copied
              </>
            ) : (
              <>
                <Copy size={12} />
                Copy
              </>
            )}
          </button>
        </div>
        <pre className="text-white/90 text-sm whitespace-pre-wrap font-mono leading-relaxed">
          {paymentInstructions}
        </pre>
      </div>

      {/* Note */}
      <div className="bg-[#627eea]/10 border border-[#627eea]/20 rounded-xl p-3">
        <p className="text-[#627eea] text-sm">
          After completing your wire transfer, the event host will confirm receipt and mark this invoice as paid.
        </p>
      </div>
    </div>
  );
};
