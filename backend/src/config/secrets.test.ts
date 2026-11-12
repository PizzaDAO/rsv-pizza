import { describe, it, expect } from 'vitest';
import { assertSecretsConfigured, getJwtSecret, warnWeakOptionalSecrets, weakOptionalSecrets } from './secrets.js';

const STRONG = 'k9Qz7vXr2LmN4pTb8WcY1sHd6FgJ3aUe5RoVx0Ci';
const prod = (JWT_SECRET?: string) => ({ NODE_ENV: 'production', JWT_SECRET });

describe('assertSecretsConfigured', () => {
  it('rejects the .env.example placeholder', () => {
    expect(() => assertSecretsConfigured(prod('your-secret-key-change-in-production'))).toThrow(/placeholder/);
  });

  it('rejects generic placeholder substrings even when long', () => {
    expect(() => assertSecretsConfigured(prod('please-change-me-' + 'x'.repeat(40)))).toThrow(/placeholder/);
  });

  it('rejects short secrets', () => {
    expect(() => assertSecretsConfigured(prod('abc123'))).toThrow(/shorter than 32/);
  });

  it('rejects missing and empty secrets', () => {
    expect(() => assertSecretsConfigured(prod(undefined))).toThrow(/missing/);
    expect(() => assertSecretsConfigured(prod(''))).toThrow(/missing/);
  });

  it('accepts a strong random secret', () => {
    expect(() => assertSecretsConfigured(prod(STRONG))).not.toThrow();
  });

  it('also guards Vercel preview', () => {
    expect(() => assertSecretsConfigured({ VERCEL_ENV: 'preview', JWT_SECRET: 'short' })).toThrow();
  });

  it('does not throw outside deployed environments', () => {
    expect(() => assertSecretsConfigured({ NODE_ENV: 'test', JWT_SECRET: 'test-secret' })).not.toThrow();
    expect(() => assertSecretsConfigured({ JWT_SECRET: undefined })).not.toThrow();
  });

  it('never includes the secret value in the error', () => {
    expect(() => assertSecretsConfigured(prod('hunter2'))).toThrow(expect.objectContaining({ message: expect.not.stringContaining('hunter2') }));
  });
});

describe('warnWeakOptionalSecrets', () => {
  const run = (env: Record<string, string | undefined>) => {
    const lines: string[] = [];
    warnWeakOptionalSecrets(env, (m) => lines.push(m));
    return lines;
  };

  it('warns about weak shared secrets by name, without the value', () => {
    const lines = run({ NODE_ENV: 'production', PIZZADAO_TELEGRAM_SERVICE_KEY: 'hunter2', PIZZA_MCP_WEBHOOK_SECRET: STRONG });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/PIZZADAO_TELEGRAM_SERVICE_KEY is shorter than 32/);
    expect(lines[0]).not.toContain('hunter2');
  });

  it('ignores unset secrets and non-deployed environments', () => {
    expect(run({ NODE_ENV: 'production' })).toEqual([]);
    expect(run({ NODE_ENV: 'test', PIZZADAO_TELEGRAM_SERVICE_KEY: 'short' })).toEqual([]);
  });

  it('flags placeholders', () => {
    expect(weakOptionalSecrets({ PIZZADAO_FOLLOWUP_INBOUND_KEY: 'changeme-' + 'x'.repeat(40) })).toEqual([
      'PIZZADAO_FOLLOWUP_INBOUND_KEY is a placeholder value',
    ]);
  });
});

describe('getJwtSecret', () => {
  it('returns the secret when valid and fails closed when missing', () => {
    expect(getJwtSecret({ NODE_ENV: 'test', JWT_SECRET: 'test-secret' })).toBe('test-secret');
    expect(() => getJwtSecret({ NODE_ENV: 'test' })).toThrow(/not configured/);
  });
});
