/**
 * Startup validation for signing secrets.
 *
 * Incident 2026-11-02: production ran with JWT_SECRET equal to the placeholder
 * in .env.example, so forged super_admin JWTs were accepted. In deployed
 * environments (production/preview) we now refuse to run with a missing, short
 * or placeholder secret. Never log the secret value itself.
 */

export const MIN_SECRET_LENGTH = 32;

/** Exact placeholder values shipped in .env.example (compared case-insensitively). */
const PLACEHOLDER_VALUES = ['your-secret-key-change-in-production'];

/** Substrings that mark a value as a template, not a real secret. */
const PLACEHOLDER_SUBSTRINGS = ['your-', 'change-me', 'changeme', 'placeholder', 'example'];

/** Secrets the backend requires when deployed. Add others here only if they are required at runtime. */
const REQUIRED_SECRETS = ['JWT_SECRET'] as const;

type Env = Record<string, string | undefined>;

/** True on Vercel production/preview or NODE_ENV=production. Tests and local dev are exempt. */
export function isDeployedEnv(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview';
}

/** Returns a reason string if the secret is unacceptable, otherwise null. */
export function secretProblem(value: string | undefined): string | null {
  if (!value || !value.trim()) return 'is missing';
  const lower = value.trim().toLowerCase();
  if (PLACEHOLDER_VALUES.includes(lower) || PLACEHOLDER_SUBSTRINGS.some((s) => lower.includes(s))) {
    return 'is a placeholder value';
  }
  if (value.length < MIN_SECRET_LENGTH) return `is shorter than ${MIN_SECRET_LENGTH} characters`;
  return null;
}

/** Throws if any required secret is unacceptable. No-op outside deployed environments. */
export function assertSecretsConfigured(env: Env = process.env): void {
  if (!isDeployedEnv(env)) return;
  const problems = REQUIRED_SECRETS.flatMap((name) => {
    const problem = secretProblem(env[name]);
    return problem ? [`${name} ${problem}`] : [];
  });
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start with insecure secrets: ${problems.join('; ')}. ` +
        `Set a random value of at least ${MIN_SECRET_LENGTH} characters (e.g. openssl rand -hex 32).`
    );
  }
}

/** The JWT signing secret. Fails closed: throws when unset, or weak in a deployed environment. */
export function getJwtSecret(env: Env = process.env): string {
  assertSecretsConfigured(env);
  const secret = env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}
