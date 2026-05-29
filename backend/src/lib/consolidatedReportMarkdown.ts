// scamorza-71819: Markdown renderer for the partner Consolidated Report.
//
// Optimised for LLM consumption: structured headings, pipe tables, an inlined
// JSON code block for strict parsers, and a short Notes section that calls out
// the data-quality caveats the unaided LLM wouldn't know (social-post views
// are hand-submitted; industry-RSVP domains drop personal providers; raw
// guest emails / unmasked notable-attendee emails / raw wallet addresses are
// never included by design).

import type { ConsolidatedReportJSON } from './consolidatedReport.js';

function escapePipe(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '0';
  return Number(n).toLocaleString('en-US');
}

export function renderConsolidatedReportMarkdown(report: ConsolidatedReportJSON): string {
  const lines: string[] = [];
  const partnerName = report.partnerName || 'Partner';
  const generatedAt = new Date().toISOString();

  // ---- Title + metadata block ------------------------------------------------
  lines.push(`# ${partnerName} — Consolidated Report`);
  lines.push('');
  lines.push('```yaml');
  lines.push(`tag: ${report.tag ?? 'null'}`);
  lines.push(`eventCount: ${report.eventCount}`);
  if (report.dateRange) {
    lines.push(`dateRange.start: ${report.dateRange.start}`);
    lines.push(`dateRange.end: ${report.dateRange.end}`);
  } else {
    lines.push('dateRange: null');
  }
  lines.push(`generatedAt: ${generatedAt}`);
  lines.push(`approvedOnly: ${report.approvedOnly}`);
  lines.push('```');
  lines.push('');

  // ---- At a glance KPI bullets ----------------------------------------------
  lines.push('## At a glance');
  lines.push('');
  lines.push(`- RSVPs: ${fmtNum(report.stats.totalRsvps)}`);
  lines.push(`- Approved attendees: ${fmtNum(report.stats.approvedGuests)}`);
  lines.push(`- Impressions (total page views): ${fmtNum(report.impressions.totalViews)}`);
  lines.push(`- Unique visitors: ${fmtNum(report.impressions.uniqueVisitors)}`);
  lines.push(`- Link clicks: ${fmtNum(report.clickStats.totalClicks)}`);
  lines.push(`- Unique clickers: ${fmtNum(report.clickStats.uniqueClickers)}`);
  if (report.stats.mailingListSignups !== null && report.stats.mailingListSignups !== undefined) {
    lines.push(`- Newsletter signups: ${fmtNum(report.stats.mailingListSignups)}`);
  }
  lines.push(`- Wallets submitted: ${fmtNum(report.stats.walletAddresses)}`);
  lines.push(`- POAP mints: ${fmtNum(report.stats.poapMints)}`);
  lines.push(`- POAP moments: ${fmtNum(report.stats.poapMoments)}`);
  lines.push(`- Social post views: ${fmtNum(report.stats.socialPostViews)}`);
  lines.push(`- Social posts: ${fmtNum(report.stats.socialPostCount)}`);
  lines.push('');

  // ---- Per-event table ------------------------------------------------------
  lines.push('## Events');
  lines.push('');
  if (report.events.length === 0) {
    lines.push('_No events in scope._');
    lines.push('');
  } else {
    lines.push('| Event | Date | RSVPs | Attendees | Impressions | Clicks |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: |');
    for (const ev of report.events) {
      lines.push(
        `| ${escapePipe(ev.name)} | ${fmtDate(ev.date)} | ${fmtNum(ev.rsvpCount)} | ${fmtNum(
          ev.approvedCount
        )} | ${fmtNum(ev.impressions.totalViews)} | ${fmtNum(ev.clicks)} |`
      );
    }
    lines.push('');
  }

  // ---- Industry RSVPs by city ----------------------------------------------
  const eventsWithIndustry = report.events.filter(
    e => Array.isArray(e.industryOrgs) && e.industryOrgs.length > 0
  );
  if (eventsWithIndustry.length > 0) {
    lines.push('## Industry RSVPs by city');
    lines.push('');
    for (const ev of eventsWithIndustry) {
      const cityCountry =
        [ev.city, ev.country].filter(Boolean).join(', ').trim() || ev.name;
      lines.push(`### ${cityCountry}`);
      lines.push('');
      for (const org of ev.industryOrgs) {
        lines.push(`- ${org.domain} (${org.count})`);
      }
      lines.push('');
    }
  }

  // ---- Social posts ---------------------------------------------------------
  lines.push('## Social posts');
  lines.push('');
  if (report.socialPosts.length === 0) {
    lines.push('_No social posts submitted._');
    lines.push('');
  } else {
    lines.push('| Event | Platform | Title or @handle | URL | Views |');
    lines.push('| --- | --- | --- | --- | ---: |');
    for (const sp of report.socialPosts) {
      const handle = sp.authorHandle ? `@${sp.authorHandle}` : '';
      const titleOrHandle = sp.title || handle || '';
      lines.push(
        `| ${escapePipe(sp.eventName)} | ${escapePipe(sp.platform)} | ${escapePipe(
          titleOrHandle
        )} | ${escapePipe(sp.url)} | ${fmtNum(sp.views || 0)} |`
      );
    }
    lines.push('');
  }

  // ---- Photo gallery sample -------------------------------------------------
  lines.push('## Photo gallery (sample)');
  lines.push('');
  if (report.featuredPhotos.length === 0) {
    lines.push('_No approved photos available._');
    lines.push('');
  } else {
    const sample = report.featuredPhotos.slice(0, 60);
    for (const ph of sample) {
      const evName = ph?.party?.name || '';
      const url = ph?.url || '';
      if (url) lines.push(`- ${escapePipe(evName)}: ${url}`);
    }
    lines.push('');
  }

  // ---- Notes ----------------------------------------------------------------
  lines.push('## Notes');
  lines.push('');
  lines.push(
    [
      'Social post views only counts views on posts hand-submitted by hosts or partners;',
      'organic reach not surfaced here is a significant undercount.',
      'Industry-RSVP domains are aggregated from approved-guest email addresses, with personal',
      'providers (Gmail / Outlook / Yahoo / etc.) and known placeholder domains excluded.',
      'Attendee email addresses and raw wallet addresses are intentionally omitted from this',
      'export for privacy; notable-attendee emails are reduced to their domain (e.g. @example.org).',
    ].join(' ')
  );
  lines.push('');

  // ---- Structured JSON block for strict parsers -----------------------------
  lines.push('## Structured data');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report, null, 2));
  lines.push('```');
  lines.push('');

  // ---- Footer ---------------------------------------------------------------
  lines.push(
    '_Generated by RSV.Pizza for AI consumption — read-only snapshot. Do not share publicly._'
  );

  return lines.join('\n');
}
