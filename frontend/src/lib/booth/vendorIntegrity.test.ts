import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import vendor from './vendor.json';

const DIR = resolve(__dirname, '../../../public/vendor/questpass-booth', vendor.version);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('vendored QuestPass Booth', () => {
  it('is pinned to a full commit sha and an exact version', () => {
    expect(vendor.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(vendor.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('every file matches its recorded sha256, and nothing else is in the folder', () => {
    const onDisk = walk(DIR)
      .map((f) => relative(DIR, f).split(sep).join('/'))
      .filter((f) => f !== 'SOURCE.md')
      .sort();
    expect(onDisk).toEqual(Object.keys(vendor.files).sort());
    for (const [rel, sha] of Object.entries(vendor.files)) {
      const actual = createHash('sha256').update(readFileSync(join(DIR, rel))).digest('hex');
      expect(actual, rel).toBe(sha);
    }
  });

  it('the SRI value is the sha384 of the booth script', () => {
    const js = readFileSync(join(DIR, 'questpass-booth.js'));
    expect(vendor.integrity).toBe(`sha384-${createHash('sha384').update(js).digest('base64')}`);
  });

  it('ships the Apache-2.0 LICENSE and NOTICE, the font licences and SOURCE.md', () => {
    for (const f of ['LICENSE', 'NOTICE', 'SOURCE.md', 'fonts/LICENSES.md']) {
      expect(existsSync(join(DIR, f)), f).toBe(true);
    }
    expect(readFileSync(join(DIR, 'LICENSE'), 'utf8')).toMatch(/Apache License/);
  });

  it('does not ship source maps or server code', () => {
    const names = walk(DIR).map((f) => f.toLowerCase());
    expect(names.some((n) => n.endsWith('.map') || n.endsWith('server.js') || n.endsWith('config.js'))).toBe(false);
  });
});
