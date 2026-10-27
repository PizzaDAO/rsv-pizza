import { describe, it, expect } from 'vitest';
import { RECEIPTS_JSON_SCHEMA, sanitizeLineSize } from './ocr.service.js';

// sfincione-40417: OpenAI strict structured-output rules, checked offline.
describe('RECEIPTS_JSON_SCHEMA strict-mode rules', () => {
  function walk(node: any, path: string, problems: string[]) {
    if (!node || typeof node !== 'object') return;
    const t = node.type;
    const isObj = t === 'object' || (Array.isArray(t) && t.includes('object'));
    if (isObj) {
      if (Array.isArray(t)) problems.push(`${path}: object type must not be a union (use anyOf)`);
      if (node.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
      const keys = Object.keys(node.properties ?? {});
      const req: string[] = node.required ?? [];
      for (const k of keys) if (!req.includes(k)) problems.push(`${path}.${k}: not in required`);
      for (const k of keys) walk(node.properties[k], `${path}.${k}`, problems);
    }
    if (node.items) walk(node.items, `${path}[]`, problems);
    if (node.anyOf) node.anyOf.forEach((n: any, i: number) => walk(n, `${path}.anyOf${i}`, problems));
  }
  it('every object is closed with all properties required', () => {
    const problems: string[] = [];
    walk(RECEIPTS_JSON_SCHEMA.schema, 'root', problems);
    expect(problems).toEqual([]);
  });
  it('size is an anyOf of object|null and required', () => {
    const li: any = (RECEIPTS_JSON_SCHEMA.schema as any).properties.receipts.items.properties.lineItems.items;
    expect(li.required).toContain('size');
    expect(li.properties.size.anyOf.map((n: any) => n.type)).toEqual(['object', 'null']);
  });
});

describe('sanitizeLineSize', () => {
  it('keeps valid sizes and drops empties', () => {
    expect(sanitizeLineSize({ label: 'Large', diameterCm: 33 })).toEqual({ label: 'Large', diameterCm: 33, lengthCm: null, widthCm: null });
    expect(sanitizeLineSize({ label: null, diameterCm: null })).toBeUndefined();
    expect(sanitizeLineSize(null)).toBeUndefined();
  });
});
