// claim-later-nft: "claim your attendance NFT" email. Mirrors buildSurveyEmail (routes/survey.routes.ts).
// Only ever sent when NFT_CLAIM_EMAILS=on; branded-series parties are excluded by isNftEligible,
// so this always uses the PizzaDAO site.
import { siteForParty } from './siteBrand.js';

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function nftClaimEmailsEnabled(): boolean {
  return process.env.NFT_CLAIM_EMAILS === 'on';
}

export function buildNftClaimEmail(
  party: { name: string; eventImageUrl?: string | null },
  guest: { name: string },
  claimUrl: string,
): { subject: string; html: string } {
  const firstName = (guest.name || '').trim().split(/\s+/)[0] || 'there';

  const flyerBlock = party.eventImageUrl
    ? `
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="${party.eventImageUrl}" alt="${escape(party.name)}" style="max-width: 100%; border-radius: 12px;" />
          </div>`
    : '';

  const subject = `Claim your ${party.name} NFT 🍕`;

  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Claim your NFT</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${flyerBlock}
          <div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
            <h2 style="color: #1a1a2e; margin-top: 0;">Thanks for coming, ${escape(firstName)}!</h2>
            <p style="margin: 0; color: #333; font-size: 15px;">You were at <strong>${escape(party.name)}</strong>, so your attendance NFT is waiting. No wallet? Any wallet works. You can claim within 90 days.</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${claimUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600;">Claim your NFT</a>
          </div>
          <p style="color: #888; font-size: 12px; text-align: center;">This link is private to you. Don't forward it.</p>
        </body>
      </html>
    `;

  return { subject, html };
}

/** Send one claim email through Resend. Returns the Resend message id, or null on any failure. */
export async function sendNftClaimEmail(
  party: { name: string; eventImageUrl?: string | null; eventSeriesId?: string | null },
  guest: { name: string; email: string },
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return null;
  try {
    const site = await siteForParty(party, 'https://rsv.pizza'); // brand-check-ignore-line
    const { subject, html } = buildNftClaimEmail(party, guest, `${site.url}/nft/claim/${token}`);
    const resp = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify({ from: site.fromEmail, to: [guest.email], subject, html }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json().catch(() => ({}));
    return typeof data.id === 'string' ? data.id : 'sent';
  } catch {
    return null;
  }
}
