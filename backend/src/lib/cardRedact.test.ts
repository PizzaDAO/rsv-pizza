import { describe, it, expect } from 'vitest';
import { redactCardNumbers, blandCallHadCard, safeTranscript } from './cardRedact.js';

describe('cardRedact', () => {
  it('masks card-number-shaped digit runs only', () => {
    expect(redactCardNumbers('it is 4242-4242-4242-4242 ok')).toBe('it is [redacted] ok');
    expect(redactCardNumbers('4000 0099 9000 0001')).toBe('[redacted]');
    expect(redactCardNumbers('call 555 010 1111, total $73.90')).toBe('call 555 010 1111, total $73.90');
    expect(redactCardNumbers(null)).toBe('');
  });

  it('treats card metadata, or missing metadata, as a card call', () => {
    expect(blandCallHadCard({ metadata: { hasPaymentCard: true } })).toBe(true);
    expect(blandCallHadCard({ metadata: { virtualCardId: 'ic_1' } })).toBe(true);
    expect(blandCallHadCard({})).toBe(true);
    expect(blandCallHadCard({ metadata: { aiPhoneCallId: 'x' } })).toBe(false);
  });

  it('withholds card-call transcripts', () => {
    expect(safeTranscript('code 739', { metadata: { hasPaymentCard: true } })).toBeNull();
    expect(safeTranscript('hello', { metadata: {} })).toBe('hello');
  });
});
