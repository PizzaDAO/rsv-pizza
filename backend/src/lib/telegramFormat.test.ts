import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toTelegramHtml,
  isParseEntitiesError,
  formatForTelegram,
  postTelegramMessage,
} from './telegramFormat.js';
import { BENNY_SIGNATURE } from './bennySignature.js';

describe('toTelegramHtml', () => {
  it('escapes & < >', () => {
    expect(toTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });
  it('converts **bold** and *bold*', () => {
    expect(toTelegramHtml('**hi** and *there*')).toBe('<b>hi</b> and <b>there</b>');
  });
  it('handles single * nested in **', () => {
    expect(toTelegramHtml('**a *b* c**')).toBe('<b>a <b>b</b> c</b>');
  });
  it('leaves unbalanced markers literal', () => {
    expect(toTelegramHtml('**oops')).toBe('**oops');
    expect(toTelegramHtml('5 * 3 = 15')).toBe('5 * 3 = 15');
    expect(toTelegramHtml('2*3*4')).toBe('2*3*4');
    expect(toTelegramHtml('*one')).toBe('*one');
  });
  it('converts _italic_ and __italic__ but not snake_case', () => {
    expect(toTelegramHtml('_hi_ __there__')).toBe('<i>hi</i> <i>there</i>');
    expect(toTelegramHtml('use snake_case_name here')).toBe('use snake_case_name here');
    expect(toTelegramHtml('a_b and c_d')).toBe('a_b and c_d');
  });
  it('does not touch underscores or asterisks inside URLs', () => {
    expect(toTelegramHtml('see https://x.com/a_b_c/*d* now')).toBe('see https://x.com/a_b_c/*d* now');
    expect(toTelegramHtml('_x_ https://x.com/_a_')).toBe('<i>x</i> https://x.com/_a_');
  });
  it('converts links and escapes attributes', () => {
    expect(toTelegramHtml('[RSVP](https://rsv.pizza/a_b?x=1&y="2")')).toBe(
      '<a href="https://rsv.pizza/a_b?x=1&amp;y=&quot;2&quot;">RSVP</a>',
    );
  });
  it('rejects non-http links', () => {
    expect(toTelegramHtml('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
  });
  it('escapes tags so raw HTML cannot be injected', () => {
    expect(toTelegramHtml('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('isParseEntitiesError', () => {
  it('matches a 400 parse error only', () => {
    expect(isParseEntitiesError({ ok: false, error_code: 400, description: "Bad Request: can't parse entities: Can't find end" })).toBe(true);
    expect(isParseEntitiesError({ ok: false, error_code: 400, description: 'chat not found' })).toBe(false);
    expect(isParseEntitiesError({ ok: true })).toBe(false);
    expect(isParseEntitiesError(null)).toBe(false);
  });
});

describe('formatForTelegram', () => {
  it('Auto converts, then signs', () => {
    const f = formatForTelegram('**hi**', 'Auto');
    expect(f.parse_mode).toBe('HTML');
    expect(f.text).toBe(`<b>hi</b>\n\n${BENNY_SIGNATURE}`);
    expect(f.plain).toBe(`**hi**\n\n${BENNY_SIGNATURE}`);
  });
  it('None and explicit modes pass text through', () => {
    expect(formatForTelegram('*x*', 'None').parse_mode).toBeUndefined();
    const m = formatForTelegram('*x*', 'Markdown');
    expect(m.parse_mode).toBe('Markdown');
    expect(m.text).toBe(m.plain);
  });
});

describe('postTelegramMessage', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (body: any, status = 200) => ({ status, json: async () => body });

  it('retries once as plain text on a parse-entities 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, 400))
      .mockResolvedValueOnce(reply({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await postTelegramMessage('https://t.invalid/sendMessage', { chat_id: '1' }, formatForTelegram('**hi**', 'Auto'));
    expect(r.json.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(first.parse_mode).toBe('HTML');
    expect(first.text).toContain('<b>hi</b>');
    expect(second.parse_mode).toBeUndefined();
    expect(second.text).toBe(`**hi**\n\n${BENNY_SIGNATURE}`);
  });

  it('does not retry other errors or plain sends', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ ok: false, error_code: 403, description: 'blocked' }, 403));
    vi.stubGlobal('fetch', fetchMock);
    await postTelegramMessage('https://t.invalid/x', { chat_id: '1' }, formatForTelegram('hi', 'Auto'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const fetch2 = vi.fn().mockResolvedValue(reply({ ok: false, error_code: 400, description: "can't parse entities" }, 400));
    vi.stubGlobal('fetch', fetch2);
    await postTelegramMessage('https://t.invalid/x', { chat_id: '1' }, formatForTelegram('hi', 'None'));
    expect(fetch2).toHaveBeenCalledTimes(1);
  });
});
