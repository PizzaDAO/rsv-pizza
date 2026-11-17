/**
 * One Resend sender for the site-aware (white-label) call sites. See plans/wl-custom-domain-email.md
 * §2.3.
 *
 *   - `from` is `site.fromEmail`; `reply_to` is added ONLY when the series configured one, so the
 *     JSON body of unbranded / not-configured mail is byte-identical to the old hand-rolled fetch.
 *   - Safety net: if a series sends from its own verified domain and Resend rejects it as unverified
 *     (partner deleted their DKIM record, etc.), retry once from the default fallback sender,
 *     clear `email_domain_verified_at`, and drop the siteBrand cache. The caller still gets a normal
 *     Response, so existing `.ok` / `.json()` / `.text()` handling is unchanged.
 */
import { prisma } from '../config/database.js';
import { invalidateSiteBrandCache, type SiteBrand } from './siteBrand.js';
import { writeSeriesAudit } from './seriesAudit.js';

const RESEND_URL = 'https://api.resend.com/emails';

export interface SendBrandedEmailArgs {
  site: Pick<SiteBrand, 'fromEmail' | 'fallbackFrom' | 'seriesId' | 'replyTo'>;
  apiKey: string;
  /** Everything except `from`/`reply_to`: to, subject, html, text, headers, attachments, ... */
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

/** Resend's "this sender domain is not verified" rejections (403/422). */
export function isUnverifiedDomainError(status: number, body: string): boolean {
  if (status !== 403 && status !== 422) return false;
  return /not verified|isn'?t verified|unverified|verify (your|the) domain|domain.{0,40}verif/i.test(body);
}

function post(fetchImpl: typeof fetch, apiKey: string, from: string, payload: Record<string, unknown>, replyTo?: string) {
  const body: Record<string, unknown> = { from, ...payload };
  if (replyTo) body.reply_to = replyTo;
  return fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function sendBrandedEmail(args: SendBrandedEmailArgs): Promise<Response> {
  const { site, apiKey, payload } = args;
  const doFetch: typeof fetch = args.fetchImpl ?? ((...a) => fetch(...a)); // global fetch looked up at call time
  const resp = await post(doFetch, apiKey, site.fromEmail, payload, site.replyTo);

  const usingPartnerSender = !!site.fallbackFrom && site.fallbackFrom !== site.fromEmail;
  if (resp.ok || !usingPartnerSender || (resp.status !== 403 && resp.status !== 422)) return resp;

  let text = '';
  try {
    text = await resp.clone().text();
  } catch {
    return resp;
  }
  if (!isUnverifiedDomainError(resp.status, text)) return resp;

  console.error(`[wl-email] sender reverted to fallback (series ${site.seriesId ?? '?'}): ${text.slice(0, 200)}`);
  if (site.seriesId) {
    const seriesId = site.seriesId;
    void prisma.eventSeries
      .updateMany({ where: { id: seriesId }, data: { emailDomainVerifiedAt: null } })
      .then(async (r) => {
        if (r.count === 0) return;
        await writeSeriesAudit(prisma, {
          seriesId,
          actorEmail: 'system:resend-send',
          actorKind: 'system',
          action: 'email.verification_revoked',
          changes: { emailDomainVerifiedAt: { old: 'verified', new: null } },
        });
      })
      .catch((e) => console.error('[wl-email] failed to clear email_domain_verified_at / audit it', e));
  }
  invalidateSiteBrandCache();
  return post(doFetch, apiKey, site.fallbackFrom!, payload, site.replyTo);
}
