import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, RefreshCw, Square } from 'lucide-react';
import {
  fetchPizzaStatus,
  runPizzaLlmPass,
  runPizzaPhotoPass,
  runPizzaSync,
  runPizzaVisionPass,
  type PizzaStatusResponse,
} from '../../lib/api';

/**
 * sfincione-40417: full-admin ops. Sync -> LLM pass -> Vision pass -> Photo pass.
 * The OpenAI passes cost money, so they require a dry run first; "Run until done" loops
 * batches until `remaining` hits 0, the batch makes no progress, or you stop it.
 */

type OpKey = 'sync' | 'llm' | 'vision' | 'photo';

const OPS: Array<{ key: OpKey; title: string; blurb: string; batch: number; hasDryRun: boolean }> = [
  { key: 'sync', title: '1. Sync lines', blurb: 'Parse OCR line items into pizza lines (hash-based, resets verification only when a line changed).', batch: 100, hasDryRun: false },
  { key: 'llm', title: '2. LLM size pass', blurb: 'Classify lines and guess sizes from the receipt text (OpenAI, text only).', batch: 10, hasDryRun: true },
  { key: 'vision', title: '3. Vision pass', blurb: 'Read sizes from the receipt image for lines still without a size (OpenAI vision, higher cost).', batch: 10, hasDryRun: true },
  { key: 'photo', title: '4. Photo pass', blurb: 'Estimate sizes from each event\'s pizza photos. Suggestions only: they show in Review and count once a reviewer accepts them (OpenAI vision).', batch: 5, hasDryRun: true },
];

// Module-level guard so a remount (tab switch) can never start a second loop.
const activeLoop: { current: { key: OpKey; stop: boolean } | null } = { current: null };

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-theme-stroke bg-white/5 px-3 py-2">
      <div className="text-lg font-semibold text-theme-text">{value}</div>
      <div className="text-xs text-theme-text-muted">{label}</div>
    </div>
  );
}

