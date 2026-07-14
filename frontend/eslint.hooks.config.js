// Focused ESLint config: react-hooks/rules-of-hooks + no-unused-vars, over src.
//
// The full `npm run lint` carries pre-existing debt (no-explicit-any,
// exhaustive-deps warnings), so it can't gate PRs as-is. This config runs just
// the high-value, fully-clean rules so CI can block them without the debt noise:
//   - react-hooks/rules-of-hooks: a hook declared below an early return builds
//     fine yet black-screens at runtime (arugula-38633 v2, 2026-05-19).
//   - @typescript-eslint/no-unused-vars: dead-code ratchet, paid down to 0 in
//     cavatelli P1; this gate keeps it there.
//
// e2e/ is intentionally NOT matched: Playwright's `use` fixture param trips the
// hooks rule (false positive), and e2e is not shipped React anyway.
//
// Run via: npx eslint --config eslint.hooks.config.js "src/**/*.{ts,tsx}"
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['src/**/*.{ts,tsx}'],
  languageOptions: { parser: tseslint.parser },
  plugins: {
    'react-hooks': reactHooks,
    '@typescript-eslint': tseslint.plugin,
  },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    // cavatelli P2: long-tail lint errors paid down to 0; these gates keep them there.
    // Core ESLint rules (no plugin needed):
    'no-empty': 'error',
    'no-case-declarations': 'error',
    'no-useless-catch': 'error',
    'no-constant-binary-expression': 'error',
    'no-irregular-whitespace': 'error',
    'no-useless-escape': 'error',
    'prefer-const': 'error',
    // typescript-eslint rules:
    '@typescript-eslint/no-empty-object-type': 'error',
    '@typescript-eslint/prefer-as-const': 'error',
    '@typescript-eslint/ban-ts-comment': 'error',
  },
});
