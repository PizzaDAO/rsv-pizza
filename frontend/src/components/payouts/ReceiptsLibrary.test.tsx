import { describe, it, expect, vi } from 'vitest';
import '../../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const m = vi.hoisted(() => ({ fetchReceiptsLibrary: vi.fn(), removeOrderDraft: vi.fn() }));
vi.mock('../../lib/api', () => ({ fetchReceiptsLibrary: m.fetchReceiptsLibrary }));
vi.mock('../../lib/pizzaOrder', async () => {
  const actual = await vi.importActual<typeof import('../../lib/pizzaOrder')>('../../lib/pizzaOrder');
  return { ...actual, removeOrderDraft: m.removeOrderDraft };
});
vi.mock('../payments-shared', () => ({ ReceiptLightbox: () => null }));
vi.mock('../payments-shared/PayoutStatusPill', () => ({ PayoutStatusPill: () => null }));

import { ReceiptsLibrary } from './ReceiptsLibrary';

const real = { id: 'u1', payoutId: null, payoutStatus: null, url: 'https://x/y.jpg', fileName: 'receipt.jpg', fileSize: 1, mimeType: 'image/jpeg', ocrAmount: 12, ocrCurrency: 'USD', ocrConfidence: 1, uploadedByUserId: null, uploadedByName: 'Sam', uploadedByEmail: null, createdAt: '2026-10-30T00:00:00Z', source: 'upload' };
const draft = { ...real, id: 'd1', url: 'pizza-order://ord_1', fileName: "Sal's order A-100", mimeType: 'application/x-pizza-order', ocrAmount: null, ocrCurrency: null, source: 'ai_call', ocrSummary: 'AI phone order at Sal\'s: $187.40. Reminder only.', draftTotalCents: 18740 };

describe('ReceiptsLibrary: pizza-order reminder lines', () => {
  it('shows the shop total, has no dead View-full link or image, and can be removed', async () => {
    m.fetchReceiptsLibrary.mockResolvedValue([real, draft]);
    m.removeOrderDraft.mockResolvedValue({ removedDraft: true });
    const { container } = render(<ReceiptsLibrary partyId="p1" />);
    await waitFor(() => expect(screen.getByText("Sal's order A-100")).toBeTruthy());
    expect(screen.getByText(/Shop-confirmed total \$187\.40/)).toBeTruthy();
    expect(screen.getByText('Reminder, not a receipt')).toBeTruthy();
    // exactly one "View full" (the real receipt) and no element pointing at a pizza-order:// url
    expect(screen.getAllByText(/View full/)).toHaveLength(1);
    expect(container.querySelector('[href^="pizza-order"], [src^="pizza-order"]')).toBeNull();

    await userEvent.click(screen.getByLabelText(/Remove reminder/));
    expect(m.removeOrderDraft).toHaveBeenCalledWith('p1', 'd1');
    await waitFor(() => expect(screen.queryByText("Sal's order A-100")).toBeNull());
    expect(screen.getByText('receipt.jpg')).toBeTruthy();
  });
});
