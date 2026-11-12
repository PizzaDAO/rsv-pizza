// Headless render + flow check for the white-label streamlined create flow.
// Run from the repo root (so playwright resolves from root node_modules):
//   SCRATCH=<dir containing dist-default, dist-doge, dist-team1, dist-monad> node frontend/e2e/brand-create.mjs
// Builds must use VITE_API_URL=https://api.test.local and a dummy VITE_GOOGLE_MAPS_API_KEY.
// Google Places and the API are mocked with page.route; nothing leaves the machine.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const SCRATCH = process.env.SCRATCH;
if (!SCRATCH) throw new Error('set SCRATCH');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SERIES_BASE = {
  name: 'x', displayName: 'X', isActive: true, themeClass: null, logoUrl: null, ogImageUrl: null,
  description: null, eventType: null, publicTags: [], requireApproval: false, hideGuests: false,
  photosEnabled: true, photosPublic: true, eventDate: null, eventStartTime: null, eventEndTime: null,
};
const BRANDS = {
  doge: { port: 4171, series: { ...SERIES_BASE, slug: 'doge', displayName: 'Doge Day', brandName: 'Doge Day', createFlow: 'global_day', eventDate: '2027-11-02T00:00:00.000Z', nameTemplate: '{series} {city}' } },
  team1: { port: 4172, series: { ...SERIES_BASE, slug: 'team1', displayName: 'Team1', brandName: 'Team1', createFlow: 'meetup' } },
  monad: { port: 4173, series: { ...SERIES_BASE, slug: 'monad', displayName: 'Monad', brandName: 'Monad', createFlow: 'hackathon' } },
};

const CITY = {
  formatted_address: 'Austin, TX, USA', name: 'Austin', place_id: 'pidA', lat: 30.27, lng: -97.74,
  address_components: [
    { long_name: 'Austin', short_name: 'Austin', types: ['locality'] },
    { long_name: 'Texas', short_name: 'TX', types: ['administrative_area_level_1'] },
    { long_name: 'United States', short_name: 'US', types: ['country'] },
  ],
};
const VENUE = {
  formatted_address: '1 Main St, Austin, TX 78701, USA', name: 'Cool Bar', place_id: 'pidV', lat: 30.26, lng: -97.74,
  address_components: [
    { long_name: '1', short_name: '1', types: ['street_number'] },
    { long_name: 'Main St', short_name: 'Main St', types: ['route'] },
    ...CITY.address_components,
  ],
};

