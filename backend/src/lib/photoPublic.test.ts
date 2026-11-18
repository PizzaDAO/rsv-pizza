import { describe, it, expect } from 'vitest';
import { sanitizePhotoForPublic } from './photoPublic.js';

const row = {
  id: 'p1',
  url: 'https://x/y.jpg',
  uploaderName: 'Pat',
  uploaderEmail: 'pat@example.org',
  uploadedBy: 'guest-uuid',
  reviewedBy: 'user-uuid',
  guest: { id: 'guest-uuid', name: 'Pat' },
};

describe('sanitizePhotoForPublic', () => {
  it('strips email, guest id, uploader id and reviewer id', () => {
    const out = sanitizePhotoForPublic(row, null);
    expect(out.uploaderEmail).toBeNull();
    expect(out.uploadedBy).toBeNull();
    expect(out.reviewedBy).toBeNull();
    expect(out.guest).toEqual({ name: 'Pat' });
    expect(out.id).toBe('p1');
    expect(out.uploaderName).toBe('Pat');
    expect(JSON.stringify(out)).not.toContain('pat@example.org');
    expect(JSON.stringify(out)).not.toContain('guest-uuid');
  });
  it('lets the uploader keep their own email only', () => {
    expect(sanitizePhotoForPublic(row, 'PAT@example.org').uploaderEmail).toBe('pat@example.org');
    expect(sanitizePhotoForPublic(row, 'other@example.org').uploaderEmail).toBeNull();
  });
  it('handles a null guest', () => {
    expect(sanitizePhotoForPublic({ ...row, guest: null }, null).guest).toBeNull();
  });
});
