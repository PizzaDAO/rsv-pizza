/**
 * sfincione-40417 (submissions): the payout-document sync passes must never reach
 * submission lines. markDuplicateLines' un-mark statement used to touch every
 * duplicate_line row with updated_by NULL regardless of origin.
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ sql: [] as string[] }));

vi.mock('../config/database.js', () => ({
  prisma: {
    $executeRaw: vi.fn(async (q: any) => {
      h.sql.push(String(q?.strings?.join('?') ?? q));
      return 0;
    }),
  },
}));

import { markDuplicateLines } from './pizzaLineSync.service.js';

describe('markDuplicateLines', () => {
  it('only joins payout documents, and the un-mark pass is limited to document lines', async () => {
    h.sql = [];
    await markDuplicateLines();
    expect(h.sql).toHaveLength(2);
    const [mark, unmark] = h.sql;
    // marking is driven by a payout_documents join, so submission lines (no document) can never match
    expect(mark).toContain('JOIN payout_documents d2 ON d2.id = li2.document_id');
    expect(unmark).toContain("li.excluded_reason = 'duplicate_line'");
    expect(unmark).toContain('li.document_id IS NOT NULL');
  });
});