const MAPS_STUB = `
window.google = { maps: { event: { clearInstanceListeners() {} }, places: { Autocomplete: function (input) {
  window.__ac = this; this.l = {};
  this.addListener = (e, cb) => { this.l[e] = cb; };
  this.getPlace = () => window.__place;
} } } };`;

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`);
  if (!ok) failures++;
};

function startPreview(dist, port) {
  const proc = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: path.join(process.cwd(), 'frontend'), stdio: 'pipe' });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('preview timeout')), 20000);
    proc.stdout.on('data', (d) => { if (String(d).includes(String(port))) { clearTimeout(t); resolve(proc); } });
    proc.on('error', reject);
  });
}

async function setup(browser, { series, events = [], viewport, authed }) {
  const ctx = await browser.newContext({ viewport });
  const calls = { seriesGets: 0, posts: [], patches: [] };
  await ctx.route('https://maps.googleapis.com/maps/api/js*', (r) => r.fulfill({ contentType: 'text/javascript', body: MAPS_STUB }));
  await ctx.route('https://maps.googleapis.com/maps/api/timezone/*', (r) => r.fulfill({ json: { status: 'OK', timeZoneId: 'America/Chicago' } }));
  await ctx.route('https://api.test.local/**', async (r) => {
    const u = new URL(r.request().url());
    const m = r.request().method();
    if (series && u.pathname === `/api/series/${series.slug}`) { calls.seriesGets++; return r.fulfill({ json: { series } }); }
    if (series && u.pathname === `/api/series/${series.slug}/events`) return r.fulfill({ json: { events } });
    if (u.pathname === '/api/parties' && m === 'POST') {
      calls.posts.push(JSON.parse(r.request().postData() || '{}'));
      return r.fulfill({ json: { party: { id: 'p1', inviteCode: 'abc123', pinnedApps: [] } } });
    }
    if (u.pathname === '/api/parties/p1' && m === 'PATCH') { calls.patches.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ json: { party: {} } }); }
    if (u.pathname === '/api/auth/magic-link') return r.fulfill({ json: { success: true, isNewUser: false } });
    return r.fulfill({ status: 404, json: { error: 'mock' } });
  });
  if (authed) {
    await ctx.addInitScript(() => {
      localStorage.setItem('authToken', 'tok');
      localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'h@example.com', name: 'Host Name' }));
    });
  }
  const page = await ctx.newPage();
  return { ctx, page, calls };
}

async function pick(page, place) {
  await page.waitForFunction(() => !!window.__ac && !!window.__ac.l.place_changed);
  await page.evaluate((p) => {
    window.__place = {
      formatted_address: p.formatted_address, name: p.name, place_id: p.place_id,
      address_components: p.address_components,
      geometry: { location: { lat: () => p.lat, lng: () => p.lng } },
    };
    window.__ac.l.place_changed();
  }, place);
}

const OUT = path.join(process.env.OUT || SCRATCH);

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const servers = [];
  try {
    // ---- default build: unchanged ----
    {
      const proc = await startPreview(path.join(SCRATCH, 'dist-default'), 4170); servers.push(proc);
      const { ctx, page, calls } = await setup(browser, { series: null, viewport: { width: 390, height: 844 } });
      await page.goto('http://localhost:4170/new');
      await page.waitForSelector('[data-testid=event-form-name]');
      check('default: /new renders EventForm', true);
      check('default: no series flow', (await page.locator('[data-testid=series-create-form]').count()) === 0);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, 'create-rsv-default.png'), fullPage: true });
      await ctx.close();
    }

    for (const [name, { port, series }] of Object.entries(BRANDS)) {
      const proc = await startPreview(path.join(SCRATCH, `dist-${name}`), port); servers.push(proc);
      const base = `http://localhost:${port}`;
      const events = name === 'doge' ? [{ id: 'e1', name: 'Doge Day Austin', city: 'Austin', slug: 'doge-austin' }] : [];

      // unflagged series -> generic form; ?full=1 -> generic form
      {
        const { ctx, page } = await setup(browser, { series: { ...series, createFlow: null }, viewport: { width: 390, height: 844 } });
        await page.goto(`${base}/new`);
        await page.waitForSelector('[data-testid=event-form-name]');
        check(`${name}: createFlow null -> EventForm`, (await page.locator('[data-testid=series-create-form]').count()) === 0);
        await ctx.close();
      }
      {
        const { ctx, page } = await setup(browser, { series, viewport: { width: 390, height: 844 } });
        await page.goto(`${base}/new?full=1`);
        await page.waitForSelector('[data-testid=event-form-name]');
        check(`${name}: ?full=1 -> EventForm`, true);
        await ctx.close();
      }

      // logged-in happy path + screenshots
      for (const vp of [{ width: 390, height: 844, tag: '' }, { width: 1280, height: 800, tag: '-desktop' }]) {
        const { ctx, page, calls } = await setup(browser, { series, events, viewport: vp, authed: true });
        await page.goto(`${base}/new`);
        await page.waitForSelector('[data-testid=series-create-form]');
        await pick(page, name === 'team1' ? VENUE : CITY);
        if (name === 'doge') {
          await page.waitForSelector('[data-testid=series-create-name-preview]');
          check('doge: no date input rendered', (await page.locator('input[type=date]').count()) === 0);
          check('doge: locked date shown', (await page.locator('[data-testid=series-create-fixed-date]').innerText()).includes('November 2, 2027'));
          check('doge: name preview', (await page.locator('[data-testid=series-create-name-preview]').innerText()).trim() === 'Doge Day Austin');
          await page.waitForSelector('[data-testid=series-create-dedupe]');
          check('doge: soft dedupe hint', true);
        }
        if (name === 'team1') {
          const v = await page.locator('[data-testid=series-create-name]').inputValue();
          check('team1: name prefilled from template', v === 'Team1 Meetup Austin', v);
          await page.fill('[data-testid=series-create-start-date]', '2027-03-10');
        }
        if (name === 'monad') {
          await page.fill('[data-testid=series-create-name]', 'Monad Blitz Austin');
          await page.fill('[data-testid=series-create-start-date]', '2027-04-01');
          const end = await page.locator('[data-testid=series-create-end-date]').inputValue();
          check('monad: end date defaults to start + 1 day', end === '2027-04-02', end);
          await page.fill('[data-testid=series-create-end-date]', '2027-04-03');
          await page.fill('[data-testid=series-create-link]', 'https://devpost.com/monad');
          // submit blocked without capacity
          await page.click('[data-testid=series-create-submit]');
          await page.waitForSelector('[data-testid=series-create-error]');
          check('monad: capacity required (submit blocked)', calls.posts.length === 0 && /capacity/i.test(await page.locator('[data-testid=series-create-error]').innerText()));
          await page.fill('[data-testid=series-create-capacity]', '150');
        }
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT, `create-${name}${vp.tag}.png`), fullPage: true });
        if (vp.tag === '') {
          await page.click('[data-testid=series-create-submit]');
          await page.waitForURL(/\/host\/abc123\/checklist/, { timeout: 8000 }).catch(() => {});
          check(`${name}: goes to host page with checklist`, /\/host\/abc123\/checklist/.test(page.url()), page.url());
          const b = calls.posts[0] || {};
          check(`${name}: POST has seriesSlug`, b.seriesSlug === name);
          check(`${name}: POST has city/timezone`, b.city === 'Austin' && b.timezone === 'America/Chicago', JSON.stringify(b));
          check(`${name}: patched pinnedApps when backend did not pin`, (calls.patches[0]?.pinnedApps || []).includes('checklist'));
          if (name === 'doge') {
            check('doge: body name + addressIsCityDefault', b.name === 'Doge Day Austin' && b.addressIsCityDefault === true, JSON.stringify(b));
            check('doge: date is 2027-11-02 (local)', b.date === '2027-11-02T23:00:00.000Z', b.date);
          }
          if (name === 'team1') {
            check('team1: same-day endTime, venue kept', !!b.endTime && b.addressIsCityDefault === false && b.venueName === 'Cool Bar', JSON.stringify(b));
          }
          if (name === 'monad') {
            const days = (new Date(b.endTime) - new Date(b.date)) / 86400000;
            check('monad: multi-day, maxGuests, approval, link', days > 1 && b.maxGuests === 150 && b.requireApproval === true && b.externalLinks?.[0]?.url === 'https://devpost.com/monad', JSON.stringify(b));
          }
        }
        await ctx.close();
      }

      // logged-out: login modal at submit, form resumes + auto-submits after login
      if (name === 'doge') {
        const { ctx, page, calls } = await setup(browser, { series, events, viewport: { width: 390, height: 844 } });
        await page.goto(`${base}/new`);
        await page.waitForSelector('[data-testid=series-create-form]');
        await pick(page, CITY);
        await page.click('[data-testid=series-create-submit]');
        await page.waitForSelector('input[type=email]', { timeout: 5000 });
        check('doge: logged out -> login modal at submit', calls.posts.length === 0);
        await page.screenshot({ path: path.join(OUT, 'create-doge-login.png') });
        await page.evaluate(() => {
          localStorage.setItem('authToken', 'tok');
          localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'h@example.com', name: 'Host Name' }));
        });
        await page.reload();
        await page.waitForURL(/\/host\/abc123\/checklist/, { timeout: 8000 }).catch(() => {});
        check('doge: form resumes and auto-submits after login', calls.posts.length === 1 && /abc123/.test(page.url()), page.url());
        await ctx.close();
      }
    }

    // ---- keyless (osm/Photon) provider, the production default: doge build without VITE_MAP_PROVIDER ----
    if (process.env.OSM_DIST !== 'skip') {
      const proc = await startPreview(path.join(SCRATCH, 'dist-doge-osm'), 4174); servers.push(proc);
      const { ctx, page, calls } = await setup(browser, { series: BRANDS.doge.series, events: [], viewport: { width: 390, height: 844 }, authed: true });
      await ctx.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { features: [{
        geometry: { coordinates: [-97.74, 30.27] },
        properties: { name: 'Austin', state: 'Texas', country: 'United States', countrycode: 'us', type: 'city' },
      }] } }));
      await page.goto('http://localhost:4174/new');
      await page.waitForSelector('[data-testid=series-create-form]');
      await page.locator('form input[type=text]').first().fill('Austin');
      await page.locator('ul li button').first().dispatchEvent('mousedown');
      await page.waitForSelector('[data-testid=series-create-name-preview]');
      check('osm: doge name preview', (await page.locator('[data-testid=series-create-name-preview]').innerText()).trim() === 'Doge Day Austin');
      await page.click('[data-testid=series-create-submit]');
      await page.waitForURL(/\/host\/abc123\/checklist/, { timeout: 8000 }).catch(() => {});
      check('osm: doge create works', calls.posts.length === 1 && calls.posts[0].timezone === 'America/Chicago', JSON.stringify(calls.posts[0]));
      await ctx.close();
    }
  } finally {
    await browser.close();
    for (const s of servers) s.kill();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
