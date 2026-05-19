/**
 * scripts/outreach/lib/cache.cjs
 * stagioni-29104 — disk cache for scraper HTTP responses.
 *
 * Avoid re-hitting rate-limited public endpoints during local dev.
 * Cache files live in .cache/outreach/ (git-ignored).
 *
 * Usage:
 *   const { fetchCached } = require('./lib/cache.cjs');
 *   const body = await fetchCached(url, { ttlMs: 24 * 60 * 60 * 1000, noCache });
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.resolve(__dirname, '..', '..', '..', '.cache', 'outreach');

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cachePath(url) {
  const h = crypto.createHash('sha1').update(url).digest('hex');
  return path.join(CACHE_DIR, `${h}.json`);
}

function getCached(url, ttlMs) {
  try {
    const p = cachePath(url);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    if (Date.now() - obj.fetchedAt > ttlMs) return null;
    return obj;
  } catch {
    return null;
  }
}

function putCached(url, status, body, headers) {
  ensureCacheDir();
  const p = cachePath(url);
  const obj = { url, fetchedAt: Date.now(), status, body, headers: headers || {} };
  fs.writeFileSync(p, JSON.stringify(obj));
}

/**
 * Fetch with disk cache. Caches only 2xx responses by default.
 *
 * @param {string} url
 * @param {Object} [opts]
 * @param {number} [opts.ttlMs] - default 24h
 * @param {boolean} [opts.noCache] - bypass cache
 * @param {Object} [opts.fetchOpts] - passed to fetch()
 * @returns {Promise<{ status, body, headers, fromCache }>}
 */
async function fetchCached(url, opts = {}) {
  const ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
  if (!opts.noCache) {
    const c = getCached(url, ttlMs);
    if (c) return { status: c.status, body: c.body, headers: c.headers, fromCache: true };
  }
  const res = await fetch(url, opts.fetchOpts || {});
  const body = await res.text();
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  if (res.status >= 200 && res.status < 300) {
    putCached(url, res.status, body, headers);
  }
  return { status: res.status, body, headers, fromCache: false };
}

/** Throttle helper: returns promise that resolves after `ms` + 0-25% jitter. */
function sleepJittered(ms) {
  const jitter = ms * 0.25 * Math.random();
  return new Promise(r => setTimeout(r, ms + jitter));
}

module.exports = { fetchCached, getCached, putCached, cachePath, sleepJittered };
