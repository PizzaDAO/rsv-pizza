#!/usr/bin/env node
/**
 * White-label guard (Phase 0). Fails a PR that ADDS new hardcoded brand chrome
 * in frontend/src or backend/src, so branding keeps flowing through the brand
 * config modules (frontend/src/config/brand.ts, backend/src/config/brand.ts)
 * instead of re-scattering literals. See plans/whitelabel-brand-config.md.
 *
 * Only scans lines ADDED in the PR diff — existing literals are left for the
 * Phase 2 codemod and never block unrelated work. Escape hatches:
 *   - add the file to scripts/brand-check-allowlist.json (the config modules,
 *     i18n source strings, env examples are already exempt), or
 *   - put `brand-check-ignore-line` in a comment on the offending line.
 *
 * Static + git-diff based, no deps. Local run:
 *   BASE_SHA=origin/master node scripts/check-no-hardcoded-brand.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCAN_DIRS = ['frontend/src', 'backend/src'];
const BASE = process.env.BASE_SHA || process.env.BASE_REF || 'origin/master';

// Unambiguous brand chrome. NOTE: "PizzaDAO" is intentionally excluded — many
// occurrences legitimately name the operating org, not brandable chrome (see
// the plan); triage those by hand rather than failing CI.
const PATTERNS = [
  { re: /rsv\.pizza/i, label: 'rsv.pizza domain' },
  { re: /RSV\.Pizza/, label: 'RSV.Pizza brand name' },
  { re: /znpiwdvvsqaxuskpfleo/, label: 'hardcoded Supabase project id' },
];

const IGNORE_MARK = 'brand-check-ignore-line';

function loadAllowlist() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'brand-check-allowlist.json'), 'utf8');
    return (JSON.parse(raw).allow || []).map((s) => s.toLowerCase());
  } catch (_) {
    return [];
  }
}

function rawDiff() {
  for (const range of [`${BASE}...HEAD`, `${BASE}`]) {
    try {
      return execSync(`git diff --unified=0 ${range} -- ${SCAN_DIRS.join(' ')}`, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (_) {
      /* try next range form */
    }
  }
  return '';
}

/** Parse a unified diff into added lines with their file + new-file line number. */
function addedLines(diff) {
  const out = [];
  let file = null;
  let lineNo = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice('+++ b/'.length);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      lineNo = parseInt(hunk[1], 10);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push({ file, lineNo, text: line.slice(1) });
      lineNo++;
    } else if (!line.startsWith('-') && !line.startsWith('\\')) {
      lineNo++;
    }
  }
  return out;
}

function main() {
  const allow = loadAllowlist();
  const isAllowed = (file) => !!file && allow.some((a) => file.toLowerCase().startsWith(a));

  const violations = [];
  for (const { file, lineNo, text } of addedLines(rawDiff())) {
    if (isAllowed(file)) continue;
    if (text.includes(IGNORE_MARK)) continue;
    for (const { re, label } of PATTERNS) {
      if (re.test(text)) violations.push({ file, lineNo, label, text: text.trim().slice(0, 120) });
    }
  }

  if (violations.length) {
    console.error('\n✗ Brand check FAILED — new hardcoded brand references added:\n');
    for (const v of violations) {
      console.error(`   ${v.file}:${v.lineNo}  [${v.label}]`);
      console.error(`      ${v.text}`);
    }
    console.error('\nRoute brand chrome through the config modules instead:');
    console.error('   frontend:  import { BRAND, brandUrl } from "@/config/brand"  (or relative)');
    console.error('   backend:   import { brand, brandUrl } from "../config/brand.js"');
    console.error('If a reference is genuinely required (e.g. a fallback), add');
    console.error('`brand-check-ignore-line` in a comment on that line, or add the file to');
    console.error('scripts/brand-check-allowlist.json.\n');
    process.exit(1);
  }

  console.log('✓ Brand check passed — no new hardcoded brand references.');
}

main();
