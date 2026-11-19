import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const GUESTS = [
  { id: '1', name: 'Ada Lovelace', email: 'ada@secret-mail.example', approved: true, dietaryRestrictions: [], toppings: [], dislikedToppings: [] },
  { id: '2', name: 'bob@leaky.example', email: 'bob@leaky.example', approved: true, dietaryRestrictions: [], toppings: [], dislikedToppings: [] },
  { id: '3', name: '山田太郎', email: 'yamada@secret-mail.example', approved: true, dietaryRestrictions: [], toppings: [], dislikedToppings: [] },
];
const PARTY = { id: 'p1', name: 'Slice Night', inviteCode: 'abc', customUrl: 'slice', hostName: null, coHosts: [{ id: 'c', name: 'Ada', email: 'ada@secret-mail.example' }] };

const guestReads = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../contexts/PizzaContext', () => ({
  usePizza: () => ({
    party: PARTY,
    get guests() {
      guestReads.count++;
      return GUESTS;
    },
  }),
}));

import { NametagSheet } from './NametagSheet';
import { NametagBuilder } from './NametagBuilder';
import { PrintMaterials } from '../PrintTab';
import { buildBadges } from './nametagData';
import { getBadgeLayout } from '../layouts';

const labels = { host: 'Host', coHost: 'Co-host', partner: 'Partner' };

describe('email guard', () => {
  it('rendered sheet never contains an email address', () => {
    const badges = buildBadges(GUESTS as never, PARTY.coHosts as never, { source: 'going', roleLine: true, roleLabels: labels });
    const { container } = render(
      <NametagSheet layout={getBadgeLayout('avery-5395')} badges={badges} header={{ title: 'Slice Night', logoUrl: null }} outline="none" />,
    );
    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain('Co-host');
    expect(container.textContent).not.toMatch(/@/);
    expect(container.innerHTML).not.toMatch(/@/);
  });
});

describe('badge QR and name split', () => {
  const badges = [{ key: 'a', name: 'Ada Lovelace' }, { key: 'b', name: '山田 太郎' }, { key: 'c', name: 'Cher' }];
  const layout = getBadgeLayout('avery-5392');
  it('splits Latin names only, and draws the QR with a caption', () => {
    const { container } = render(
      <NametagSheet layout={layout} badges={badges} header={{ title: 'Slice', logoUrl: null, splitName: true, qrUrl: 'https://example.test/slice' }} outline="none" />,
    );
    const lasts = Array.from(container.querySelectorAll('[data-badge-last]')).map((n) => n.textContent);
    expect(lasts).toEqual(['Lovelace']);
    expect(container.querySelectorAll('[data-badge-qr]').length).toBe(3);
    expect(container.textContent).toContain('example.test/slice');
    expect(container.textContent).toContain('山田 太郎');
  });
  it('no QR and no split by default', () => {
    const { container } = render(<NametagSheet layout={layout} badges={badges} header={{ title: 'Slice', logoUrl: null }} outline="none" />);
    expect(container.querySelector('[data-badge-qr]')).toBeNull();
    expect(container.querySelector('[data-badge-last]')).toBeNull();
  });
});

