// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import handler from './[slug]';

function run(slug: unknown, ua = 'Mozilla/5.0') {
  const res: any = {
    status: vi.fn(() => res),
    setHeader: vi.fn(() => res),
    send: vi.fn(() => res),
    redirect: vi.fn(() => res),
  };
  return handler({ query: { slug }, headers: { 'user-agent': ua } } as any, res).then(() => res);
}

describe('event/[slug] redirect (open redirect guard)', () => {
  it.each(['my-party', 'abc_123', 'ABC', 'sãopaulo', 'alicante(alacant)', '北京市'])('redirects %s', async (s) => {
    const res = await run(s);
    expect(res.redirect).toHaveBeenCalledWith(302, `/${s}`);
  });

  it.each(['/evil.com', '\\evil.com', '//evil.com', 'a/b', 'evil.com', 'http:evil', '', ['a', 'b'], undefined])(
    '404s for %j',
    async (s) => {
      const res = await run(s);
      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    },
  );
});
