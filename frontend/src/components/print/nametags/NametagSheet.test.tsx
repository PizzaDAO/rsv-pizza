import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const GUESTS = [
  { id: '1', name: 'Ada Lovelace', email: 'ada@secret-mail.example', approved: true, dietaryRestrictions: [], toppings: [], dislikedToppings: [] },
  { id: '2', name: 'bob@leaky.example', email: 'bob@leaky.example', approved: true, dietaryRestrictions: [], toppings: [], dislikedToppings: [] },
  { id: '3', name: '山田太郎', email: 'yamada@secret-mail.example', approved: true, dietaryRestrictions: [], toppings: [], dislikedToppings: [] },
];
const PARTY = { id: 'p1', name: 'Slice Night', inviteCode: 'abc', customUrl: 'slice', hostName: null, coHosts: [{ id: 'c', name: 'Ada', email: 'ada@secret-mail.example' }] };

vi.mock('../../../contexts/PizzaContext', () => ({ usePizza: () => ({ party: PARTY, guests: GUESTS }) }));

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

describe('NametagBuilder gating', () => {
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
