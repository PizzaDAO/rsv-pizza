import { describe, it, expect } from 'vitest';
import { sanitizeCoHosts } from './sanitizeCoHosts';

describe('sanitizeCoHosts', () => {
  it('strips email, canEdit, and isUnderboss from co-host objects', () => {
    const coHosts = [
      {
        id: '1',
        name: 'Alice',
        email: 'alice@example.com',
        canEdit: true,
        isUnderboss: true,
        avatar_url: 'https://example.com/alice.jpg',
        showOnEvent: true,
      },
    ];

    const result = sanitizeCoHosts(coHosts);

    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('email');
    expect(result[0]).not.toHaveProperty('canEdit');
    expect(result[0]).not.toHaveProperty('isUnderboss');
  });

  it('preserves id, name, avatar_url, showOnEvent, and social fields', () => {
    const coHosts = [
      {
        id: '1',
        name: 'Alice',
        email: 'alice@example.com',
        canEdit: true,
        isUnderboss: false,
        avatar_url: 'https://example.com/alice.jpg',
        showOnEvent: true,
        twitter: '@alice',
        website: 'https://alice.com',
        instagram: 'alice_insta',
      },
    ];

    const result = sanitizeCoHosts(coHosts);

    expect(result[0]).toEqual({
      id: '1',
      name: 'Alice',
      avatar_url: 'https://example.com/alice.jpg',
      showOnEvent: true,
      twitter: '@alice',
      website: 'https://alice.com',
      instagram: 'alice_insta',
    });
  });

  it('handles multiple co-hosts', () => {
    const coHosts = [
      { id: '1', name: 'Alice', email: 'a@b.com', canEdit: true, isUnderboss: false },
      { id: '2', name: 'Bob', email: 'b@b.com', canEdit: false, isUnderboss: true },
    ];

    const result = sanitizeCoHosts(coHosts);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: '1', name: 'Alice' });
    expect(result[1]).toEqual({ id: '2', name: 'Bob' });
  });

  it('returns empty array for null input', () => {
    expect(sanitizeCoHosts(null)).toEqual([]);
  });

  it('returns empty array for undefined input', () => {
    expect(sanitizeCoHosts(undefined)).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(sanitizeCoHosts('not an array' as any)).toEqual([]);
    expect(sanitizeCoHosts(42 as any)).toEqual([]);
    expect(sanitizeCoHosts({} as any)).toEqual([]);
  });

  it('returns empty array for empty array input', () => {
    expect(sanitizeCoHosts([])).toEqual([]);
  });

  it('handles co-hosts that already lack private fields', () => {
    const coHosts = [
      { id: '1', name: 'Alice', avatar_url: 'https://example.com/alice.jpg' },
    ];

    const result = sanitizeCoHosts(coHosts);

    expect(result[0]).toEqual({
      id: '1',
      name: 'Alice',
      avatar_url: 'https://example.com/alice.jpg',
    });
  });
});
