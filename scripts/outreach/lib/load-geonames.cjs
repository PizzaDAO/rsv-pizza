// scripts/outreach/lib/load-geonames.cjs
// Parse the GeoNames cities15000.txt dataset into an in-memory index.
//
// File format (tab-separated, see https://download.geonames.org/export/dump/):
//   0  geonameid
//   1  name
//   2  asciiname
//   3  alternatenames (comma-separated)
//   4  latitude
//   5  longitude
//   6  feature class
//   7  feature code
//   8  country code (ISO2)
//   ...
//   14 population
//   ...
//
// The returned index exposes:
//   - rows           : Array<CityRow>          (deduped, primary row per geonameid)
//   - byKey          : Map<cityKey, CityRow>   (normName|ISO2 -> primary row)
//   - byNormName     : Map<normName, CityRow[]> (every alt-name expansion)
//
// "Primary row" means we only insert each geonameid once into `rows`, but we
// register the row under every alternate-name variant inside `byKey` and
// `byNormName` so lookups against unusual transliterations still resolve.

const fs = require('fs');
const readline = require('readline');
const { normalize, cityKey } = require('./normalize-city.cjs');

async function loadGeoNames(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`GeoNames file not found at ${filePath}`);
  }

  const rows = [];
  const byKey = new Map();
  const byNormName = new Map();

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 15) continue;
    const geonameid = cols[0];
    const name = cols[1];
    const asciiname = cols[2];
    const alternatenames = cols[3] || '';
    const lat = parseFloat(cols[4]);
    const lon = parseFloat(cols[5]);
    const iso2 = (cols[8] || '').toUpperCase();
    const population = parseInt(cols[14], 10) || 0;

    const row = {
      geonameid,
      name,
      asciiname,
      iso2,
      population,
      lat: isFinite(lat) ? lat : null,
      lon: isFinite(lon) ? lon : null,
    };
    rows.push(row);

    // Build every name variant -> row mapping.
    const variants = new Set([name, asciiname]);
    if (alternatenames) {
      for (const alt of alternatenames.split(',')) {
        const t = alt.trim();
        if (t) variants.add(t);
      }
    }

    for (const variant of variants) {
      const norm = normalize(variant);
      if (!norm) continue;
      const key = cityKey(variant, iso2);

      // Prefer keeping the highest-population row when there's a key collision
      // (e.g. multiple Springfields in US). The asciiname-based key for the
      // largest one should win.
      const existing = byKey.get(key);
      if (!existing || existing.population < row.population) {
        byKey.set(key, row);
      }

      const list = byNormName.get(norm);
      if (list) {
        if (!list.includes(row)) list.push(row);
      } else {
        byNormName.set(norm, [row]);
      }
    }
  }

  return { rows, byKey, byNormName, lineCount: lineNo };
}

module.exports = { loadGeoNames };
