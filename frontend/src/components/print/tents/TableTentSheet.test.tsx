import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TableTentPage } from './TableTentSheet';
import { tentDims } from '../layouts';

const data = {
  eventName: 'A very long event name that goes on and on and on',
  headline: 'Scan to RSVP',
  body: 'Long body '.repeat(40),
  dateLine: 'November 20, 2026 at 7:00 PM',
  qrUrl: 'https://example.test/slice',
  logoUrl: '/logo.png',
};

describe('TableTentPage sponsors and wifi', () => {
  it('renders at most 8 sponsor logos in a non-shrinking row, and a custom QR caption', () => {
    const logos = Array.from({ length: 11 }, (_, i) => `/s${i}.png`);
    const { container } = render(
      <TableTentPage paper="letter" data={{ ...data, sponsorLogos: logos, qrUrl: 'WIFI:T:WPA;S:Net;P:secret;;', qrCaptionText: 'Join WiFi: Net' }} />,
    );
    const bottom = container.querySelector('[data-tent-bottom]') as HTMLElement;
    expect(bottom.querySelectorAll('[data-tent-sponsor]').length).toBe(8);
    expect((bottom.querySelector('[data-tent-sponsors]') as HTMLElement).style.flexShrink).toBe('0');
    expect(bottom.textContent).toContain('Join WiFi: Net');
    expect(container.textContent).not.toContain('secret');
  });
  it('no sponsor row without logos', () => {
    const { container } = render(<TableTentPage paper="a4" data={data} />);
    expect(container.querySelector('[data-tent-sponsors]')).toBeNull();
  });
});

describe('TableTentPage fit', () => {
  it('keeps at least 0.4in / 10mm from the edge and the fold', () => {
    expect(tentDims('letter').safe).toBeGreaterThanOrEqual(0.4);
    expect(tentDims('letter').foldSafe).toBeGreaterThanOrEqual(0.4);
    expect(tentDims('a4').safe).toBeGreaterThanOrEqual(10);
    expect(tentDims('a4').foldSafe).toBeGreaterThanOrEqual(10);
  });

  it.each(['letter', 'a4'] as const)('%s: only the QR flexes; logo and text never shrink or overflow', (paper) => {
    const { container } = render(<TableTentPage paper={paper} data={data} />);
    const face = container.querySelector('[data-tent-bottom] > div') as HTMLElement;
    expect(face.style.overflow).toBe('hidden');
    const qr = face.querySelector('[data-tent-qr]') as HTMLElement;
    expect(qr.style.flexGrow).toBe('1');
    expect(qr.style.flexShrink).toBe('1');
    expect(qr.style.minHeight).toBe('0px');
    expect(qr.style.maxHeight).toBe(paper === 'letter' ? '2.5in' : '64mm');
    const logo = face.querySelector('[data-tent-logo]') as HTMLElement;
    expect(logo.style.flexShrink).toBe('0');
    expect(logo.style.maxWidth).toBe('40%');
    for (const child of Array.from(face.children)) {
      if (child !== qr) expect((child as HTMLElement).style.flexShrink).toBe('0');
    }
    expect(face.innerHTML).toContain('-webkit-line-clamp: 3');
  });
});
