import { describe, it, expect } from 'vitest';
import {
  REDACTED,
  collectPasswordSecrets,
  redactText,
  redactProposedChanges,
  redactAssistantLogFields,
} from './assistantLogRedact.js';

const changes = [
  { key: 'password', value: 'Hunter2!x', label: 'Event password', proposedDisplay: '(set)' },
  { key: 'title', value: 'Pizza Night' },
];

describe('assistantLogRedact', () => {
  it('collects only password values', () => {
    expect(collectPasswordSecrets(changes)).toEqual(['Hunter2!x']);
    expect(collectPasswordSecrets(null)).toEqual([]);
    expect(collectPasswordSecrets([{ key: 'password', value: null }])).toEqual([]);
  });

  it('redacts the password change value but keeps others', () => {
    const out = redactProposedChanges(changes) as any[];
    expect(out[0].value).toBe(REDACTED);
    expect(out[0].proposedDisplay).toBe('(set)');
    expect(out[1].value).toBe('Pizza Night');
    expect(changes[0].value).toBe('Hunter2!x'); // input not mutated
  });

  it('redacts known secrets and password phrases in text', () => {
    expect(redactText('use Hunter2!x please', ['Hunter2!x'])).toBe(`use ${REDACTED} please`);
    expect(redactText('set the password to "abc123"')).toBe(`set the password to "${REDACTED}"`);
    expect(redactText('password: zzz')).toBe(`password: ${REDACTED}`);
    expect(redactText('make it password protected')).toBe('make it password protected');
  });

  it('redacts instruction, history and clarifying question, keeping the original untouched', () => {
    const input = {
      instruction: 'set password Hunter2!x',
      history: [{ role: 'user', content: 'password is Hunter2!x' }, { role: 'assistant', content: 'ok' }],
      proposedChanges: changes,
      clarifyingQuestion: 'Confirm Hunter2!x?',
    };
    const out = redactAssistantLogFields(input);
    expect(JSON.stringify(out)).not.toContain('Hunter2');
    expect(out.history![1].content).toBe('ok');
    expect(input.instruction).toContain('Hunter2!x');
  });
});
