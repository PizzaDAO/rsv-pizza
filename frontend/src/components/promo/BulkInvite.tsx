import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Upload,
  FileText,
  MessageSquare,
  Send,
  Loader2,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Users,
} from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { Party } from '../../types';
import { usePizza } from '../../contexts/PizzaContext';
import { useAuth } from '../../contexts/AuthContext';
import { parseCsv, ParsedCsvRow } from '../../lib/csvParser';
import { bulkInviteGuests, BulkInviteResult } from '../../lib/api';

interface BulkInviteProps {
  party: Party;
}

type Stage = 'upload' | 'preview' | 'sending' | 'results';

type RowStatus = 'valid' | 'invalid-email' | 'duplicate-db' | 'duplicate-csv';

interface PreviewRow extends ParsedCsvRow {
  status: RowStatus;
  checked: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 500;

function statusLabel(status: RowStatus, t: (key: string) => string): string {
  switch (status) {
    case 'valid':
      return t('promo.statusValid');
    case 'invalid-email':
      return t('promo.statusInvalidEmail');
    case 'duplicate-db':
      return t('promo.statusAlreadyInvited');
    case 'duplicate-csv':
      return t('promo.statusDuplicate');
  }
}

function statusBadgeClass(status: RowStatus): string {
  switch (status) {
    case 'valid':
      return 'bg-green-500/10 text-green-400 border border-green-500/20';
    case 'invalid-email':
      return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
    case 'duplicate-db':
    case 'duplicate-csv':
      return 'bg-theme-surface text-theme-text-muted border border-theme-stroke';
  }
}

export const BulkInvite: React.FC<BulkInviteProps> = ({ party }) => {
  const { t } = useTranslation('host');
  const { guests, loadParty } = usePizza();
  const { user } = useAuth();

  const [stage, setStage] = useState<Stage>('upload');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<'sent' | 'error' | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testExpanded, setTestExpanded] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testName, setTestName] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [customMessage, setCustomMessage] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkInviteResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showFailed, setShowFailed] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pre-compute existing emails on the party, case-insensitive
  const existingEmails = useMemo(() => {
    const s = new Set<string>();
    for (const g of guests) {
      if (g.email) s.add(g.email.trim().toLowerCase());
    }
    return s;
  }, [guests]);

  const classifyRows = useCallback(
    (parsed: ParsedCsvRow[]): PreviewRow[] => {
      const seenInFile = new Set<string>();
      return parsed.map((row) => {
        const email = row.email.trim().toLowerCase();
        let status: RowStatus = 'valid';
        if (!email || !EMAIL_REGEX.test(email)) {
          status = 'invalid-email';
        } else if (existingEmails.has(email)) {
          status = 'duplicate-db';
        } else if (seenInFile.has(email)) {
          status = 'duplicate-csv';
        } else {
          seenInFile.add(email);
        }
        return {
          ...row,
          status,
          checked: status === 'valid',
        };
      });
    },
    [existingEmails]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setParseError(null);
      try {
        const text = await file.text();
        const parsed = parseCsv(text);
        if (parsed.length === 0) {
          setParseError('No rows found in CSV. Make sure the file has name and email columns.');
          return;
        }
        if (parsed.length > MAX_ROWS) {
          setParseError(`Too many rows (${parsed.length}). Max is ${MAX_ROWS} per upload.`);
          return;
        }
        const classified = classifyRows(parsed);
        setPreviewRows(classified);
        setStage('preview');
      } catch (err: any) {
        setParseError(err?.message || 'Failed to read file.');
      }
    },
    [classifyRows]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset so selecting the same file again still triggers change
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const toggleRow = (idx: number) => {
    setPreviewRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, checked: !r.checked } : r))
    );
  };

  const resetToUpload = () => {
    setStage('upload');
    setPreviewRows([]);
    setCustomMessage('');
    setParseError(null);
    setResults(null);
    setSendError(null);
    setShowSkipped(false);
    setShowFailed(false);
  };

  const counts = useMemo(() => {
    let valid = 0;
    let duplicates = 0;
    let invalid = 0;
    let checked = 0;
    for (const r of previewRows) {
      if (r.status === 'valid') valid++;
      else if (r.status === 'invalid-email') invalid++;
      else duplicates++;
      if (r.checked) checked++;
    }
    return { total: previewRows.length, valid, duplicates, invalid, checked };
  }, [previewRows]);

  const handleSend = async () => {
    const toSend = previewRows
      .filter((r) => r.checked)
      .map((r) => ({
        name: r.name,
        email: r.email.trim(),
      }));

    if (toSend.length === 0) return;

    setStage('sending');
    setSendError(null);

    try {
      const res = await bulkInviteGuests(
        party.id,
        toSend,
        customMessage.trim() || undefined
      );
      setResults(res);
      setStage('results');
      // Refresh guest list so new pending guests appear in the host dashboard
      if (party.inviteCode) {
        void loadParty(party.inviteCode);
      }
    } catch (err: any) {
      setSendError(err?.message || 'Failed to send invites.');
      setStage('preview');
    }
  };

  const handleTestEmail = async () => {
    const email = testEmail.trim();
    if (!email || !EMAIL_REGEX.test(email)) return;
    setTestSending(true);
    setTestResult(null);
    setTestError(null);
    try {
      const name = testName.trim() || email.split('@')[0];
      const res = await bulkInviteGuests(
        party.id,
        [{ name, email }],
        testMessage.trim() || undefined,
        true // testOnly — skip duplicate check, don't create guest row
      );
      if (res.sent.length > 0) {
        setTestResult('sent');
        setTimeout(() => setTestResult(null), 5000);
      } else if (res.skipped.length > 0) {
        setTestResult('error');
        setTestError(`Skipped: ${res.skipped[0].reason}`);
      } else if (res.failed.length > 0) {
        setTestResult('error');
        setTestError(`Failed: ${res.failed[0].reason}`);
      }
    } catch (err: any) {
      setTestResult('error');
      setTestError(err?.message || 'Failed to send');
    } finally {
      setTestSending(false);
    }
  };

  // ---------------- Upload stage ----------------
  if (stage === 'upload') {
    return (
      <div className="space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragActive
              ? 'border-[#ff393a] bg-[#ff393a]/5'
              : 'border-theme-stroke hover:border-theme-stroke-hover bg-theme-surface'
          }`}
        >
          <Upload size={32} className="mx-auto mb-3 text-theme-text-muted" />
          <p className="text-theme-text font-medium mb-1">
            {t('promo.dropCsvOrClick')}
          </p>
          <p className="text-xs text-theme-text-muted">
            {t('promo.csvRequirements', { max: MAX_ROWS })}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            className="hidden"
          />
        </div>

        {parseError && (
          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <AlertTriangle size={16} className="text-yellow-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-yellow-500/80">{parseError}</span>
          </div>
        )}

        <div className="border border-theme-stroke rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setTestExpanded((v) => !v)}
            className="w-full flex items-center justify-between p-3 text-left hover:bg-theme-surface transition-colors"
          >
            <span className="flex items-center gap-2 text-sm text-theme-text-secondary font-medium">
              <Send size={14} />
              Send a test invite
            </span>
            {testExpanded ? (
              <ChevronUp size={16} className="text-theme-text-muted" />
            ) : (
              <ChevronDown size={16} className="text-theme-text-muted" />
            )}
          </button>
          {testExpanded && (
            <div className="border-t border-theme-stroke p-3 space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <IconInput
                    icon={Send}
                    value={testEmail}
                    onChange={(e) => { setTestEmail(e.target.value); setTestResult(null); setTestError(null); }}
                    placeholder="Recipient email"
                    type="email"
                  />
                </div>
                <div className="flex-1">
                  <IconInput
                    icon={Users}
                    value={testName}
                    onChange={(e) => setTestName(e.target.value)}
                    placeholder="Recipient name (optional)"
                  />
                </div>
              </div>
              <IconInput
                icon={MessageSquare}
                multiline
                rows={3}
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder="Custom message (optional, shown in invite email)"
              />
              {testResult === 'error' && testError && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                  <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-red-300">{testError}</span>
                </div>
              )}
              <button
                type="button"
                onClick={handleTestEmail}
                disabled={testSending || !testEmail.trim() || !EMAIL_REGEX.test(testEmail.trim())}
                className="w-full flex items-center justify-center gap-2 bg-theme-surface hover:bg-theme-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-theme-text-secondary font-medium py-2 rounded-lg transition-colors text-sm border border-theme-stroke"
              >
                {testSending ? (
                  <><Loader2 size={14} className="animate-spin" /> Sending...</>
                ) : testResult === 'sent' ? (
                  <><CheckCircle size={14} className="text-green-400" /> Test sent to {testEmail}</>
                ) : (
                  <><Send size={14} /> Send test invite</>
                )}
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-theme-text-faint">
          {t('promo.csvInfoNote')}
        </p>
      </div>
    );
  }

  // ---------------- Preview stage ----------------
  if (stage === 'preview') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-theme-text-muted" />
            <span className="text-xs text-theme-text-muted">
              {t('promo.found', { total: counts.total, count: counts.total })} ·{' '}
              <span className="text-green-400">{counts.valid} {t('promo.valid')}</span> ·{' '}
              <span className="text-theme-text-secondary">{counts.duplicates} {t('promo.duplicate')}</span> ·{' '}
              <span className="text-yellow-500/90">{counts.invalid} {t('promo.invalid')}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={resetToUpload}
            className="text-xs text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 transition-colors"
          >
            <RotateCcw size={12} />
            {t('promo.startOver')}
          </button>
        </div>

        <div className="border border-theme-stroke rounded-lg overflow-hidden">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-surface sticky top-0">
                <tr>
                  <th className="w-10 p-2"></th>
                  <th className="text-left p-2 text-xs font-medium text-theme-text-muted">{t('promo.name')}</th>
                  <th className="text-left p-2 text-xs font-medium text-theme-text-muted">{t('promo.email')}</th>
                  <th className="text-left p-2 text-xs font-medium text-theme-text-muted">{t('promo.status')}</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => {
                  const dimmed = row.status !== 'valid';
                  return (
                    <tr
                      key={idx}
                      className={`border-t border-theme-stroke ${
                        dimmed ? 'opacity-50' : ''
                      }`}
                    >
                      <td className="p-2 align-middle">
                        <Checkbox
                          checked={row.checked}
                          onChange={() => toggleRow(idx)}
                          label=""
                          size={16}
                        />
                      </td>
                      <td className="p-2 text-theme-text truncate max-w-xs" title={row.name}>
                        {row.name || <span className="text-theme-text-muted italic">—</span>}
                      </td>
                      <td className="p-2 text-theme-text-secondary truncate max-w-xs" title={row.email}>
                        {row.email || <span className="text-theme-text-muted italic">—</span>}
                      </td>
                      <td className="p-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${statusBadgeClass(row.status)}`}>
                          {statusLabel(row.status, t)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <IconInput
          icon={MessageSquare}
          multiline
          rows={3}
          value={customMessage}
          onChange={(e) => setCustomMessage(e.target.value)}
          placeholder={t('promo.customMessagePlaceholder')}
        />

        {sendError && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-300">{sendError}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={resetToUpload}
            className="flex-1 flex items-center justify-center gap-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm border border-theme-stroke"
          >
            <RotateCcw size={16} />
            {t('promo.startOver')}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={counts.checked === 0}
            className="flex-1 flex items-center justify-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            <Send size={16} />
            {t('promo.sendInvite', { count: counts.checked })}
          </button>
        </div>
      </div>
    );
  }

  // ---------------- Sending stage ----------------
  if (stage === 'sending') {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 size={32} className="text-[#ff393a] animate-spin" />
        <p className="text-theme-text font-medium">{t('promo.sendingInvites')}</p>
        <p className="text-xs text-theme-text-muted">
          {t('promo.sendingMayTakeMoment')}
        </p>
      </div>
    );
  }

  // ---------------- Results stage ----------------
  if (stage === 'results' && results) {
    const sentCount = results.sent.length;
    const skippedCount = results.skipped.length;
    const failedCount = results.failed.length;
    const success = sentCount > 0;

    return (
      <div className="space-y-4">
        <div
          className={`flex items-start gap-3 rounded-lg p-4 ${
            success
              ? 'bg-green-500/10 border border-green-500/20'
              : 'bg-yellow-500/10 border border-yellow-500/20'
          }`}
        >
          {success ? (
            <CheckCircle size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle size={20} className="text-yellow-500 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className={`font-medium ${success ? 'text-green-400' : 'text-yellow-500'}`}>
              {success
                ? t('promo.sentInvite', { count: sentCount })
                : t('promo.failedToSend')}
            </p>
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-theme-text-muted">
              <span className="flex items-center gap-1">
                <Users size={12} />
                {t('promo.sent', { count: sentCount })}
              </span>
              {skippedCount > 0 && <span>{t('promo.skipped', { count: skippedCount })}</span>}
              {failedCount > 0 && <span className="text-red-300">{t('promo.failed', { count: failedCount })}</span>}
            </div>
          </div>
        </div>

        {skippedCount > 0 && (
          <div className="border border-theme-stroke rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSkipped((v) => !v)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-theme-surface transition-colors"
            >
              <span className="text-sm text-theme-text">
                {t('promo.skipped', { count: skippedCount })}
              </span>
              {showSkipped ? (
                <ChevronUp size={16} className="text-theme-text-muted" />
              ) : (
                <ChevronDown size={16} className="text-theme-text-muted" />
              )}
            </button>
            {showSkipped && (
              <div className="border-t border-theme-stroke max-h-48 overflow-y-auto">
                {results.skipped.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 p-2 text-xs border-b border-theme-stroke last:border-b-0"
                  >
                    <span className="text-theme-text-secondary truncate">{s.email}</span>
                    <span className="text-theme-text-muted flex-shrink-0">{s.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {failedCount > 0 && (
          <div className="border border-red-500/20 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowFailed((v) => !v)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-red-500/5 transition-colors"
            >
              <span className="text-sm text-red-300">
                {t('promo.failed', { count: failedCount })}
              </span>
              {showFailed ? (
                <ChevronUp size={16} className="text-red-300" />
              ) : (
                <ChevronDown size={16} className="text-red-300" />
              )}
            </button>
            {showFailed && (
              <div className="border-t border-red-500/20 max-h-48 overflow-y-auto">
                {results.failed.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 p-2 text-xs border-b border-red-500/10 last:border-b-0"
                  >
                    <span className="text-theme-text-secondary truncate">{f.email}</span>
                    <span className="text-red-300/80 flex-shrink-0">{f.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={resetToUpload}
          className="w-full flex items-center justify-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
        >
          <Upload size={16} />
          {t('promo.inviteMore')}
        </button>
      </div>
    );
  }

  return null;
};
