import { describe, it, expect } from 'vitest';
import { PassThrough } from 'stream';
import { inflateRawSync } from 'zlib';
import { createZipArchive } from './zipArchive.js';

// Minimal zip reader (central directory) so the test needs no extra deps.
function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(off)).toBe(0x02014b50);
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    off += 46 + nlen + elen + clen;
  }
  return out;
}

describe('createZipArchive', () => {
  it('builds a real zip streamed to a writable, with the expected entries', async () => {
    const archive = await createZipArchive();
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve, reject) => {
      sink.on('end', resolve);
      archive.on('error', reject);
    });
    archive.pipe(sink);

    const photo = Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 251));
    archive.append(photo, { name: 'austin/party-1.jpg' });
    archive.append('readme text', { name: 'README.txt' });
    await archive.finalize();
    await done;

    const entries = readZip(Buffer.concat(chunks));
    expect([...entries.keys()].sort()).toEqual(['README.txt', 'austin/party-1.jpg']);
    expect(entries.get('austin/party-1.jpg')!.equals(photo)).toBe(true);
    expect(entries.get('README.txt')!.toString()).toBe('readme text');
  });
});
