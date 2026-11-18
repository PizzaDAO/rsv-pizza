import { describe, it, expect, beforeEach } from 'vitest';
import { saveEventDraft, loadEventDraft, loadEventDraftFor, seriesDraftKey, stampEventDraftOwner } from './eventDraft';

const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
});

describe('series drafts', () => {
  it('keeps a per-series draft separate from the /new draft', () => {
    saveEventDraft({ partyName: 'plain' }, 1000);
    saveEventDraft({ name: 'series' }, 1000, seriesDraftKey('gpp'));
    expect(loadEventDraft(2000)).toEqual({ partyName: 'plain' });
    expect(loadEventDraft(2000, seriesDraftKey('gpp'))).toEqual({ name: 'series' });
  });

  it('stamps the owner on series drafts and only restores for that user', () => {
    saveEventDraft({ name: 's' }, 1000, seriesDraftKey('gpp'));
    stampEventDraftOwner('A@x.org');
    expect(loadEventDraftFor('a@x.org', 2000, seriesDraftKey('gpp'))).toEqual({ name: 's' });
    expect(loadEventDraftFor('b@x.org', 2000, seriesDraftKey('gpp'))).toBeNull();
    expect(loadEventDraft(2000, seriesDraftKey('gpp'))).toBeNull();
  });
});
