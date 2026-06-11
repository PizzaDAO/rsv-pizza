import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import gppTextContrast from './eslint-rules/gpp-theme-text-contrast.js';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // gpp-theme surfaces only: these render under the light .gpp-theme where
    // near-white amber text washes out. Keep this scope tight to avoid noise.
    files: [
      'src/components/payouts/**/*.{ts,tsx}',
      'src/components/payments-admin/**/*.{ts,tsx}',
      'src/components/payments-shared/**/*.{ts,tsx}',
      'src/pages/GPP27CreatePage.tsx',
      'src/pages/ConsolidatedReportPage.tsx',
      'src/pages/AdminPage.tsx',
      'src/pages/DJPage.tsx',
    ],
    plugins: { gpp: { rules: gppTextContrast.rules } },
    rules: {
      'gpp/text-contrast': 'error',
      'gpp/text-contrast-300': 'warn',
    },
  }
);
