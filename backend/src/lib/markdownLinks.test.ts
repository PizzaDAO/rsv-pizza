import { describe, it, expect } from 'vitest';
import {
  isValidLinkUrl,
  tokenizeMarkdownLinks,
  renderAnnouncementBodyHtml,
} from './markdownLinks.js';

describe('isValidLinkUrl', () => {
  it('accepts http, https, mailto', () => {
    expect(isValidLinkUrl('https://rsv.pizza')).toBe(true);
    expect(isValidLinkUrl('http://rsv.pizza')).toBe(true);
    expect(isValidLinkUrl('mailto:hi@rsv.pizza')).toBe(true);
  });
  it('rejects javascript and other schemes', () => {
    expect(isValidLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isValidLinkUrl('data:text/html,<script>')).toBe(false);
    expect(isValidLinkUrl('ftp://example.com')).toBe(false);
  });
});

describe('tokenizeMarkdownLinks', () => {
  it('handles empty string', () => {
    expect(tokenizeMarkdownLinks('')).toEqual([]);
  });
  it('handles plain text only', () => {
    expect(tokenizeMarkdownLinks('hello')).toEqual([{ kind: 'text', text: 'hello' }]);
  });
  it('parses valid link', () => {
    expect(tokenizeMarkdownLinks('a [b](https://x.com) c')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'link', label: 'b', url: 'https://x.com' },
      { kind: 'text', text: ' c' },
    ]);
  });
  it('treats invalid-scheme as literal text (regex stops at first `)`)', () => {
    // After concatenation the user-visible text is the original full literal.
    expect(tokenizeMarkdownLinks('[evil](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[evil](javascript:alert(1)' },
      { kind: 'text', text: ')' },
    ]);
  });
});

describe('renderAnnouncementBodyHtml', () => {
  it('renders a plain message with newline as <br />', () => {
    expect(renderAnnouncementBodyHtml('hi\nthere')).toBe('hi<br />there');
  });

  it('HTML-escapes text segments', () => {
    expect(renderAnnouncementBodyHtml('<script>&"')).toBe('&lt;script&gt;&amp;"');
  });

  it('renders a valid link as anchor with style + target attrs', () => {
    const out = renderAnnouncementBodyHtml('Visit [our site](https://rsv.pizza/x)');
    expect(out).toBe(
      'Visit <a href="https://rsv.pizza/x" style="color: #ff393a; text-decoration: underline;" target="_blank" rel="noopener noreferrer">our site</a>'
    );
  });

  it('renders mailto link', () => {
    const out = renderAnnouncementBodyHtml('Email [me](mailto:hi@rsv.pizza)');
    expect(out).toContain('href="mailto:hi@rsv.pizza"');
    expect(out).toContain('>me</a>');
  });

  it('renders invalid-scheme link as literal escaped text', () => {
    const out = renderAnnouncementBodyHtml('[evil](javascript:alert(1))');
    expect(out).toBe('[evil](javascript:alert(1))');
    expect(out).not.toContain('<a ');
  });

  it('handles the spec scenario: mixed valid + invalid + newline', () => {
    const out = renderAnnouncementBodyHtml(
      'Join us — [RSVP here](https://rsv.pizza/test) tonight!\n[evil](javascript:alert(1))'
    );
    expect(out).toContain(
      '<a href="https://rsv.pizza/test" style="color: #ff393a; text-decoration: underline;" target="_blank" rel="noopener noreferrer">RSVP here</a>'
    );
    expect(out).toContain('<br />');
    expect(out).toContain('[evil](javascript:alert(1))');
    expect(out).not.toContain('href="javascript:');
  });

  it('escapes quotes in URL attribute', () => {
    const out = renderAnnouncementBodyHtml('[x](https://x.com/?a="b)');
    expect(out).toContain('&quot;');
    expect(out).not.toMatch(/href="https:\/\/x\.com\/\?a="b"/);
  });

  it('escapes < in label', () => {
    const out = renderAnnouncementBodyHtml('[<b>bold</b>](https://x.com)');
    expect(out).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});
