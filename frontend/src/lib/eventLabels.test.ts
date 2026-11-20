import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EVENT_LABEL_KEYS, EVENT_LABEL_ICONS, knownLabels } from './eventLabels';

const REPO = path.resolve(__dirname, '../../..');
const LOCALES = ['de', 'en', 'es', 'fr', 'ja', 'ko', 'pt', 'zh'];

describe('eventLabels', () => {
  it('keys match scripts/event-labels.json', () => {
    const json = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/event-labels.json'), 'utf8'));
    expect([...EVENT_LABEL_KEYS]).toEqual(json);
  });

  it('every key has an icon', () => {
    for (const k of EVENT_LABEL_KEYS) expect(EVENT_LABEL_ICONS[k]).toBeTruthy();
  });

  it('every key has a translation in every locale, and non-English locales are not English copies', () => {
    const read = (l: string) =>
      JSON.parse(fs.readFileSync(path.join(REPO, `frontend/src/i18n/locales/${l}/event.json`), 'utf8')).labels;
    const en = read('en');
    for (const l of LOCALES) {
      const labels = read(l);
      expect(labels, l).toBeTruthy();
      for (const k of EVENT_LABEL_KEYS) {
        expect(typeof labels.keys[k], `${l}.${k}`).toBe('string');
        expect(labels.keys[k].length).toBeGreaterThan(0);
      }
      expect(Object.keys(labels.keys).sort(), l).toEqual([...EVENT_LABEL_KEYS].sort());
      for (const f of ['title', 'helper', 'maxReached', 'filterAll']) expect(typeof labels[f], `${l}.${f}`).toBe('string');
      if (l !== 'en') {
        // translated, not English placeholders: only international loanwords may equal English
        const same = EVENT_LABEL_KEYS.filter((k) => labels.keys[k] === en.keys[k]);
        const loanwords = ['dj', 'workshop', 'networking', 'hackathon', 'gaming', 'art'];
        expect(same.filter((k) => !loanwords.includes(k)), `${l} untranslated`).toEqual([]);
        expect(labels.helper).not.toBe(en.helper);
      }
    }
  });

  it('knownLabels drops unknown keys, dedupes and keeps canonical order', () => {
    expect(knownLabels(['gaming', 'nope', 'dj', 'dj'])).toEqual(['dj', 'gaming']);
    expect(knownLabels(undefined)).toEqual([]);
  });
});
