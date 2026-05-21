import { describe, it, expect } from 'vitest';
import { detectPlatform } from './headerProfiles';
import { parseRows, defaultMapping } from './parsers';

describe('detectPlatform', () => {
  it('returns luma for headers containing approval_status + email', () => {
    expect(detectPlatform(['name', 'email', 'approval_status', 'ticket_type'])).toBe('luma');
  });

  it('returns meetup for headers containing RSVP + User ID', () => {
    expect(detectPlatform(['Name', 'User ID', 'Email Address', 'RSVP', 'Guests'])).toBe(
      'meetup'
    );
  });

  it('returns eventbrite for headers containing Order # + Attendee Status', () => {
    expect(
      detectPlatform([
        'Order #',
        'First Name',
        'Last Name',
        'Email',
        'Ticket Type',
        'Attendee Status',
      ])
    ).toBe('eventbrite');
  });

  it('returns csv (generic) when no profile matches', () => {
    expect(detectPlatform(['Full Name', 'Email Address', 'Notes'])).toBe('csv');
  });

  it('is case-insensitive on headers', () => {
    expect(detectPlatform(['APPROVAL_STATUS', 'EMAIL'])).toBe('luma');
  });
});

describe('defaultMapping', () => {
  it('maps Luma name+email+approval_status', () => {
    const m = defaultMapping('luma', ['name', 'email', 'approval_status']);
    expect(m.nameHeader).toBe('name');
    expect(m.emailHeader).toBe('email');
    expect(m.statusHeader).toBe('approval_status');
  });

  it('maps Eventbrite first+last name', () => {
    const headers = ['Order #', 'First Name', 'Last Name', 'Email', 'Attendee Status'];
    const m = defaultMapping('eventbrite', headers);
    expect(m.firstNameHeader).toBe('First Name');
    expect(m.lastNameHeader).toBe('Last Name');
    expect(m.emailHeader).toBe('Email');
    expect(m.statusHeader).toBe('Attendee Status');
  });

  it('maps generic CSV by substring', () => {
    const m = defaultMapping('csv', ['Full Name', 'E-mail Address', 'Notes']);
    expect(m.nameHeader).toBe('Full Name');
    expect(m.emailHeader).toBe('E-mail Address');
  });
});

describe('parseRows - Luma', () => {
  const headers = ['name', 'email', 'approval_status', 'ticket_type', 'checked_in_at'];

  it('maps approved → status CONFIRMED + approved true', () => {
    const rows = [['Alice Sun', 'alice@x.com', 'approved', 'Free', '']];
    const parsed = parseRows(headers, rows, 'luma');
    expect(parsed[0].status).toBe('CONFIRMED');
    expect(parsed[0].approved).toBe(true);
    expect(parsed[0].checkedIn).toBe(false);
  });

  it('maps pending_approval → status CONFIRMED + approved null', () => {
    const rows = [['Bob Lee', 'bob@y.com', 'pending_approval', '', '']];
    const parsed = parseRows(headers, rows, 'luma');
    expect(parsed[0].status).toBe('CONFIRMED');
    expect(parsed[0].approved).toBeNull();
  });

  it('maps waitlist → status WAITLISTED', () => {
    const rows = [['Carla', 'carla@z.com', 'waitlist', '', '']];
    const parsed = parseRows(headers, rows, 'luma');
    expect(parsed[0].status).toBe('WAITLISTED');
    expect(parsed[0].approved).toBeNull();
  });

  it('flags declined rows with skipReason', () => {
    const rows = [['Dee', 'dee@w.com', 'declined', '', '']];
    const parsed = parseRows(headers, rows, 'luma');
    expect(parsed[0].skipReason).toBe('declined');
  });

  it('marks rows as checked-in when checked_in_at is non-empty', () => {
    const rows = [['Ed', 'ed@v.com', 'approved', '', '2026-05-15T20:00:00Z']];
    const parsed = parseRows(headers, rows, 'luma');
    expect(parsed[0].checkedIn).toBe(true);
    expect(parsed[0].status).toBe('CHECKED_IN');
  });

  it('survives extra columns we do not care about', () => {
    const extra = [...headers, 'utm_source', 'coupon'];
    const rows = [['Fae', 'fae@u.com', 'approved', '', '', 'twitter', 'PROMO']];
    const parsed = parseRows(extra, rows, 'luma');
    expect(parsed[0].name).toBe('Fae');
    expect(parsed[0].errors).toEqual([]);
  });

  it('flags bad email format', () => {
    const rows = [['Gigi', 'broken@', 'approved', '', '']];
    const parsed = parseRows(headers, rows, 'luma');
    expect(parsed[0].errors).toContain('bad email');
  });
});