export function PizzaOpsView() {
  const [status, setStatus] = useState<PizzaStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<OpKey | null>(activeLoop.current?.key ?? null);
  const [log, setLog] = useState<string[]>([]);
  const [dryRunDone, setDryRunDone] = useState<Record<OpKey, boolean>>({ sync: true, llm: false, vision: false, photo: false });
  // In-page spend confirmation (a native confirm() dialog blocks browser automation).
  const [armed, setArmed] = useState<OpKey | null>(null);
  const [progress, setProgress] = useState<{ done: number; remaining: number | null } | null>(null);

  // Stop the loop when this view unmounts; while an old loop is still winding
  // down, show it as running and block new starts.
  useEffect(() => {
    const poll = setInterval(() => setRunning(activeLoop.current?.key ?? null), 1000);
    return () => {
      clearInterval(poll);
      if (activeLoop.current) activeLoop.current.stop = true;
    };
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await fetchPizzaStatus());
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load status');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const addLog = (line: string) => setLog((l) => [...l.slice(-199), `${new Date().toLocaleTimeString()}  ${line}`]);

  const runOnce = async (key: OpKey, dryRun: boolean, limit: number): Promise<{ remaining: number; processed: number; errors: number }> => {
    if (key === 'sync') {
      const r = await runPizzaSync({ limit });
      addLog(`sync: ${r.docsSynced} docs synced, ${r.linesWritten} lines written, ${r.linesDeleted} deleted, ${r.remaining} docs remaining, ${r.outliersFlagged} outliers flagged`);
      return { remaining: r.remaining, processed: r.docsSynced, errors: 0 };
    }
    const r = key === 'llm'
      ? await runPizzaLlmPass({ limit, dryRun })
      : key === 'vision'
        ? await runPizzaVisionPass({ limit, dryRun })
        : await runPizzaPhotoPass({ limit, dryRun });
    const unit = key === 'photo' ? 'events' : 'candidates';
    addLog(
      `${key}${dryRun ? ' (dry run)' : ''}: ${r.candidates} ${unit}, ${r.processed} processed, ${r.linesInserted} inserted, ${r.linesUpdated} ${key === 'photo' ? 'suggested' : 'updated'}, ${r.remaining} remaining${r.errors.length ? `, ${r.errors.length} errors` : ''} [${r.model}]`,
    );
    r.errors.slice(0, 3).forEach((e) => addLog(`  error ${key === 'photo' ? 'party ' : ''}${e.documentId}: ${e.error}`));
    return { remaining: r.remaining, processed: r.processed, errors: r.errors.length };
  };

  const dryRun = async (key: OpKey) => {
    if (activeLoop.current) return;
    const me = { key, stop: false };
    activeLoop.current = me;
    setRunning(key);
    setError(null);
    try {
      await runOnce(key, true, OPS.find((o) => o.key === key)!.batch);
      setDryRunDone((d) => ({ ...d, [key]: true }));
    } catch (e: any) {
      setError(e?.message || 'Dry run failed');
    } finally {
      if (activeLoop.current === me) activeLoop.current = null;
      setRunning(null);
    }
  };

  const runLoop = async (key: OpKey) => {
    const op = OPS.find((o) => o.key === key)!;
    if (key !== 'sync' && armed !== key) { setArmed(key); return; }
    setArmed(null);
    if (activeLoop.current) return;
    const me = { key, stop: false };
    activeLoop.current = me;
    setRunning(key);
    setError(null);
    let done = 0;
    try {
      for (let i = 0; i < 500 && !me.stop; i++) {
        const { remaining, processed, errors } = await runOnce(key, false, op.batch);
        done += processed;
        setProgress({ done, remaining });
        if (remaining <= 0) {
          addLog(`${key}: finished`);
          break;
        }
        if (errors > 0 && processed === 0) {
          addLog(`${key}: every doc in this batch failed, stopping (${remaining} remaining)`);
          setError('Every document in the last batch failed; check the log before retrying.');
          break;
        }
        if (processed === 0) {
          addLog(`${key}: no progress this batch, stopping (${remaining} remaining)`);
          break;
        }
      }
      if (me.stop) addLog(`${key}: stopped by user`);
    } catch (e: any) {
      setError(e?.message || 'Run failed');
      addLog(`${key}: failed - ${e?.message || 'error'}`);
    } finally {
      if (activeLoop.current === me) activeLoop.current = null;
      setRunning(null);
      setProgress(null);
      void loadStatus();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-theme-text">Pipeline status</h3>
        <button type="button" onClick={loadStatus} className="p-1 text-theme-text-muted hover:text-theme-text" aria-label="Refresh status"><RefreshCw size={14} /></button>
      </div>
      {status && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <Stat label="Receipts with line items" value={status.docsWithItems} />
            <Stat label="Receipts synced" value={status.docsSynced} />
            <Stat label="Pending sync" value={status.docsPendingSync} />
            <Stat label="Pending LLM pass" value={status.docsPendingLlm} />
            <Stat label="Pending vision pass" value={status.docsPendingVision} />
            {status.partiesPendingPhoto !== undefined && <Stat label="Events pending photo pass" value={status.partiesPendingPhoto} />}
            {status.linesWithPhotoEstimate !== undefined && <Stat label="Photo suggestions to review" value={status.linesWithPhotoEstimate} />}
            <Stat label="Lines" value={status.lines} />
            <Stat label="Verified" value={status.verifiedLines} />
            <Stat label="Unresolved size" value={status.unresolvedLines} />
            <Stat label="Excluded" value={status.excludedLines} />
            <Stat label="Bundles" value={status.bundleLines} />
            <Stat label="Unverified outliers" value={status.outlierLines} />
          </div>
          <div className="text-xs text-theme-text-muted">
            By size source: {Object.entries(status.bySource).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}
          </div>
        </>
      )}
      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {OPS.map((op) => {
          const busy = running === op.key;
          const canRun = !running && (!op.hasDryRun || dryRunDone[op.key]);
          return (
            <div key={op.key} className="rounded-xl border border-theme-stroke bg-white/5 p-3 space-y-2">
              <div className="font-medium text-theme-text">{op.title}</div>
              <p className="text-xs text-theme-text-muted">{op.blurb}</p>
              {busy && progress && (
                <div className="text-xs text-theme-text">
                  {progress.done} processed{progress.remaining !== null ? `, ${progress.remaining} remaining` : ''}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {op.hasDryRun && (
                  <button type="button" disabled={!!running} onClick={() => dryRun(op.key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-stroke hover:bg-white/10 text-sm disabled:opacity-40">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Dry run
                  </button>
                )}
                <button type="button" disabled={!canRun} onClick={() => runLoop(op.key)}
                  title={op.hasDryRun && !dryRunDone[op.key] ? 'Do a dry run first' : undefined}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm disabled:opacity-40">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  {armed === op.key ? 'Confirm: spend OpenAI credits' : 'Run until done'}
                </button>
                {armed === op.key && !busy && (
                  <button type="button" onClick={() => setArmed(null)}
                    className="px-3 py-1.5 rounded-lg border border-theme-stroke hover:bg-white/10 text-sm">
                    Cancel
                  </button>
                )}
                {busy && (
                  <button type="button" onClick={() => { if (activeLoop.current) activeLoop.current.stop = true; }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-stroke hover:bg-white/10 text-sm">
                    <Square size={14} /> Stop
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {log.length > 0 && (
        <pre className="rounded-xl border border-theme-stroke bg-black/30 p-3 text-xs text-theme-text-muted overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap">{log.join('\n')}</pre>
      )}
    </div>
  );
}
