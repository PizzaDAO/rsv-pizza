/**
 * i18n Key Resolution Guardrail
 *
 * Statically scans frontend/src/**\/*.{ts,tsx} for `t('literal.key')` calls and
 * asserts every key resolves against the corresponding `en/<namespace>.json`.
 *
 * Catches the bug class that caused brick-oven-63995 / bellpepper-92571:
 * a developer renders `t('foo.bar')` but never adds the key, so the
 * fallback shows the raw key string in production.
 *
 * Scope:
 * - Only English locales are checked. Non-EN locales fall back to EN, so
 *   gaps there don't surface raw keys.
 * - Dynamic keys (`t(`foo.${x}`)`) are skipped with a console warning.
 * - Files inside __tests__, *.test.*, *.d.ts are ignored.
 *
 * Limitations:
 * - Uses regex, not a real AST. Multiple `useTranslation()` calls in the
 *   same file fall back to the most-recently-declared one above each `t(`
 *   call. This is a line-of-defense, not a proof.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.resolve(__dirname, '..', '..');
const LOCALES_DIR = path.resolve(__dirname, '..', 'locales', 'en');

type Violation = {
  file: string;
  line: number;
  namespace: string;
  key: string;
  reason: string;
};

type DynamicSkip = {
  file: string;
  line: number;
  snippet: string;
};

// ---------------------------------------------------------------------------
// Locale loading
// ---------------------------------------------------------------------------

function flattenKeys(obj: unknown, prefix = ''): Set<string> {
  const out = new Set<string>();
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) out.add(prefix);
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const sub of flattenKeys(v, next)) out.add(sub);
    } else {
      out.add(next);
    }
  }
  return out;
}

// i18next CLDR plural suffixes. A `t('foo', { count })` call resolves to one
// of these per locale (we only need to know they EXIST in en/<ns>.json).
const PLURAL_SUFFIXES = [
  '_zero',
  '_one',
  '_two',
  '_few',
  '_many',
  '_other',
  '_plural',
];

function hasPluralForm(nsKeys: Set<string>, key: string): boolean {
  for (const suffix of PLURAL_SUFFIXES) {
    if (nsKeys.has(key + suffix)) return true;
  }
  return false;
}

function loadNamespaces(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const ns = f.replace(/\.json$/, '');
    const raw = fs.readFileSync(path.join(LOCALES_DIR, f), 'utf-8');
    const json = JSON.parse(raw);
    map.set(ns, flattenKeys(json));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Source file walking
// ---------------------------------------------------------------------------

function walkSource(dir: string, acc: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip i18n directory itself (locale JSON + this test) and __tests__
      if (entry.name === '__tests__') continue;
      if (full === path.resolve(__dirname, '..')) continue; // skip i18n root
      walkSource(full, acc);
    } else if (entry.isFile()) {
      const name = entry.name;
      if (!/\.(ts|tsx)$/.test(name)) continue;
      if (/\.test\.(ts|tsx)$/.test(name)) continue;
      if (/\.d\.ts$/.test(name)) continue;
      acc.push(full);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

// Match `const <pattern> = useTranslation('ns')` AND capture the destructure
// pattern, so we can require it produces a plain `t` binding.
//
// This filters out aliased calls like:
//   const { t: tCommon } = useTranslation('common')
// which DO NOT bind plain `t`, so they shouldn't hijack the namespace for
// unrelated `t()` calls in the same file.
const USE_TRANSLATION_RE =
  /(\{[^{}]*\})\s*=\s*useTranslation\(\s*['"`]([^'"`]+)['"`]/g;

// Returns true iff the destructure pattern (the `{ ... }` group on the left
// side of the assignment) binds an un-aliased `t`.
function destructureBindsPlainT(pattern: string): boolean {
  // Strip outer braces.
  const inner = pattern.replace(/^\{|\}$/g, '');
  // Split on commas at depth 0. Patterns from useTranslation hooks don't
  // contain nested braces, so a simple split is fine.
  const parts = inner.split(',').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    // Plain `t` binding: just `t` (no colon).
    if (/^t\s*(?:=[^,]*)?$/.test(part)) return true;
  }
  return false;
}

// Match t('literal.key') / t("literal.key") / t(`literal.key`).
// Reject keys that contain $ or { (template-literal/dynamic).
// The leading boundary [^a-zA-Z0-9_$] avoids matching identifiers ending in t
// like `Object.entries(...).filter(...).at(`.
const T_CALL_RE = /(^|[^a-zA-Z0-9_$.])t\(\s*(['"`])([^'"`${}\\\n]+)\2/g;

// Detect dynamic key calls so we can warn instead of silently passing.
const T_DYNAMIC_RE = /(^|[^a-zA-Z0-9_$.])t\(\s*`[^`]*\$\{[^`]*`/g;

function findDefaultNamespaceAtLine(
  source: string,
  upToOffset: number
): string | undefined {
  // Find the most recent `useTranslation('ns')` above the given byte offset
  // whose destructure binds a plain `t` (i.e. not aliased like `t: tCommon`).
  USE_TRANSLATION_RE.lastIndex = 0;
  let last: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = USE_TRANSLATION_RE.exec(source)) !== null) {
    if (m.index >= upToOffset) break;
    const pattern = m[1];
    const ns = m[2];
    if (destructureBindsPlainT(pattern)) {
      last = ns;
    }
  }
  return last;
}

function offsetToLine(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('i18n key guardrail', () => {
  it('every literal t() key resolves in en/<namespace>.json', () => {
    const namespaces = loadNamespaces();
    const sources = walkSource(SRC_DIR);

    const violations: Violation[] = [];
    const dynamics: DynamicSkip[] = [];
    const unresolvedNs: Violation[] = [];

    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(SRC_DIR, file).replace(/\\/g, '/');

      // Collect dynamic-key warnings.
      T_DYNAMIC_RE.lastIndex = 0;
      let dm: RegExpExecArray | null;
      while ((dm = T_DYNAMIC_RE.exec(text)) !== null) {
        const line = offsetToLine(text, dm.index);
        dynamics.push({
          file: rel,
          line,
          snippet: dm[0].slice(0, 80),
        });
      }

      // Walk every literal t() call.
      T_CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = T_CALL_RE.exec(text)) !== null) {
        const rawKey = m[3];
        const callOffset = m.index + m[1].length; // start of the `t(`
        const line = offsetToLine(text, callOffset);

        let ns: string | undefined;
        let key: string;
        if (rawKey.includes(':')) {
          const idx = rawKey.indexOf(':');
          ns = rawKey.slice(0, idx);
          key = rawKey.slice(idx + 1);
        } else {
          ns = findDefaultNamespaceAtLine(text, callOffset);
          key = rawKey;
        }

        // Skip if we can't resolve a namespace at all (e.g. utility helpers
        // that wrap t — these are not the bug class we're guarding against).
        if (!ns) {
          unresolvedNs.push({
            file: rel,
            line,
            namespace: '',
            key,
            reason: 'no useTranslation() namespace in scope',
          });
          continue;
        }

        const nsKeys = namespaces.get(ns);
        if (!nsKeys) {
          violations.push({
            file: rel,
            line,
            namespace: ns,
            key,
            reason: `namespace "${ns}" has no en/<ns>.json file`,
          });
          continue;
        }

        if (!nsKeys.has(key) && !hasPluralForm(nsKeys, key)) {
          violations.push({
            file: rel,
            line,
            namespace: ns,
            key,
            reason: 'key missing from locale',
          });
        }
      }
    }

    if (dynamics.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[i18n-guardrail] ${dynamics.length} dynamic t() call(s) skipped (cannot statically verify):\n` +
          dynamics
            .slice(0, 20)
            .map((d) => `  - ${d.file}:${d.line}  ${d.snippet}`)
            .join('\n') +
          (dynamics.length > 20 ? `\n  ... and ${dynamics.length - 20} more` : '')
      );
    }

    if (unresolvedNs.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[i18n-guardrail] ${unresolvedNs.length} t() call(s) had no namespace in scope (skipped):\n` +
          unresolvedNs
            .slice(0, 20)
            .map((u) => `  - ${u.file}:${u.line}  t('${u.key}')`)
            .join('\n') +
          (unresolvedNs.length > 20 ? `\n  ... and ${unresolvedNs.length - 20} more` : '')
      );
    }

    if (violations.length > 0) {
      const grouped = new Map<string, Violation[]>();
      for (const v of violations) {
        const k = `${v.namespace}:${v.key}`;
        const arr = grouped.get(k) ?? [];
        arr.push(v);
        grouped.set(k, arr);
      }
      const summary = Array.from(grouped.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fullKey, occurrences]) => {
          const sites = occurrences
            .map((o) => `      ${o.file}:${o.line}`)
            .join('\n');
          return `  - ${fullKey}\n${sites}`;
        })
        .join('\n');

      const msg =
        `Found ${violations.length} unresolved i18n key call(s) (${grouped.size} unique key(s)).\n` +
        `Each call references a key that does not exist in en/<namespace>.json:\n` +
        summary +
        `\n\nFix: add the missing key(s) to the matching frontend/src/i18n/locales/en/<ns>.json.`;

      // Throwing rather than expect() so the message renders cleanly without
      // vitest's diff truncation.
      throw new Error(msg);
    }

    expect(violations).toEqual([]);
  });
});
