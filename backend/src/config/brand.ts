/**
 * White-label brand config (backend).
 *
 * Single source of truth for brand-specific values used server-side: display
 * name, domain, API domain, and the email from-address / support address.
 * Every value falls back to the RSV.Pizza defaults, so with NO `BRAND_*` env
 * vars set the backend behaves exactly as before — a different brand is a
 * matter of setting these at the deploy (Vercel project) level.
 *
 * See plans/whitelabel-brand-config.md. Call-site migration (replacing the ~18
 * hardcoded `from: 'RSV.Pizza <noreply@rsv.pizza>'` literals and `rsv.pizza`
 * links in email templates with these values) is Phase 2.
 */

/** Bare domain, no scheme, no trailing slash. e.g. "rsv.pizza" */
const domain = (process.env.BRAND_DOMAIN || 'rsv.pizza').trim().replace(/\/+$/, '');
/** Bare API domain, no scheme. e.g. "api.rsv.pizza" */
const apiDomain = (process.env.BRAND_API_DOMAIN || `api.${domain}`).trim().replace(/\/+$/, '');
/** Display name used in email chrome + API responses. */
const name = (process.env.BRAND_NAME || 'RSV.Pizza').trim();
/** The address emails are sent from (local part only, e.g. "noreply@rsv.pizza"). */
const noreplyEmail = (process.env.BRAND_NOREPLY_EMAIL || `noreply@${domain}`).trim();

export const brand = {
  name,
  domain,
  apiDomain,
  /** Canonical https origins, no trailing slash. */
  url: `https://${domain}`,
  apiUrl: `https://${apiDomain}`,
  noreplyEmail,
  supportEmail: (process.env.BRAND_SUPPORT_EMAIL || `help@${domain}`).trim(),
  /**
   * Resend/email `from` header. Defaults to exactly the previous hardcoded
   * literal `RSV.Pizza <noreply@rsv.pizza>` so wiring this in is a no-op until a
   * brand overrides BRAND_NAME / BRAND_NOREPLY_EMAIL.
   */
  fromEmail: `${name} <${noreplyEmail}>`,
} as const;

/** Build an absolute brand URL: brandUrl('my-party') -> https://rsv.pizza/my-party */
export function brandUrl(path = ''): string {
  return `${brand.url}/${String(path).replace(/^\/+/, '')}`;
}
