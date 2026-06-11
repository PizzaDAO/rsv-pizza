// Focused ESLint config: ONLY react-hooks/rules-of-hooks, over src.
//
// The full `npm run lint` carries ~678 pre-existing debt items (no-explicit-any,
// no-unused-vars, exhaustive-deps warnings), so it can't gate PRs as-is. But
// rules-of-hooks is the high-value incident class: a hook declared below an early
// return builds fine yet black-screens at runtime (arugula-38633 v2, 2026-05-19).
//
// This config runs just that one rule so CI can block it without the debt noise.
// We pull in ONLY the typescript-eslint parser (so .tsx parses) — none of its
// *rules* — which is why the `any`/unused-vars debt doesn't surface here.
// e2e/ is intentionally NOT matched: Playwright's `use` fixture param trips the
// rule (false positive), and e2e is not shipped React anyway.
//
// Run via: npx eslint --config eslint.hooks.config.js "src/**/*.{ts,tsx}"
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['src/**/*.{ts,tsx}'],
  languageOptions: { parser: tseslint.parser },
  plugins: { 'react-hooks': reactHooks },
  rules: { 'react-hooks/rules-of-hooks': 'error' },
});
