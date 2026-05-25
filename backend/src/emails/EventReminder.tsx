import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export interface EventReminderProps {
  guestName: string;
  partyName: string;
  whenText: string;
  venueName: string | null;
  address: string | null;
  flyerImageUrl: string | null;
  eventUrl: string;
  unsubscribeUrl: string;
  /** 1, 2, 3, or 4 — picks which "See you in N hour(s)!" headline PNG. */
  hours: 1 | 2 | 3 | 4;
  /** Override the public origin where the headline PNGs live. Defaults to rsv.pizza. */
  publicOrigin?: string;
}

const PALETTE = {
  bg: '#f6f9fc',
  card: '#f9f9f9',
  text: '#333',
  heading: '#1a1a2e',
  cta: '#ff393a',
  muted: '#666',
  faint: '#999',
  border: '#e0e0e0',
  panelTop: '#c8e8f2',
  panelBot: '#9dd5e8',
} as const;

export default function EventReminder({
  guestName,
  partyName,
  whenText,
  venueName,
  address,
  flyerImageUrl,
  eventUrl,
  unsubscribeUrl,
  hours,
  publicOrigin = 'https://www.rsv.pizza',
}: EventReminderProps) {
  const headlineWord = hours === 1 ? 'hour' : 'hours';
  const headlineImg = `${publicOrigin}/reminder-see-you-in-${hours}-${headlineWord}.png`;
  const hoursLabel = hours === 1 ? '1 hour' : `${hours} hours`;
  const fallbackAddress = address || venueName || 'Location TBD';

  return (
    <Html>
      <Head />
      <Preview>{`${partyName} starts in about ${hoursLabel}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          {flyerImageUrl && (
            <Section style={flyerSection}>
              <Img src={flyerImageUrl} alt={partyName} style={flyerImg} />
            </Section>
          )}

          <Section style={headerPanel}>
            <Img
              src={headlineImg}
              alt={`See you in ${hoursLabel}!`}
              width={540}
              style={headlineStyle}
            />
          </Section>

          <Section style={detailsCard}>
            <Text style={partyNameStyle}>{partyName}</Text>
            <Text style={detailLine}>
              <strong>When:</strong> {whenText}
            </Text>
            {venueName && address ? (
              <Text style={detailLine}>
                <strong>Where:</strong> {venueName}
                <br />
                <span style={venueAddress}>{address}</span>
              </Text>
            ) : (
              <Text style={detailLine}>
                <strong>Where:</strong> {fallbackAddress}
              </Text>
            )}
          </Section>

          <Section style={ctaWrap}>
            <Link href={eventUrl} style={ctaButton}>
              View Event Page
            </Link>
          </Section>

          <Section style={footerSection}>
            <Text style={footerText}>See you there, {guestName}!</Text>
          </Section>

          <Section style={unsubSection}>
            <Text style={unsubText}>
              You're receiving this because you RSVP'd to {partyName} on RSV.Pizza.
              <br />
              <Link href={unsubscribeUrl} style={unsubLink}>
                Unsubscribe from reminders for this event
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/**
 * Plain-text version. React Email's `render(..., { plainText: true })`
 * exists but its strip is noisy; a hand-written short version is cleaner.
 */
export function renderPlainText(props: EventReminderProps): string {
  const hoursWord = props.hours === 1 ? 'hour' : 'hours';
  const addressText =
    props.venueName && props.address
      ? `${props.venueName}, ${props.address}`
      : props.address || props.venueName || 'Location TBD';
  return [
    `Hi ${props.guestName},`,
    ``,
    `Quick reminder — ${props.partyName} starts in about ${props.hours} ${hoursWord}.`,
    ``,
    `When: ${props.whenText}`,
    `Where: ${addressText}`,
    ``,
    `Event page: ${props.eventUrl}`,
    ``,
    `See you there!`,
    ``,
    `--`,
    `You're receiving this because you RSVP'd to ${props.partyName} on RSV.Pizza.`,
    `Unsubscribe from reminders for this event: ${props.unsubscribeUrl}`,
  ].join('\n');
}

const body: React.CSSProperties = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  lineHeight: '1.6',
  color: PALETTE.text,
  backgroundColor: PALETTE.bg,
  margin: 0,
  padding: '20px',
};

const container: React.CSSProperties = {
  maxWidth: '600px',
  margin: '0 auto',
};

const flyerSection: React.CSSProperties = {
  textAlign: 'center',
  marginBottom: '20px',
};

const flyerImg: React.CSSProperties = {
  maxWidth: '100%',
  borderRadius: '12px',
  display: 'block',
  margin: '0 auto',
};

const headerPanel: React.CSSProperties = {
  background: `linear-gradient(180deg, ${PALETTE.panelTop} 0%, ${PALETTE.panelBot} 100%)`,
  padding: '44px 20px',
  borderRadius: '12px',
  textAlign: 'center',
  marginBottom: '30px',
};

const headlineStyle: React.CSSProperties = {
  display: 'block',
  margin: '0 auto',
  maxWidth: '100%',
  height: 'auto',
};

const detailsCard: React.CSSProperties = {
  backgroundColor: PALETTE.card,
  padding: '30px',
  borderRadius: '12px',
  marginBottom: '20px',
};

const partyNameStyle: React.CSSProperties = {
  color: PALETTE.heading,
  fontSize: '22px',
  fontWeight: 'bold',
  margin: '0 0 20px 0',
};

const detailLine: React.CSSProperties = {
  margin: '10px 0',
  fontSize: '15px',
};

const venueAddress: React.CSSProperties = {
  color: PALETTE.muted,
  fontSize: '14px',
};

const ctaWrap: React.CSSProperties = {
  textAlign: 'center',
  margin: '30px 0',
};

const ctaButton: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: PALETTE.cta,
  color: '#fff',
  textDecoration: 'none',
  padding: '14px 32px',
  borderRadius: '8px',
  fontWeight: 600,
  fontSize: '16px',
};

const footerSection: React.CSSProperties = {
  borderTop: `1px solid ${PALETTE.border}`,
  paddingTop: '20px',
  marginTop: '30px',
  textAlign: 'center',
};

const footerText: React.CSSProperties = {
  color: PALETTE.muted,
  fontSize: '14px',
  margin: 0,
};

const unsubSection: React.CSSProperties = {
  textAlign: 'center',
  marginTop: '30px',
};

const unsubText: React.CSSProperties = {
  color: PALETTE.faint,
  fontSize: '12px',
  margin: 0,
};

const unsubLink: React.CSSProperties = {
  color: PALETTE.faint,
  textDecoration: 'underline',
};
