import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const GUESTS = [
  { id: '1', name: 'ada l', email: 'ada@secret-mail.example', approved: true, dietaryRestrictions: [], toppings: [], dislikedToppings: [] },
  { id: '2', name: 'Plain Guest', email: 'plain@secret-mail.example', approved: true, dietaryRestrictions: [], toppings: [], dislikedToppings: [] },
];
const PARTY = { id: 'p1', name: 'Slice Night', inviteCode: 'abc', customUrl: 'slice', hostName: null, coHosts: [] };
vi.mock('../../../contexts/PizzaContext', () => ({ usePizza: () => ({ party: PARTY, guests: GUESTS }) }));

const api = vi.hoisted(() => ({ status: vi.fn(), members: vi.fn() }));
vi.mock('../../../lib/nametagsApi', () => ({ fetchNametagStatus: api.status, fetchNametagMembers: api.members }));

import { NametagSheet } from './NametagSheet';
import { NametagBuilder } from './NametagBuilder';
import { buildBadges, memberInfoLines, type NametagMember } from './nametagData';
import { getBadgeLayout, BADGE_LAYOUTS, perPage, pageCount } from '../layouts';

const labels = { host: 'Host', coHost: 'Co-host', partner: 'Partner' };
const MEMBER: NametagMember = {
  memberId: '42',
  name: 'Ada Lovelace',
  pfpUrl: 'https://img.example/ada.png',
  crews: [{ id: 'dev', label: 'Dev' }, { id: 'art', label: 'Art', emoji: 'A' }],
  city: 'Austin',
  levelCompleted: 3,
  levelTitle: 'Sous Chef',
};

describe('buildBadges with members', () => {
  it('uses the member name and attaches the member to the matched guest only', () => {
    const badges = buildBadges(GUESTS as never, [], { source: 'going', roleLabels: labels, members: { '1': MEMBER } });
    const ada = badges.find((b) => b.key === 'g-1')!;
    const plain = badges.find((b) => b.key === 'g-2')!;
    expect(ada.name).toBe('Ada Lovelace');
    expect(ada.member).toEqual(MEMBER);
    expect(plain.name).toBe('Plain Guest');
    expect(plain.member).toBeUndefined();
  });
  it('without members everything is plain', () => {
    const badges = buildBadges(GUESTS as never, [], { source: 'going', roleLabels: labels });
    expect(badges.every((b) => !b.member)).toBe(true);
  });
});

describe('member badge rendering', () => {
  it('prints picture, name, number, level, crews and city, and never an email', () => {
    const badges = buildBadges(GUESTS as never, [], { source: 'going', roleLabels: labels, members: { '1': MEMBER } });
    const { container } = render(<NametagSheet layout={getBadgeLayout('avery-5395')} badges={badges} header={{ title: 'Slice', logoUrl: null, levelLabel: 'Level' }} outline="none" />);
    expect(container.querySelectorAll('[data-badge]').length).toBe(2);
    expect(container.querySelectorAll('[data-badge-pfp]').length).toBe(1);
    expect(container.querySelector('[data-badge-pfp]')?.getAttribute('src')).toBe('https://img.example/ada.png');
    const text = container.textContent ?? '';
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('#42');
    expect(text).toContain('Level 3 Sous Chef');
    expect(text).toContain('Dev, A Art · Austin');
    expect(text).toContain('Plain Guest');
    expect(container.innerHTML).not.toMatch(/@/);
  });
  it('a plain badge has no picture or info lines', () => {
    const { container } = render(<NametagSheet layout={getBadgeLayout('avery-5392')} badges={[{ key: 'x', name: 'Cher' }]} header={{ title: 'Slice', logoUrl: null }} outline="none" />);
    expect(container.querySelector('[data-badge-pfp]')).toBeNull();
    expect(container.querySelector('[data-badge-member-info]')).toBeNull();
  });
  it('memberInfoLines skips missing fields', () => {
    expect(memberInfoLines({ memberId: '7', name: 'X', pfpUrl: 'https://i.example/x.png' })).toEqual(['#7']);
  });
  it('fits every layout (Letter and A4, 6-up and 8-up) with the right page counts', () => {
    const members = Array.from({ length: 13 }, (_, i) => ({ key: `m${i}`, name: 'Ada Lovelace', member: MEMBER }));
    for (const layout of BADGE_LAYOUTS) {
      const { container, unmount } = render(<NametagSheet layout={layout} badges={members} header={{ title: 'Slice', logoUrl: null }} outline="none" />);
      expect(container.querySelectorAll('[data-badge]').length).toBe(13);
      expect(container.querySelectorAll('[data-badge-pfp]').length).toBe(13);
      expect(pageCount(13, layout)).toBe(Math.ceil(13 / perPage(layout)));
      unmount();
    }
    expect(perPage(getBadgeLayout('avery-5392'))).toBe(6);
    expect(perPage(getBadgeLayout('avery-5395'))).toBe(8);
  });
});

describe('builder member toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.status.mockResolvedValue(true);
    api.members.mockResolvedValue({ memberLookup: 'ok', members: { '1': MEMBER } });
  });
  it('is hidden when the setting is off', async () => {
    api.status.mockResolvedValue(false);
    render(<NametagBuilder canViewGuests />);
    await waitFor(() => expect(api.status).toHaveBeenCalledWith('p1'));
    expect(screen.queryByTestId('member-tags')).toBeNull();
  });
  it('is hidden without Guests access and never asks the server', () => {
    render(<NametagBuilder canViewGuests={false} />);
    expect(api.status).not.toHaveBeenCalled();
    expect(screen.queryByTestId('member-tags')).toBeNull();
  });
  it('loads members only after the host ticks it, then prints member tags', async () => {
    render(<NametagBuilder canViewGuests />);
    const box = await screen.findByTestId('member-tags');
    expect(api.members).not.toHaveBeenCalled();
    fireEvent.click(box.querySelector('input,button,[role="checkbox"],label') as HTMLElement);
    await waitFor(() => expect(api.members).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(document.body.textContent).toContain('Ada Lovelace'));
  });
  it('lookup unavailable: says so and prints plain tags', async () => {
    api.members.mockResolvedValue({ memberLookup: 'unavailable', members: {} });
    render(<NametagBuilder canViewGuests />);
    const box = await screen.findByTestId('member-tags');
    fireEvent.click(box.querySelector('input,button,[role="checkbox"],label') as HTMLElement);
    await waitFor(() => expect(document.body.textContent).toMatch(/memberTagsUnavailable|Couldn't reach PizzaDAO/));
    expect(document.body.textContent).not.toContain('Ada Lovelace');
  });
});
