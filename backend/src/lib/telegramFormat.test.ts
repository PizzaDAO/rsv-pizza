import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toTelegramHtml,
  isParseEntitiesError,
  formatForTelegram,
  postTelegramMessage,
  formatAnnouncement,
} from './telegramFormat.js';
import { sendServiceDm } from '../services/telegramSend.js';
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
    expect(toTelegramHtml('_hi_ __There Now__')).toBe('<i>hi</i> <i>There Now</i>');
    expect(toTelegramHtml('use snake_case_name here')).toBe('use snake_case_name here');
    expect(toTelegramHtml('a_b and c_d')).toBe('a_b and c_d');
  });
  it('does not touch underscores or asterisks inside URLs', () => {
    expect(toTelegramHtml('see https://x.com/a_b_c/*d* now')).toBe('see https://x.com/a_b_c/*d* now');
    expect(toTelegramHtml('_x_ https://x.com/_a_')).toBe('<i>x</i> https://x.com/_a_');
  });
  it('converts links and escapes attributes', () => {
    expect(toTelegramHtml('[RSVP](https://example.com/a_b?x=1&y="2")')).toBe(
      '<a href="https://example.com/a_b?x=1&amp;y=&quot;2&quot;">RSVP</a>',
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

describe('formatAnnouncement', () => {
  it('bolds the escaped subject and converts the body', () => {
    const f = formatAnnouncement('Doors <open>', 'Come **early** & enjoy');
    expect(f.parse_mode).toBe('HTML');
    expect(f.text).toBe(`<b>Doors &lt;open&gt;</b>\n\nCome <b>early</b> &amp; enjoy\n\n${BENNY_SIGNATURE}`);
    expect(f.plain).toBe(`Doors <open>\n\nCome **early** & enjoy\n\n${BENNY_SIGNATURE}`);
  });
  it('works without a subject', () => {
    expect(formatAnnouncement('', '**hi**').text).toBe(`<b>hi</b>\n\n${BENNY_SIGNATURE}`);
  });
});

describe('edge cases', () => {
  it('keeps ** and punctuation outside bare URLs', () => {
    expect(toTelegramHtml('**https://x.com/a_b**')).toBe('<b>https://x.com/a_b</b>');
    expect(toTelegramHtml('See https://x.com/a, then https://y.com/b.')).toBe('See https://x.com/a, then https://y.com/b.');
    expect(toTelegramHtml('(see https://x.com/a)')).toBe('(see https://x.com/a)');
    expect(toTelegramHtml('_https://x.com/a_')).toBe('<i>https://x.com/a</i>');
    expect(toTelegramHtml('*https://x.com/a*')).toBe('<b>https://x.com/a</b>');
  });
  it('supports parentheses inside link URLs', () => {
    expect(toTelegramHtml('[Pizza](https://en.wikipedia.org/wiki/Pizza_(food)) ok')).toBe(
      '<a href="https://en.wikipedia.org/wiki/Pizza_(food)">Pizza</a> ok',
    );
  });
  it('leaves snake_case and dunder identifiers alone', () => {
    expect(toTelegramHtml('def __init__ and my_var_name')).toBe('def __init__ and my_var_name');
    expect(toTelegramHtml('__Big News__')).toBe('<i>Big News</i>');
  });
  it('keeps dots, parentheses, emoji and underscores literal in a realistic template', () => {
    const src = '🍕 **Pizza Night** (Fri. 7pm) at my_place.\nRSVP: https://rsv.pizza/e/my_party_1 (free!) v1.2';
    expect(toTelegramHtml(src)).toBe(
      '🍕 <b>Pizza Night</b> (Fri. 7pm) at my_place.\nRSVP: https://rsv.pizza/e/my_party_1 (free!) v1.2',
    );
  });
  it('escapes HTML specials next to bold without breaking the tags', () => {
    expect(toTelegramHtml('**Tom & Jerry <3**')).toBe('<b>Tom &amp; Jerry &lt;3</b>');
  });
  it('strips NUL so user text cannot collide with placeholders', () => {
    expect(toTelegramHtml('x\u00000\u0000 https://a.com')).toBe('x0 https://a.com');
  });
});

describe('sendServiceDm', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (body: any, status = 200) => ({ status, json: async () => body });
  it('is plain by default', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const f = vi.fn().mockResolvedValue(reply({ ok: true, result: { message_id: 1 } }));
    vi.stubGlobal('fetch', f);
    await sendServiceDm('1', '**hi**');
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.parse_mode).toBeUndefined();
    expect(body.text).toContain('**hi**');
  });
  it("format 'auto' sends HTML and falls back to plain on a parse error", async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, 400))
      .mockResolvedValueOnce(reply({ ok: true, result: { message_id: 2 } }));
    vi.stubGlobal('fetch', f);
    const r = await sendServiceDm('1', '**hi**', undefined, { format: 'auto' });
    expect(r.ok).toBe(true);
    const first = JSON.parse(f.mock.calls[0][1].body);
    const second = JSON.parse(f.mock.calls[1][1].body);
    expect(first.parse_mode).toBe('HTML');
    expect(first.text).toContain('<b>hi</b>');
    expect(second.parse_mode).toBeUndefined();
    expect(second.text).toContain('**hi**');
  });
});
