import { render } from '@react-email/render';
import { Resend } from 'resend';
import { createElement } from 'react';
import EventReminder, {
  renderPlainText,
  type EventReminderProps,
} from '../emails/EventReminder.js';
import { buildUnsubscribeUrl } from './unsubscribe.js';

let _resend: Resend | null = null;
export function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY not configured');
    _resend = new Resend(key);
  }
  return _resend;
}

export const REMINDER_FROM = 'RSV.Pizza <noreply@rsv.pizza>';

export type ReminderEventCtx = {
  partyName: string;
  partyDate: Date;
  partyTimezone: string | null;
  partyAddress: string | null;
  partyVenueName: string | null;
  partyImageUrl: string | null;
  inviteCode: string;
  customUrl: string | null;
};

export type ReminderGuest = {
  id: string;
  name: string;
  email: string;
};

export type ReminderHours = 1 | 2 | 3 | 4;

export function formatLocalTime(date: Date, tz: string | null): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz || undefined,
  });
}

export function shortLocalTime(date: Date, tz: string | null): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz || undefined,
  });
}

export function buildEventUrl(ctx: ReminderEventCtx): string {
  const slug = ctx.customUrl || ctx.inviteCode;
  return `https://rsv.pizza/${slug}`;
}

/**
 * Build the props + rendered html/text/subject for a reminder email,
 * without sending. Useful for batch sends where the caller composes the
 * Resend payload itself.
 */
export async function buildReminderPayload(
  guest: ReminderGuest,
  ctx: ReminderEventCtx,
  hours: ReminderHours,
  opts?: { publicOrigin?: string },
): Promise<{
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}> {
  const unsubscribeUrl = buildUnsubscribeUrl(guest.id);
  const props: EventReminderProps = {
    guestName: guest.name,
    partyName: ctx.partyName,
    whenText: formatLocalTime(ctx.partyDate, ctx.partyTimezone),
    venueName: ctx.partyVenueName,
    address: ctx.partyAddress,
    flyerImageUrl: ctx.partyImageUrl,
    eventUrl: buildEventUrl(ctx),
    unsubscribeUrl,
    hours,
    publicOrigin: opts?.publicOrigin,
  };
  const html = await render(createElement(EventReminder, props));
  const text = renderPlainText(props);
  const timeOnly = shortLocalTime(ctx.partyDate, ctx.partyTimezone);
  return {
    to: guest.email,
    subject: `Tonight at ${timeOnly}: ${ctx.partyName} 🍕`,
    html,
    text,
    unsubscribeUrl,
  };
}

/**
 * Send one reminder email. Used by the cron route (one-at-a-time inside
 * a concurrency pool). The backfill uses resend.batch.send() directly
 * with buildReminderPayload — don't fan out single sends from there.
 */
export async function sendReminder(
  guest: ReminderGuest,
  ctx: ReminderEventCtx,
  hours: ReminderHours,
  opts?: { publicOrigin?: string },
): Promise<string> {
  const payload = await buildReminderPayload(guest, ctx, hours, opts);
  const { data, error } = await getResend().emails.send({
    from: REMINDER_FROM,
    to: [payload.to],
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    headers: {
      'List-Unsubscribe': `<${payload.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  if (error) throw new Error(`Resend error: ${error.message ?? JSON.stringify(error)}`);
  if (!data) throw new Error('Resend returned no data');
  return data.id;
}
