import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { splitCsvLine } from '../../lib/csvParser';
import { detectCarrier, detectTrackingUrl } from '../../lib/trackingUtils';
import { importShippingTracking } from '../../lib/api';

interface ParsedRow {
  kitId: string;
  recipient: string;
  trackingNumber: string;
  trackingUrl: string;
  detectedCarrier: string | null;
  autoUrl: string | null;
  hasTracking: boolean;
}

interface ImportResult {
  updated: number;
  skipped: number;
  notFound: string[];
}

interface CsvImportModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function CsvImportModal({ onClose, onSuccess }: CsvImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = (event.target?.result as string).replace(/^\uFEFF/, '');
        const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);

        if (lines.length < 2) {
          setParseError('CSV must have a header row and at least one data row.');
          return;
        }

        const headerCells = splitCsvLine(lines[0]);
        const headerMap: Record<string, number> = {};
        headerCells.forEach((cell, idx) => {
          headerMap[cell.trim().toLowerCase()] = idx;
        });

        // Find Kit ID column (required)
        const kitIdIdx = headerMap['kit id'] ?? headerMap['kitid'] ?? headerMap['kit_id'] ?? -1;
        if (kitIdIdx === -1) {
          setParseError('CSV must have a "Kit ID" column header.');
          return;
        }

        // Find optional columns
        const recipientIdx = headerMap['recipient'] ?? headerMap['recipient name'] ?? headerMap['name'] ?? -1;
        const trackingNumIdx = headerMap['tracking number'] ?? headerMap['tracking_number'] ?? headerMap['trackingnumber'] ?? headerMap['tracking #'] ?? headerMap['tracking'] ?? -1;
        const trackingUrlIdx = headerMap['tracking url'] ?? headerMap['tracking_url'] ?? headerMap['trackingurl'] ?? -1;

        const parsed: ParsedRow[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cells = splitCsvLine(lines[i]);
          const kitId = (cells[kitIdIdx] || '').trim();
          if (!kitId) continue;

          const recipient = recipientIdx >= 0 ? (cells[recipientIdx] || '').trim() : '';
          const trackingNumber = trackingNumIdx >= 0 ? (cells[trackingNumIdx] || '').trim() : '';
          const trackingUrl = trackingUrlIdx >= 0 ? (cells[trackingUrlIdx] || '').trim() : '';

          const detectedCarrier = trackingNumber ? detectCarrier(trackingNumber) : null;
          const autoUrl = trackingNumber && !trackingUrl ? detectTrackingUrl(trackingNumber) : null;
          const hasTracking = !!(trackingNumber || trackingUrl);

          parsed.push({
            kitId,
            recipient,
            trackingNumber,
            trackingUrl,
            detectedCarrier,
            autoUrl,
            hasTracking,
          });
        }

        if (parsed.length === 0) {
          setParseError('No valid data rows found in CSV.');
          return;
        }

        setRows(parsed);
      } catch {
        setParseError('Failed to parse CSV file.');
      }
    };
    reader.readAsText(file);
  };

  const trackingRows = rows.filter((r) => r.hasTracking);

  const handleApply = async () => {
    if (trackingRows.length === 0) return;

    setImporting(true);
    try {
      const items = trackingRows.map((r) => ({
        kitId: r.kitId,
        trackingNumber: r.trackingNumber || undefined,
        trackingUrl: r.trackingUrl || r.autoUrl || undefined,
      }));

      const res = await importShippingTracking(items);
      setResult(res);
      if (res.updated > 0) {
        onSuccess();
      }
    } catch (err: any) {
      setParseError(err.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-theme-stroke">
          <div>
            <h3 className="text-lg font-semibold text-theme-text">Import Tracking Numbers</h3>
            <p className="text-sm text-theme-text-muted">Upload a CSV with Kit ID and tracking data</p>
          </div>
          <button onClick={onClose} className="text-theme-text-faint hover:text-theme-text-secondary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* File picker */}
          {!result && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-3 bg-theme-surface border border-dashed border-theme-stroke-hover rounded-xl text-sm text-theme-text hover:bg-theme-surface/80 transition-colors w-full justify-center"
              >
                <Upload size={16} />
                {fileName || 'Choose CSV file...'}
              </button>
              <p className="text-xs text-theme-text-faint mt-2">
                CSV must include a "Kit ID" column. Optional: "Tracking Number", "Tracking URL", "Recipient".
              </p>
            </div>
          )}

          {/* Parse error */}
          {parseError && (
            <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 rounded-lg px-4 py-3">
              <AlertCircle size={16} />
              {parseError}
            </div>
          )}

          {/* Preview table */}
          {rows.length > 0 && !result && (
            <>
              <div className="text-sm text-theme-text-muted">
                {rows.length} rows parsed, <span className="text-theme-text font-medium">{trackingRows.length}</span> with tracking data
              </div>
              <div className="overflow-x-auto border border-theme-stroke rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-theme-stroke bg-theme-surface/50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Kit ID</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Recipient</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Tracking #</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Carrier</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr
                        key={idx}
                        className={`border-b border-theme-stroke last:border-b-0 ${
                          row.hasTracking ? 'bg-green-500/5' : 'opacity-50'
                        }`}
                      >
                        <td className="px-3 py-2 text-theme-text font-mono text-xs">{row.kitId.slice(0, 12)}...</td>
                        <td className="px-3 py-2 text-theme-text-muted">{row.recipient || '--'}</td>
                        <td className="px-3 py-2 text-theme-text">
                          {row.trackingNumber ? (
                            <span className="font-mono text-xs">{row.trackingNumber.length > 20 ? row.trackingNumber.slice(0, 20) + '...' : row.trackingNumber}</span>
                          ) : (
                            <span className="text-theme-text-faint">--</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.detectedCarrier ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-600">{row.detectedCarrier}</span>
                          ) : (
                            <span className="text-theme-text-faint text-xs">--</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-theme-text-muted truncate max-w-[200px]">
                          {row.trackingUrl || row.autoUrl ? (
                            <span title={row.trackingUrl || row.autoUrl || ''}>
                              {row.trackingUrl ? 'provided' : 'auto-detected'}
                            </span>
                          ) : (
                            <span className="text-theme-text-faint">--</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Result summary */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle size={20} />
                <span className="text-sm font-medium">Import complete</span>
              </div>
              <div className="bg-theme-surface rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-theme-text-muted">Updated</span>
                  <span className="text-theme-text font-medium">{result.updated}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-theme-text-muted">Skipped</span>
                  <span className="text-theme-text">{result.skipped}</span>
                </div>
                {result.notFound.length > 0 && (
                  <div>
                    <div className="flex justify-between text-red-500">
                      <span>Not found</span>
                      <span className="font-medium">{result.notFound.length}</span>
                    </div>
                    <div className="mt-1 text-xs text-theme-text-faint font-mono">
                      {result.notFound.slice(0, 10).map((id) => id.slice(0, 12) + '...').join(', ')}
                      {result.notFound.length > 10 && ` (+${result.notFound.length - 10} more)`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-stroke">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text transition-colors"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && rows.length > 0 && (
            <button
              onClick={handleApply}
              disabled={importing || trackingRows.length === 0}
              className="px-6 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
            >
              {importing ? 'Importing...' : `Apply ${trackingRows.length} Update${trackingRows.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
