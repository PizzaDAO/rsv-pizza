import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, X, FileSpreadsheet, AlertTriangle, RotateCcw, CheckCircle2 } from 'lucide-react';
import { IconInput } from './IconInput';
import { Checkbox } from './Checkbox';
import { parseCsvWithHeaders } from '../lib/csvParser';
import {
  detectPlatform,
  Platform,
} from '../lib/guestImport/headerProfiles';
import {
  parseRows,
  defaultMapping,
  ColumnMapping,
  ParsedRow,
} from '../lib/guestImport/parsers';
import { importGuestsApi } from '../lib/api';
import { usePizza } from '../contexts/PizzaContext';

/**
 * Soft + hard caps for an import (mirrors backend limits).
 * Source of truth: plans/calzone-83291-guest-list-import.md §9.
 */
const HARD_ROW_CAP = 2000;
const SOFT_ROW_WARN = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

type LandStatus = 'pending' | 'approved' | 'checkedin';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Existing guest emails on this party (lowercased) for client-side dup hinting. */
  existingEmails: Set<string>;
}

export const ImportGuestsModal: React.FC<Props> = ({ isOpen, onClose, existingEmails }) => {
  const { t } = useTranslation('host');
  const { party, loadParty } = usePizza();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Hooks must all be declared above any early return (react-hooks/rules-of-hooks).
  const [rawText, setRawText] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [platform, setPlatform] = useState<Platform>('csv');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [landStatus, setLandStatus] = useState<LandStatus>('approved');
  const [importing, setImporting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [resultErrors, setResultErrors] = useState<
    Array<{ email: string; reason: string }> | null
  >(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const parsedRows: ParsedRow[] = useMemo(() => {
    if (headers.length === 0 || rawRows.length === 0) return [];
    return parseRows(headers, rawRows, platform, mapping);
  }, [headers, rawRows, platform, mapping]);

  // Per-row dup detection (vs existing guest emails on the party)
  const rowDupFlags = useMemo(() => {
    const seenInBatch = new Set<string>();
    return parsedRows.map((row) => {
      const lowerEmail = (row.email || '').toLowerCase();
      if (!lowerEmail) return false;
      if (existingEmails.has(lowerEmail)) return true;
      if (seenInBatch.has(lowerEmail)) return true;
      seenInBatch.add(lowerEmail);
      return false;
    });
  }, [parsedRows, existingEmails]);

  const requireApproval = party?.requireApproval !== false;
  const totalRows = parsedRows.length;
  const duplicateCount = rowDupFlags.filter(Boolean).length;
  const errorCount = parsedRows.filter((r, i) => !rowDupFlags[i] && r.errors.length > 0).length;
  const skippedByParserCount = parsedRows.filter((r) => r.skipReason).length;
  const selectableCount = parsedRows.filter(
    (r, i) => !rowDupFlags[i] && r.errors.length === 0 && !r.skipReason
  ).length;
  const importCount = selected.size;

  // Capacity warning vs party.maxGuests
  const currentApprovedCount = useMemo(() => {
    return party?.id
      ? existingEmails.size // best-effort: total existing guests known to the page
      : 0;
  }, [party?.id, existingEmails.size]);
  const overCapacity =
    typeof party?.maxGuests === 'number' &&
    party.maxGuests > 0 &&
    currentApprovedCount + importCount > party.maxGuests;

  const resetState = useCallback(() => {
    setRawText('');
    setPasteMode(false);
    setHeaders([]);
    setRawRows([]);
    setPlatform('csv');
    setMapping({});
    setSelected(new Set());
    setLandStatus(requireApproval ? 'pending' : 'approved');
    setImporting(false);
    setResultMsg(null);
    setResultErrors(null);
    setFileError(null);
  }, [requireApproval]);

  const handleClose = useCallback(() => {
    if (importing) return;
    resetState();
    onClose();
  }, [importing, resetState, onClose]);

  const ingestText = useCallback(
    (text: string) => {
      const { headers: hdrs, rows } = parseCsvWithHeaders(text);
      if (hdrs.length === 0) {
        setFileError(t('guests.import.emptyFile', { defaultValue: 'No rows found in the file.' }));
        return;
      }
      if (rows.length > HARD_ROW_CAP) {
        setFileError(
          t('guests.import.tooManyRows', {
            defaultValue:
              'Files over 2000 rows must be split into multiple imports. Your file has {{count}} rows.',
            count: rows.length,
          })
        );
        // Still surface the first chunk so they can see what they got
      }
      const detected = detectPlatform(hdrs);
      setHeaders(hdrs);
      setRawRows(rows);
      setPlatform(detected);
      const map = defaultMapping(detected, hdrs);
      setMapping(map);
      // Default-select all rows that are valid + not dup'd + not skipReason'd
      const parsed = parseRows(hdrs, rows, detected, map);
      const seenInBatch = new Set<string>();
      const nextSelected = new Set<number>();
      parsed.forEach((row, idx) => {
        const emailLower = (row.email || '').toLowerCase();
        const isDup =
          !!emailLower && (existingEmails.has(emailLower) || seenInBatch.has(emailLower));
        if (emailLower) seenInBatch.add(emailLower);
        if (!isDup && row.errors.length === 0 && !row.skipReason) {
          nextSelected.add(idx);
        }
      });
      setSelected(nextSelected);
      setLandStatus(requireApproval ? 'pending' : 'approved');
    },
    [existingEmails, requireApproval, t]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setFileError(null);
      if (file.size > MAX_FILE_BYTES) {
        setFileError(
          t('guests.import.fileTooLarge', {
            defaultValue: 'File is over 2MB. Please split it into smaller imports.',
          })
        );
        return;
      }
      try {
        const text = await file.text();
        ingestText(text);
      } catch {
        setFileError(t('guests.import.readError', { defaultValue: 'Failed to read the file.' }));
      }
    },
    [ingestText, t]
  );

  const handlePasteSubmit = useCallback(() => {
    if (!rawText.trim()) return;
    ingestText(rawText);
  }, [rawText, ingestText]);

  const toggleRow = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleImport = useCallback(async () => {
    if (!party?.id || importing || importCount === 0) return;
    if (importCount > HARD_ROW_CAP) {
      setFileError(
        t('guests.import.tooManyRows', {
          defaultValue: 'Files over 2000 rows must be split into multiple imports.',
        })
      );
      return;
    }
    setImporting(true);
    setResultErrors(null);
    setResultMsg(null);

    // Build the API payload. Apply the host's landing-status override.
    const approved =
      landStatus === 'pending' ? null : true;
    const baseStatus: 'CONFIRMED' = 'CONFIRMED';
    const guests = Array.from(selected)
      .sort((a, b) => a - b)
      .map((idx) => {
        const r = parsedRows[idx];
        // Per-row WAITLISTED detected by parser overrides the global landStatus,
        // since the host probably wants those to land waitlisted regardless.
        const rowStatus =
          r.status === 'WAITLISTED' ? 'WAITLISTED' : landStatus === 'checkedin' ? 'CHECKED_IN' : baseStatus;
        return {
          name: r.name.trim(),
          email: r.email ? r.email.toLowerCase() : null,
          status: rowStatus,
          approved: rowStatus === 'WAITLISTED' ? null : approved,
        } as const;
      });

    try {
      const result = await importGuestsApi(party.id, {
        guests,
        sourcePlatform: platform,
      });
      setResultMsg(
        t('guests.import.resultSummary', {
          defaultValue: 'Imported {{inserted}}, skipped {{skipped}} duplicates, {{errors}} errors',
          inserted: result.inserted,
          skipped: result.skipped.length,
          errors: result.errors.length,
        })
      );
      if (result.skipped.length > 0) setResultErrors(result.skipped);
      // Refresh the page's party data so new guests show up
      if (party.inviteCode) {
        await loadParty(party.inviteCode);
      }
    } catch (err: any) {
      setResultMsg(
        t('guests.import.resultError', {
          defaultValue: 'Import failed: {{msg}}',
          msg: err?.message || 'unknown error',
        })
      );
    } finally {
      setImporting(false);
    }
  }, [
    party,
    selected,
    parsedRows,
    landStatus,
    platform,
    importing,
    importCount,
    t,
    loadParty,
  ]);

  if (!isOpen) return null;

  const showPreview = headers.length > 0 && rawRows.length > 0;
  const platformLabel: Record<Platform, string> = {
    luma: 'Luma',
    meetup: 'Meetup',
    eventbrite: 'Eventbrite',
    csv: t('guests.import.genericCsv', { defaultValue: 'Generic CSV' }),
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-theme-card rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-theme-stroke">
          <h2 className="text-2xl font-bold text-theme-text">
            {t('guests.import.title', { defaultValue: 'Import guests' })}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-theme-text-secondary hover:text-theme-text transition-colors"
            aria-label="Close"
            disabled={importing}
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Step 1 — source */}
          {!showPreview && (
            <div className="space-y-4">
              <p className="text-sm text-theme-text-muted">
                {t('guests.import.intro', {
                  defaultValue:
                    'Upload a CSV exported from Luma, Meetup, or Eventbrite — or paste rows directly. We will auto-detect the format.',
                })}
              </p>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-secondary flex items-center gap-2"
                  disabled={importing}
                >
                  <Upload size={16} />
                  {t('guests.import.uploadCta', { defaultValue: 'Upload CSV' })}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => setPasteMode((v) => !v)}
                  className="btn-secondary flex items-center gap-2"
                  disabled={importing}
                >
                  <FileSpreadsheet size={16} />
                  {pasteMode
                    ? t('guests.import.uploadInsteadCta', { defaultValue: 'Upload instead' })
                    : t('guests.import.pasteCta', { defaultValue: 'Paste rows' })}
                </button>
              </div>

              <p className="text-xs text-theme-text-faint">
                {t('guests.import.xlsxHint', {
                  defaultValue: 'XLSX not supported — save your spreadsheet as CSV first.',
                })}
              </p>

              {pasteMode && (
                <div className="space-y-2">
                  <IconInput
                    icon={FileSpreadsheet}
                    multiline
                    rows={8}
                    placeholder={t('guests.import.pastePlaceholder', {
                      defaultValue: 'Paste rows including the header line...',
                    })}
                    value={rawText}
                    onChange={(e) => setRawText((e.target as HTMLTextAreaElement).value)}
                  />
                  <button
                    type="button"
                    onClick={handlePasteSubmit}
                    className="btn-primary"
                    disabled={!rawText.trim()}
                  >
                    {t('guests.import.parsePastedCta', { defaultValue: 'Parse pasted rows' })}
                  </button>
                </div>
              )}

              {fileError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>{fileError}</span>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — preview */}
          {showPreview && !resultMsg && (
            <div className="space-y-4">
              <div className="text-sm text-theme-text-secondary">
                <span className="font-medium text-theme-text">
                  {t('guests.import.detected', {
                    defaultValue: 'Detected: {{platform}}',
                    platform: platformLabel[platform],
                  })}
                </span>
                {' · '}
                {t('guests.import.previewSummary', {
                  defaultValue:
                    '{{rows}} rows · {{dups}} duplicates · {{errors}} errors · {{skipped}} skipped',
                  rows: totalRows,
                  dups: duplicateCount,
                  errors: errorCount,
                  skipped: skippedByParserCount,
                })}
              </div>

              {/* Landing status */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-theme-text">
                  {t('guests.import.landAsLabel', { defaultValue: 'Land imported guests as:' })}
                </p>
                <div className="flex gap-3 flex-wrap">
                  {requireApproval && (
                    <Checkbox
                      checked={landStatus === 'pending'}
                      onChange={() => setLandStatus('pending')}
                      label={t('guests.import.statusPending', { defaultValue: 'Pending approval' })}
                    />
                  )}
                  <Checkbox
                    checked={landStatus === 'approved'}
                    onChange={() => setLandStatus('approved')}
                    label={t('guests.import.statusApproved', { defaultValue: 'Approved' })}
                  />
                  <Checkbox
                    checked={landStatus === 'checkedin'}
                    onChange={() => setLandStatus('checkedin')}
                    label={t('guests.import.statusCheckedIn', { defaultValue: 'Checked-in' })}
                  />
                </div>
              </div>

              {/* Capacity warning */}
              {overCapacity && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 text-sm text-orange-300">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>
                    {t('guests.import.overCapacity', {
                      defaultValue:
                        'This import will push your guest count past max_guests ({{max}}). Proceed anyway?',
                      max: party?.maxGuests,
                    })}
                  </span>
                </div>
              )}

              {/* Soft cap warning */}
              {totalRows > SOFT_ROW_WARN && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-300">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>
                    {t('guests.import.softCap', {
                      defaultValue:
                        'Large imports may take 30+ seconds. Consider splitting if this is your first import.',
                    })}
                  </span>
                </div>
              )}

              {/* Hard cap block */}
              {totalRows > HARD_ROW_CAP && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>
                    {t('guests.import.hardCap', {
                      defaultValue:
                        'Files over 2000 rows must be split into multiple imports.',
                    })}
                  </span>
                </div>
              )}

              {/* Preview table */}
              <div className="border border-theme-stroke rounded-lg overflow-hidden">
                <div className="max-h-[40vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-theme-surface sticky top-0">
                      <tr className="text-left text-theme-text-muted">
                        <th className="p-2 w-10"></th>
                        <th className="p-2">
                          {t('guests.import.colName', { defaultValue: 'Name' })}
                        </th>
                        <th className="p-2">
                          {t('guests.import.colEmail', { defaultValue: 'Email' })}
                        </th>
                        <th className="p-2">
                          {t('guests.import.colStatus', { defaultValue: 'Status' })}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, 200).map((row, idx) => {
                        const isDup = rowDupFlags[idx];
                        const hasErrors = row.errors.length > 0;
                        const isSkipped = !!row.skipReason;
                        const disabled = isDup || hasErrors || isSkipped;
                        const isChecked = selected.has(idx);
                        const note = isSkipped
                          ? `${row.skipReason}`
                          : isDup
                            ? 'duplicate'
                            : hasErrors
                              ? row.errors.join(', ')
                              : row.status === 'WAITLISTED'
                                ? 'waitlisted'
                                : row.approved === null
                                  ? 'pending'
                                  : row.checkedIn
                                    ? 'checked-in'
                                    : 'ready';
                        return (
                          <tr
                            key={idx}
                            className={`border-t border-theme-stroke ${disabled ? 'opacity-50' : ''}`}
                          >
                            <td className="p-2">
                              <Checkbox
                                checked={isChecked && !disabled}
                                onChange={() => !disabled && toggleRow(idx)}
                                disabled={disabled}
                                label=""
                              />
                            </td>
                            <td className="p-2 text-theme-text">{row.name || '—'}</td>
                            <td className="p-2 text-theme-text-secondary">{row.email || '—'}</td>
                            <td className="p-2">
                              <span
                                className={`inline-flex items-center gap-1 text-xs ${
                                  isDup
                                    ? 'text-yellow-400'
                                    : hasErrors
                                      ? 'text-red-400'
                                      : isSkipped
                                        ? 'text-theme-text-muted'
                                        : 'text-[#39d98a]'
                                }`}
                              >
                                {isDup ? (
                                  <RotateCcw size={12} />
                                ) : hasErrors ? (
                                  <AlertTriangle size={12} />
                                ) : (
                                  <CheckCircle2 size={12} />
                                )}
                                {note}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {parsedRows.length > 200 && (
                  <p className="text-xs text-theme-text-muted text-center py-2 border-t border-theme-stroke">
                    {t('guests.import.previewTruncated', {
                      defaultValue: 'Showing first 200 of {{n}} rows.',
                      n: parsedRows.length,
                    })}
                  </p>
                )}
              </div>

              <p className="text-xs text-theme-text-muted">
                {t('guests.import.selectableHint', {
                  defaultValue:
                    '{{selectable}} rows ready to import. {{count}} selected.',
                  selectable: selectableCount,
                  count: importCount,
                })}
              </p>
            </div>
          )}

          {/* Step 3 — result */}
          {resultMsg && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[#39d98a]/10 border border-[#39d98a]/30 text-sm text-[#39d98a]">
                <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
                <span>{resultMsg}</span>
              </div>
              {resultErrors && resultErrors.length > 0 && (
                <details className="text-xs text-theme-text-muted">
                  <summary className="cursor-pointer">
                    {t('guests.import.skippedDetails', {
                      defaultValue: 'View {{n}} skipped',
                      n: resultErrors.length,
                    })}
                  </summary>
                  <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {resultErrors.map((e, i) => (
                      <li key={i}>
                        <code>{e.email}</code> — {e.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-6 border-t border-theme-stroke">
          {showPreview && !resultMsg ? (
            <>
              <button
                type="button"
                onClick={resetState}
                className="btn-secondary"
                disabled={importing}
              >
                {t('guests.import.pickDifferentCta', { defaultValue: 'Pick different file' })}
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="btn-primary"
                disabled={
                  importing ||
                  importCount === 0 ||
                  importCount > HARD_ROW_CAP ||
                  totalRows > HARD_ROW_CAP
                }
              >
                {importing
                  ? t('guests.import.importingCta', { defaultValue: 'Importing…' })
                  : t('guests.import.importCountCta', {
                      defaultValue: 'Import {{count}}',
                      count: importCount,
                    })}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="btn-secondary ml-auto"
              disabled={importing}
            >
              {t('guests.import.closeCta', { defaultValue: 'Close' })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
