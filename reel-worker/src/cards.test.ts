import { describe, it, expect } from 'vitest'
import { endCardSvg, escapeXml, gridLayout, titleCardSvg, wrapText } from './cards.js'
import { chooseFit } from './media.js'
import { CLAIM_SQL } from './queue.js'
import { assertMusicKey, assertOutputPrefix } from './storage.js'

const brand = { red: '#ff393a', sky: '#7dd3f0', yellow: '#ffd800', ink: '#0b0b10' }

describe('wrapText / escapeXml', () => {
  it('wraps and ellipsises', () => {
    expect(wrapText('Slice Night at the Docks Downtown', 16, 2)).toEqual(['Slice Night at', 'the Docks…'])
  })
  it('keeps short text on one line', () => {
    expect(wrapText('Pizza Day', 16, 2)).toEqual(['Pizza Day'])
  })
  it('escapes xml', () => {
    expect(escapeXml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;')
  })
})

describe('gridLayout', () => {
  it('fits every tile inside the area', () => {
    for (const n of [1, 2, 3, 5, 8, 12]) {
      const g = gridLayout(n, 900, 600, 20)
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(n)
      expect(g.cols * g.cellW + (g.cols - 1) * 20).toBeLessThanOrEqual(900)
      expect(g.rows * g.cellH + (g.rows - 1) * 20).toBeLessThanOrEqual(600)
    }
  })
  it('is empty for no tiles', () => {
    expect(gridLayout(0, 900, 600, 20).cols).toBe(0)
  })
})

describe('card svgs', () => {
  const spec = { title: 'Slice <Night> & Co', city: 'Austin', dateLabel: 'May 22, 2026', brand }
  it('title card carries event name, city, date and GPP branding for both ratios', () => {
    for (const ratio of ['9x16', '16x9'] as const) {
      const svg = titleCardSvg({ ratio, spec, logo: null })
      expect(svg).toContain(ratio === '9x16' ? 'width="1080" height="1920"' : 'width="1920" height="1080"')
      expect(svg).toContain('SLICE &lt;NIGHT&gt; &amp;')
      expect(svg).toContain('AUSTIN - MAY 22, 2026')
      expect(svg).toContain('PARTY')
      expect(svg).toContain('Hub 191 Display')
    }
  })
  it('end card shows the domain, guest count and a tile per sponsor', () => {
    const logo = { uri: 'data:image/png;base64,AAAA', w: 200, h: 100 }
    const svg = endCardSvg({
      ratio: '9x16',
      spec: { guestCount: 80, siteDomain: 'example.com', brand },
      logo,
      gppLogo: null,
      sponsors: [logo, logo, logo],
    })
    expect(svg).toContain('example.com')
    expect(svg).toContain('80 PIZZA LOVERS')
    expect(svg.match(/fill="#ffffff"\/>/g)?.length).toBe(3)
  })
  it('end card falls back to a thank-you without a guest count', () => {
    const svg = endCardSvg({ ratio: '16x9', spec: { guestCount: null, siteDomain: 'example.com', brand }, logo: null, gppLogo: null, sponsors: [] })
    expect(svg).toContain('THANKS FOR COMING')
  })
})

describe('chooseFit', () => {
  it('covers when the shape matches and blur-fills otherwise', () => {
    expect(chooseFit(4000, 3000, 1920, 1080)).toBe('cover')
    expect(chooseFit(3000, 4000, 1080, 1920)).toBe('cover')
    expect(chooseFit(3000, 4000, 1920, 1080)).toBe('contain')
    expect(chooseFit(4000, 1000, 1080, 1920)).toBe('contain')
  })
})

describe('guards', () => {
  it('only allows reels/<party>/<reel> output prefixes', () => {
    expect(() => assertOutputPrefix('reels/11111111-2222-3333-4444-555555555555/66666666-7777-8888-9999-000000000000')).not.toThrow()
    expect(() => assertOutputPrefix('reels/../x')).toThrow()
    expect(() => assertOutputPrefix('calls/abc')).toThrow()
  })
  it('only allows audio under songs/', () => {
    expect(() => assertMusicKey('songs/house/a b.mp3')).not.toThrow()
    expect(() => assertMusicKey('songs/../a.mp3')).toThrow()
    expect(() => assertMusicKey('other/a.mp3')).toThrow()
    expect(() => assertMusicKey('songs/a.exe')).toThrow()
  })
  it('claims with SKIP LOCKED and a retry cap', () => {
    expect(CLAIM_SQL).toContain('FOR UPDATE SKIP LOCKED')
    expect(CLAIM_SQL).toContain("status = 'queued'")
    expect(CLAIM_SQL).toContain('attempts < $1')
  })
})
