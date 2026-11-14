import { describe, it, expect } from 'vitest';
import { CHECKIN_QR_SRC, checkInQrAttachment, renderCheckInQrPng } from './qrCode.js';

describe('qrCode', () => {
  it('renders a PNG', async () => {
    const png = await renderCheckInQrPng('https://rsv.pizza/checkin/abc/g1');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('builds an inline CID attachment matching the src used in the email html', async () => {
    const a = await checkInQrAttachment('https://rsv.pizza/checkin/abc/g1');
    expect(CHECKIN_QR_SRC).toBe(`cid:${a.content_id}`);
    expect(a.content_type).toBe('image/png');
    expect(Buffer.from(a.content, 'base64').subarray(1, 4).toString()).toBe('PNG');
  });

  it('encodes different URLs differently', async () => {
    const a = await checkInQrAttachment('https://rsv.pizza/checkin/abc/g1');
    const b = await checkInQrAttachment('https://rsv.pizza/checkin/abc/g2');
    expect(a.content).not.toBe(b.content);
  });
});
