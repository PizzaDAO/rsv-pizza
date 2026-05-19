// marinara-67583: Outreach message templates for /underboss/outreach tab.
//
// Templates are stored inline (no DB table for v1). To tweak copy, edit this
// file and redeploy. The `id` field MUST stay stable across edits — old
// outreach_attempts rows reference these ids. If you make a material change,
// bump to `v2_<channel>` instead so historical rows still resolve.

export const OUTREACH_CALENDAR_LINK = 'https://cal.com/pizzadao/gpp-host';

export type OutreachChannel = 'twitter_dm' | 'email' | 'telegram';

export interface OutreachTemplate {
  id: string;
  channel: OutreachChannel;
  subject?: string;
  body: string;
}

export const OUTREACH_TEMPLATES: OutreachTemplate[] = [
  {
    id: 'v1_twitter',
    channel: 'twitter_dm',
    body: `hey {{community_name}} — we're running Global Pizza Party 2026 on Sept 20, a worldwide simultaneous pizza meetup. {{city}} doesn't have a host yet. would love to chat about you running one — free pizza budget, no upfront cost. 15 min call? {{calendar_link}}`,
  },
  {
    id: 'v1_email',
    channel: 'email',
    subject: 'Host the {{city}} Global Pizza Party 2026?',
    body: `Hi {{community_name}},

We're organizing Global Pizza Party 2026 — a global, simultaneous pizza meetup on Sept 20 across hundreds of cities. We don't have a host in {{city}} yet and your community seemed like a strong fit.

PizzaDAO covers the pizza budget; you bring the venue and the people. 200+ cities ran their own party last year.

15-minute intro call? {{calendar_link}}

— {{sender_name}}, PizzaDAO`,
  },
  {
    id: 'v1_telegram',
    channel: 'telegram',
    body: `hi {{community_name}} 👋 we're running Global Pizza Party 2026 (sept 20, simultaneous worldwide). {{city}} is uncovered. interested in hosting? we pay for the pizza. {{calendar_link}}`,
  },
];

export function renderTemplate(
  tpl: OutreachTemplate,
  vars: { community_name: string; city: string; calendar_link?: string; sender_name?: string }
): { subject?: string; body: string } {
  const calendar = vars.calendar_link ?? OUTREACH_CALENDAR_LINK;
  const sender = vars.sender_name ?? 'PizzaDAO';
  const replace = (s: string) =>
    s
      .replaceAll('{{community_name}}', vars.community_name)
      .replaceAll('{{city}}', vars.city)
      .replaceAll('{{calendar_link}}', calendar)
      .replaceAll('{{sender_name}}', sender);
  return {
    subject: tpl.subject ? replace(tpl.subject) : undefined,
    body: replace(tpl.body),
  };
}

export function getTemplate(channel: OutreachChannel): OutreachTemplate | undefined {
  return OUTREACH_TEMPLATES.find((t) => t.channel === channel);
}

export const OUTREACH_CHANNEL_LABELS: Record<OutreachChannel, string> = {
  twitter_dm: 'Twitter DM',
  email: 'Email',
  telegram: 'Telegram',
};
