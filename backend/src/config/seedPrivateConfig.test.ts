import { describe, it, expect } from 'vitest';
import { parseArgs, checkNpmSwallowed, describeDiff } from './seedPrivateConfig.js';

describe('seedPrivateConfig parseArgs', () => {
  it('parses --only X and --only=X and --dry-run', () => {
    expect(parseArgs(['--only', 'k', '--dry-run'])).toEqual({ only: 'k', dryRun: true });
    expect(parseArgs(['--only=k'])).toEqual({ only: 'k', dryRun: false });
    expect(parseArgs([])).toEqual({ dryRun: false });
  });
  it('fails closed on unknown tokens and missing values', () => {
    expect(() => parseArgs(['--onyl', 'k'])).toThrow(/unrecognized/);
    expect(() => parseArgs(['k'])).toThrow(/unrecognized/);
    expect(() => parseArgs(['--only'])).toThrow(/requires a key/);
    expect(() => parseArgs(['--only', '--dry-run'])).toThrow(/requires a key/);
    expect(() => parseArgs(['--only='])).toThrow(/requires a key/);
  });
  it('refuses when npm swallowed the flags', () => {
    expect(() => checkNpmSwallowed({ npm_config_only: 'k' })).toThrow(/--/);
    expect(() => checkNpmSwallowed({ npm_config_dry_run: 'true' })).toThrow(/--/);
    expect(() => checkNpmSwallowed({})).not.toThrow();
  });
});

describe('seedPrivateConfig describeDiff', () => {
  it('recurses one level and never prints values', () => {
    const old = { kind: 'value' as const, value: { weights: { a: 111, b: 222 }, tiers: { high: 333 } } };
    const next = { weights: { a: 111, b: 999, c: 444 }, tiers: { high: 555 } };
    const out = describeDiff(old, next).join('\n');
    expect(out).toContain('[weights]');
    expect(out).toContain('[tiers]');
    expect(out).toContain('keys added: c');
    expect(out).toMatch(/changed values among 2 shared key\(s\): 1/);
    expect(out).not.toMatch(/\d{3}/);
  });
  it('distinguishes absent from unparseable', () => {
    expect(describeDiff({ kind: 'absent' }, {}).join()).toMatch(/none/);
    expect(describeDiff({ kind: 'unparseable' }, {}).join()).toMatch(/unparseable/);
  });
});
