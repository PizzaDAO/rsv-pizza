import { describe, it, expect } from 'vitest';
import { uuid, stripMarkdown } from './utils';

describe('uuid', () => {
  it('generates a valid UUID format string', () => {
    const id = uuid();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(id).toMatch(uuidRegex);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()));
    expect(ids.size).toBe(100);
  });

  it('generates string type', () => {
    expect(typeof uuid()).toBe('string');
  });

  it('has correct length (36 characters with hyphens)', () => {
    expect(uuid().length).toBe(36);
  });
});

describe('stripMarkdown', () => {
  it('removes bold formatting', () => {
    expect(stripMarkdown('Hello **bold** world')).toBe('Hello bold world');
    expect(stripMarkdown('Hello __bold__ world')).toBe('Hello bold world');
  });

  it('removes italic formatting', () => {
    expect(stripMarkdown('Hello *italic* world')).toBe('Hello italic world');
    expect(stripMarkdown('Hello _italic_ world')).toBe('Hello italic world');
  });

  it('removes strikethrough formatting', () => {
    expect(stripMarkdown('Hello ~~deleted~~ world')).toBe('Hello deleted world');
  });

  it('removes links but keeps text', () => {
    expect(stripMarkdown('Visit [Google](https://google.com) now')).toBe('Visit Google now');
  });

  it('removes images but keeps alt text', () => {
    expect(stripMarkdown('See ![alt text](https://img.com/photo.jpg) here')).toBe('See alt text here');
  });

  it('removes headers', () => {
    expect(stripMarkdown('# Title')).toBe('Title');
    expect(stripMarkdown('## Subtitle')).toBe('Subtitle');
    expect(stripMarkdown('###### Deep header')).toBe('Deep header');
  });

  it('removes blockquote markers', () => {
    expect(stripMarkdown('> This is a quote')).toBe('This is a quote');
  });

  it('removes inline code backticks', () => {
    expect(stripMarkdown('Use `code` here')).toBe('Use code here');
  });

  it('removes unordered list markers', () => {
    expect(stripMarkdown('- Item one')).toBe('Item one');
    expect(stripMarkdown('* Item two')).toBe('Item two');
    expect(stripMarkdown('+ Item three')).toBe('Item three');
  });

  it('removes ordered list markers', () => {
    expect(stripMarkdown('1. First item')).toBe('First item');
    expect(stripMarkdown('42. Numbered item')).toBe('Numbered item');
  });

  it('collapses multiple spaces and newlines', () => {
    expect(stripMarkdown('Hello   world\n\nnew paragraph')).toBe('Hello world new paragraph');
  });

  it('trims whitespace', () => {
    expect(stripMarkdown('  Hello world  ')).toBe('Hello world');
  });

  it('handles empty string', () => {
    expect(stripMarkdown('')).toBe('');
  });

  it('handles complex markdown', () => {
    const md = '# Welcome\n\nThis is **bold** and *italic* with a [link](https://example.com).\n\n> A quote\n\n- Item 1\n- Item 2';
    const result = stripMarkdown(md);
    expect(result).not.toContain('**');
    expect(result).not.toContain('[');
    expect(result).not.toContain('#');
    expect(result).not.toContain('>');
    expect(result).toContain('Welcome');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).toContain('link');
  });
});
