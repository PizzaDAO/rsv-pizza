/**
 * scripts/outreach/lib/db.cjs
 * stagioni-29104 — shared DB helper for outreach scrapers.
 *
 * Reads DATABASE_URL from backend/.env (via dotenv at the call site).
 * Uses a single pg Pool that the caller is responsible for closing.
 *
 * upsertCommunity() is idempotent on (source, contact_url) and deliberately
 * NEVER overwrites `priority` or `notes` — those are manual fields preserved
 * across scraper re-runs.
 */
const { Pool } = require('pg');
const crypto = require('crypto');

let _pool = null;

function getPool() {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set. Source backend/.env or set it manually.');
  }
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}

async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Idempotent upsert on (source, contact_url). Returns { inserted: bool, id }.
 * Preserves manually-set priority + notes.
 *
 * @param {Object} row
 * @param {string} row.city
 * @param {string} [row.country]
 * @param {string} row.communityName
 * @param {'luma'|'meetup'|'curated'|'twitter'} row.source
 * @param {string} [row.contactHandle]
 * @param {string} row.contactUrl
 * @param {string} [row.contactEmail]
 * @param {number} [row.followerCount]
 * @param {number} [row.activityScore]
 */
async function upsertCommunity(row) {
  if (!row || !row.city || !row.communityName || !row.source || !row.contactUrl) {
    throw new Error(`upsertCommunity: missing required fields. got=${JSON.stringify(row)}`);
  }
  const pool = getPool();
  const id = crypto.randomUUID();
  const sql = `
    INSERT INTO outreach_communities
      (id, city, country, community_name, source, contact_handle, contact_url,
       contact_email, follower_count, activity_score)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (source, contact_url) DO UPDATE SET
      city           = EXCLUDED.city,
      country        = EXCLUDED.country,
      community_name = EXCLUDED.community_name,
      contact_handle = EXCLUDED.contact_handle,
      contact_email  = COALESCE(EXCLUDED.contact_email, outreach_communities.contact_email),
      follower_count = EXCLUDED.follower_count,
      activity_score = EXCLUDED.activity_score
      -- NOTE: priority and notes are NOT in SET clause — manual edits are preserved.
    RETURNING id, (xmax = 0) AS inserted
  `;
  const params = [
    id,
    row.city,
    row.country ?? null,
    row.communityName,
    row.source,
    row.contactHandle ?? null,
    row.contactUrl,
    row.contactEmail ?? null,
    row.followerCount ?? null,
    row.activityScore ?? null,
  ];
  const res = await pool.query(sql, params);
  return { id: res.rows[0].id, inserted: res.rows[0].inserted };
}

module.exports = { getPool, closePool, upsertCommunity };
