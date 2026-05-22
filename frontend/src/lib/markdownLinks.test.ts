import { describe, it, expect } from 'vitest';
import { tokenizeMarkdownLinks, isValidLinkUrl } from './markdownLinks';

describe('isValidLinkUrl', () => {
  it('accepts https/http/mailto', () => {
    expect(isValidLinkUrl('https://rsv.pizza')).toBe(true);
    expect(isValidLinkUrl('http://rsv.pizza')).toBe(true);
    expect(isValidLinkUrl('mailto:hi@rsv.pizza')).toBe(true);
    expect(isValidLinkUrl('HTTPS://RSV.PIZZA')).toBe(true);
  });

  it('rejects javascript: and other schemes', () => {
    expect(isValidLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isValidLinkUrl('data:text/html,<script>')).toBe(false);
    expect(isValidLinkUrl('ftp://example.com')).toBe(false);
    expect(isValidLinkUrl('/relative/path')).toBe(false);
  });
});

describe('tokenizeMarkdownLinks', () => {
  it('returns empty array for empty string', () => {
    expect(tokenizeMarkdownLinks('')).toEqual([]);
  });

  it('returns a single text token when no links present', () => {
    expect(tokenizeMarkdownLinks('Just a plain message')).toEqual([
      { kind: 'text', text: 'Just a plain message' },
    ]);
  });

  it('parses a single link', () => {
    expect(tokenizeMarkdownLinks('Visit [our site](https://rsv.pizza)')).toEqual([
      { kind: 'text', text: 'Visit ' },
      { kind: 'link', label: 'our site', url: 'https://rsv.pizza' },
    ]);
  });

  it('parses multiple links with text in between', () => {
    const out = tokenizeMarkdownLinks(
      'Join us — [RSVP here](https://rsv.pizza/test) tonight!'
    );
    expect(out).toEqual([
      { kind: 'text', text: 'Join us — ' },
      { kind: 'link', label: 'RSVP here', url: 'https://rsv.pizza/test' },
      { kind: 'text', text: ' tonight!' },
    ]);
  });

  it('treats invalid-scheme links as literal text', () => {
    // Regex stops at first `)`, so the trailing `)` is its own text token —
    // when concatenated for output the user still sees `[evil](javascript:alert(1))`.
    const out = tokenizeMarkdownLinks('[evil](javascript:alert(1))');
    expect(out).toEqual([
      { kind: 'text', text: '[evil](javascript:alert(1)' },
      { kind: 'text', text: ')' },
    ]);
  });

  it('handles a mix of valid and invalid links', () => {
    const out = tokenizeMarkdownLinks(
      'Hi [there](https://rsv.pizza) and [evil](javascript:alert(1))'
    );
    expect(out).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'link', label: 'there', url: 'https://rsv.pizza' },
      { kind: 'text', text: ' and ' },
      { kind: 'text', text: '[evil](javascript:alert(1)' },
      { kind: 'text', text: ')' },
    ]);
  });

  it('preserves newlines inside text segments', () => {
    const out = tokenizeMarkdownLinks('line1\n[a](https://x.com)\nline3');
    expect(out).toEqual([
      { kind: 'text', text: 'line1\n' },
      { kind: 'link', label: 'a', url: 'https://x.com' },
      { kind: 'text', text: '\nline3' },
    ]);
  });

  it('supports mailto links', () => {
    const out = tokenizeMarkdownLinks('Email [me](mailto:hi@rsv.pizza)');
    expect(out).toEqual([
      { kind: 'text', text: 'Email ' },
      { kind: 'link', label: 'me', url: 'mailto:hi@rsv.pizza' },
    ]);
  });
});
