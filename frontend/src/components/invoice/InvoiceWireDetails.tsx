import React, { useState } from 'react';
import { Copy, Check, Building2 } from 'lucide-react';

const MERCURY_WIRE = {
  beneficiaryName: 'Rare Pizzas, LLC',
  beneficiaryAddress: '7112 Calpe Dr., Austin, TX 78739, USA',
  accountNumber: '255229327183656',
  accountType: 'Checking',
  routingNumber: '121145433',
  routingNumberAlt: '121145307',
  bankName: "Column N.A. (Mercury's partner bank)",
  bankAddress: '1 Letterman Drive, Building A, Suite A4-700, San Francisco, CA 94129, USA',
  swift: 'CLNOUS66MER',
};

interface InvoiceWireDetailsProps {
  invoiceNumber: string;
  amount: number; // cents
  currency: string;
}

export const InvoiceWireDetails: React.FC<InvoiceWireDetailsProps> = ({
  invoiceNumber,
  amount,
  currency,
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (value: string, fieldKey: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldKey);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  const formatAmount = (cents: number, curr: string) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(cents / 100);

  const CopyButton = ({ value, fieldKey }: { value: string; fieldKey: string }) => (
    <button
      type="button"
      onClick={() => handleCopy(value, fieldKey)}
      className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-white/50 hover:text-white/80"
      title="Copy"
    >
      {copiedField === fieldKey ? (
        <Check size={12} className="text-[#39d98a]" />
      ) : (
        <Copy size={12} />
      )}
    </button>
  );

  const Row = ({
    label,
    value,
    fieldKey,
    mono = true,
  }: {
    label: string;
    value: string;
    fieldKey?: string;
    mono?: boolean;
  }) => (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-white/5 last:border-0">
      <span className="text-white/40 text-xs min-w-0 w-40 flex-shrink-0 pt-0.5">{label}</span>
      <span className={`text-white/90 text-sm flex-1 min-w-0 break-words ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
      {fieldKey && <CopyButton value={value} fieldKey={fieldKey} />}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Prominent reference callout */}
      <div className="bg-[#ff393a]/10 border border-[#ff393a]/40 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-[#ff393a] text-xs uppercase tracking-wider font-semibold">
            Payment Reference (REQUIRED)
          </span>
          <CopyButton value={invoiceNumber} fieldKey="invoiceRef" />
        </div>
        <p className="text-white font-bold text-lg font-mono mb-2">{invoiceNumber}</p>
        <p className="text-white/60 text-xs leading-relaxed">
          You MUST put this invoice number in the wire reference/memo. Wires without it can't be matched automatically and will be delayed.
        </p>
      </div>

      {/* Wire details box */}
      <div className="bg-[#0f0f23] rounded-xl p-4 border border-white/10">
        <div className="flex items-center gap-2 mb-3">
          <Building2 size={16} className="text-white/40" />
          <span className="text-white/50 text-xs uppercase tracking-wider font-medium">
            Wire Transfer Details
          </span>
        </div>

        <div className="space-y-0">
          <Row label="Beneficiary name" value={MERCURY_WIRE.beneficiaryName} fieldKey="beneficiaryName" mono={false} />
          <Row label="Beneficiary address" value={MERCURY_WIRE.beneficiaryAddress} mono={false} />
          <Row label="Account number" value={MERCURY_WIRE.accountNumber} fieldKey="accountNumber" />
          <Row label="Account type" value={MERCURY_WIRE.accountType} mono={false} />
          <Row
            label="Routing (ABA)"
            value={`${MERCURY_WIRE.routingNumber} (if unrecognized: ${MERCURY_WIRE.routingNumberAlt})`}
            fieldKey="routingNumber"
          />
          <Row label="Bank name" value={MERCURY_WIRE.bankName} mono={false} />
          <Row label="Bank address" value={MERCURY_WIRE.bankAddress} mono={false} />
          <Row label="SWIFT / BIC" value={MERCURY_WIRE.swift} fieldKey="swift" />
        </div>
      </div>

      {/* Exact-amount note */}
      <div className="bg-[#627eea]/10 border border-[#627eea]/20 rounded-xl p-3">
        <p className="text-[#627eea] text-sm">
          Please wire exactly <strong>{formatAmount(amount, currency)}</strong>. If your bank deducts a wire fee, the remaining balance may not match and could delay processing.
        </p>
      </div>
    </div>
  );
};