describe('shared QR image and L4785 fit', () => {
  const l4785 = getBadgeLayout('avery-l4785');
  it('uses one pre-rendered QR source for every badge (no per-badge generation)', () => {
    const badges = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, name: `Guest ${i}` }));
    const src = 'data:image/png;base64,SHARED';
    const { container } = render(<NametagSheet layout={l4785} badges={badges} header={{ title: 'S', logoUrl: null, qrUrl: 'https://example.test/x', qrSrc: src }} outline="none" />);
    const imgs = Array.from(container.querySelectorAll('[data-badge-qr] img'));
    expect(imgs.length).toBe(10);
    expect(imgs.every((i) => i.getAttribute('src') === src)).toBe(true);
    expect(container.querySelector('[data-qr-pending]')).toBeNull();
  });
  it('shows a pending box (so printing waits) while the shared QR is generating', () => {
    const { container } = render(
      <NametagSheet layout={l4785} badges={[{ key: 'a', name: 'A B' }]} header={{ title: 'S', logoUrl: null, qrUrl: 'https://example.test/x', qrSrc: null }} outline="none" />,
    );
    expect(container.querySelector('[data-qr-pending]')).toBeTruthy();
  });
  it('short names stay on one line on small QR labels (no forced wrap)', () => {
    const { container } = render(
      <NametagSheet layout={l4785} badges={[{ key: 'a', name: 'Cher', role: 'Co-host' }]} header={{ title: 'S', logoUrl: null, qrUrl: 'https://example.test/x', qrSrc: 'data:image/png;base64,A' }} outline="none" />,
    );
    expect(container.querySelector('[data-badge-name]')!.children.length).toBe(1);
  });
  it('split + QR + role on L4785 scales text down so the block fits above the QR strip', () => {
    const badge = { key: 'a', name: 'Maximilian Wolfeschlegelsteinhausen', role: 'Co-host' };
    const { container } = render(
      <NametagSheet layout={l4785} badges={[badge]} header={{ title: 'S', logoUrl: null, splitName: true, qrUrl: 'https://example.test/x', qrSrc: 'data:image/png;base64,A' }} outline="none" />,
    );
    const pt = (sel: string) => Number((container.querySelector(sel) as HTMLElement).style.fontSize.replace('pt', ''));
    const first = pt('[data-badge-name]');
    const last = pt('[data-badge-last]');
    const role = Number(((container.querySelector('[data-badge-last]') as HTMLElement).nextElementSibling as HTMLElement).style.fontSize.replace('pt', ''));
    // available body height: 50mm label - 10.5 header - (20 QR + 3.3 caption + 1) - 2.5 = 12.7mm
    const availPt = (12.7 * 72) / 25.4;
    expect(first * 1.1 + last * 1.15 + role * 1.25 + 3.6).toBeLessThanOrEqual(availPt + 0.5);
    expect(first).toBeLessThan(14);
  });
});

describe('guest picker', () => {
  it('checklist filters by search, select none/all, and never shows emails', () => {
    const { container } = render(<NametagBuilder canViewGuests />);
    fireEvent.click(screen.getByRole('radio', { name: /sourcePick/ }));
    const picker = screen.getByTestId('guest-picker');
    expect(picker.textContent).toContain('Ada Lovelace');
    expect(picker.textContent).not.toMatch(/@/);
    fireEvent.change(screen.getByPlaceholderText('print.nametags.pickSearch'), { target: { value: 'ada' } });
    expect(picker.textContent).toContain('Ada Lovelace');
    expect(picker.textContent).not.toContain('山田太郎');
    fireEvent.click(screen.getByText('print.nametags.pickNone'));
    const printed = () => Array.from(container.querySelectorAll('[data-badge-name]')).map((n) => n.textContent);
    // "none" applies to the filtered list only: Ada is off, the others stay on.
    expect(printed().join('|')).not.toContain('Ada');
    expect(printed().join('|')).toContain('山田太郎');
    fireEvent.click(screen.getByText('print.nametags.pickAll'));
    expect(printed().join('|')).toContain('Ada');
    expect(container.innerHTML).not.toMatch(/secret-mail/);
  });
});

describe('NametagBuilder gating', () => {
  it('without guest access never reads the guest list or shows the picker', () => {
    guestReads.count = 0;
    render(<NametagBuilder canViewGuests={false} />);
    expect(guestReads.count).toBe(0);
    expect(screen.queryByRole('radio', { name: /sourcePick/ })).toBeNull();
  });
  it('without guest access never shows names from the guest list', () => {
    const { container } = render(<NametagBuilder canViewGuests={false} />);
    expect(container.textContent).not.toContain('Ada Lovelace');
    expect(container.textContent).not.toContain('山田太郎');
  });
  it('with guest access shows the names, still no emails', () => {
    const { container } = render(<NametagBuilder canViewGuests />);
    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).not.toMatch(/@/);
    expect(container.innerHTML).not.toMatch(/secret-mail/);
  });
});

describe('/shipping materials', () => {
  it('PrintMaterials renders no builders', () => {
    render(<PrintMaterials />);
    expect(screen.queryByTestId('nametag-builder')).toBeNull();
    expect(screen.queryByTestId('tent-builder')).toBeNull();
  });
});