describe('parseRows - Meetup', () => {
  const headers = ['Name', 'User ID', 'Email Address', 'RSVP', 'Guests', 'RSVPed on'];

  it('maps Yes → approved', () => {
    const rows = [['Hank', '12345', 'hank@m.com', 'Yes', '0', '2026-05-15']];
    const parsed = parseRows(headers, rows, 'meetup');
    expect(parsed[0].status).toBe('CONFIRMED');
    expect(parsed[0].approved).toBe(true);
  });

  it('maps Waitlist → WAITLISTED', () => {
    const rows = [['Ivy', '67890', 'ivy@m.com', 'Waitlist', '0', '']];
    const parsed = parseRows(headers, rows, 'meetup');
    expect(parsed[0].status).toBe('WAITLISTED');
  });

  it('maps No → skipReason no-rsvp', () => {
    const rows = [['Jay', '11111', 'jay@m.com', 'No', '0', '']];
    const parsed = parseRows(headers, rows, 'meetup');
    expect(parsed[0].skipReason).toBe('no-rsvp');
  });
});

describe('parseRows - Eventbrite', () => {
  const headers = [
    'Order #',
    'First Name',
    'Last Name',
    'Email',
    'Ticket Type',
    'Attendee Status',
  ];

  it('concatenates First Name + Last Name', () => {
    const rows = [['1234', 'Carla', 'Pé', 'carla@eb.com', 'General', 'Attending']];
    const parsed = parseRows(headers, rows, 'eventbrite');
    expect(parsed[0].name).toBe('Carla Pé');
  });

  it('maps Attending → approved', () => {
    const rows = [['1', 'Kim', 'Doe', 'kim@eb.com', '', 'Attending']];
    const parsed = parseRows(headers, rows, 'eventbrite');
    expect(parsed[0].approved).toBe(true);
  });

  it('maps Checked In → checkedIn true + status CHECKED_IN', () => {
    const rows = [['2', 'Lex', 'Roe', 'lex@eb.com', '', 'Checked In']];
    const parsed = parseRows(headers, rows, 'eventbrite');
    expect(parsed[0].checkedIn).toBe(true);
    expect(parsed[0].status).toBe('CHECKED_IN');
  });

  it('maps Not Attending → skipReason', () => {
    const rows = [['3', 'Mae', 'Soe', 'mae@eb.com', '', 'Not Attending']];
    const parsed = parseRows(headers, rows, 'eventbrite');
    expect(parsed[0].skipReason).toBe('no-rsvp');
  });
});

describe('parseRows - Generic CSV', () => {
  it('maps name + email columns by substring', () => {
    const headers = ['Full Name', 'Email Address', 'Notes'];
    const rows = [['Nia O.', 'nia@g.com', 'VIP']];
    const parsed = parseRows(headers, rows, 'csv');
    expect(parsed[0].name).toBe('Nia O.');
    expect(parsed[0].email).toBe('nia@g.com');
    expect(parsed[0].status).toBe('CONFIRMED');
  });

  it('flags missing name', () => {
    const headers = ['Full Name', 'Email'];
    const rows = [['', 'orphan@g.com']];
    const parsed = parseRows(headers, rows, 'csv');
    expect(parsed[0].errors).toContain('missing name');
  });
});
