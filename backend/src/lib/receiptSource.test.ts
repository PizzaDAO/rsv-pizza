import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUploadedReceipt } from './receiptSource.js';

const m = vi.hoisted(() => ({ sql: [] as string[] }));
vi.mock('../config/database.js', () => ({
  prisma: {
    $queryRaw: async (q: { strings: string[] }) => {
      m.sql.push(q.strings.join('?'));
      return [{ has_group: true, has_box: true, has_pizza: true, has_receipt: false, additional_count: 9 }];
    },
  },
}));

import { payoutHasReceipt } from '../services/payout-receipts.js';

const draft = { kind: 'receipt', source: 'ai_call', payoutId: null, partyId: 'p1', uploadedByUserId: 'h1' };

describe('a pizza-order draft never counts as a receipt (basil-14648, reviewer scenario)', () => {
  it('isUploadedReceipt: only uploads count; legacy rows without source count', () => {
    expect(isUploadedReceipt({ kind: 'receipt', source: 'upload' })).toBe(true);
    expect(isUploadedReceipt({ kind: 'receipt' })).toBe(true);
    expect(isUploadedReceipt({ kind: 'receipt', source: 'ai_call' })).toBe(false);
    expect(isUploadedReceipt({ kind: 'receipt', source: 'opop_native' })).toBe(false);
    expect(isUploadedReceipt({ kind: 'pizza', source: 'upload' })).toBe(false);
  });

  it('payoutHasReceipt (the hard stop at admin approve/execute) ignores a draft uploaded by the same host', async () => {
    const db = {
      payoutDocument: {
        findFirst: async ({ where }: any) => {
          // minimal matcher for the where this helper builds
          const rows = [draft];
          return (
            rows.find(
              (r) =>
                r.kind === where.kind &&
                (where.source === undefined || r.source === where.source) &&
                where.OR.some((o: any) => ('payoutId' in o && o.payoutId === r.payoutId) || (o.partyId === r.partyId && o.uploadedByUserId === r.uploadedByUserId))
            ) ?? null
          );
        },
      },
    } as any;
    expect(await payoutHasReceipt(db, { id: 'pay1', partyId: 'p1', hostUserId: 'h1' })).toBe(false);
  });

  it('submission readiness (POST /payouts RECEIPTS_REQUIRED gate) counts only source=upload receipts', async () => {
    const { getPayoutSubmissionReadiness } = await import('../routes/payout.routes.js');
    await getPayoutSubmissionReadiness('11111111-1111-4111-8111-111111111111');
    const sql = m.sql.join('\n');
    expect(sql).toMatch(/payout_documents pd WHERE[^)]*pd\.kind = 'receipt' AND pd\.source = 'upload'\) AS has_receipt/);
  });

  it('regression guard: every query-side kind=receipt in backend/src also filters source (creates are allow-listed)', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.includes('testutil')) files.push(p);
      }
    };
    walk(root);
    // Creates (and non-receipt-gate reads that cannot see a draft) are listed by file; anything new fails.
    const allowedUnfiltered: Record<string, number> = {
      'routes/payout.routes.ts': 8, // 6 creates + the receipts library (shows drafts on purpose) + the host's own doc-id lookups
      'routes/telegram-inbound.routes.ts': 1, // create
      'routes/admin-payout.routes.ts': 1, // admin doc-kind validation list
      'services/hostFastPass.service.ts': 2, // cross-party url/name reuse lookups (draft urls are unique per order)
      'services/pizzaOrderSync.ts': 1, // the draft create itself (source set on the next line)
    };
    const offenders: string[] = [];
    const counts: Record<string, number> = {};
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/kind\s*(?:=|===|:)\s*'receipt'/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
        const win = lines.slice(Math.max(0, i - 3), i + 5).join('\n');
        if (/source/.test(win) || /isUploadedReceipt/.test(win)) return;
        const rel = path.relative(root, f);
        counts[rel] = (counts[rel] ?? 0) + 1;
      });
    }
    for (const [rel, n] of Object.entries(counts)) {
      if (n > (allowedUnfiltered[rel] ?? 0)) offenders.push(`${rel}: ${n} unfiltered (allowed ${allowedUnfiltered[rel] ?? 0})`);
    }
    expect(offenders).toEqual([]);
  });
});
