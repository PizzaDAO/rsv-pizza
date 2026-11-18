// Non-blocking (warn-only) guard for the CLAUDE.md form rules: use IconInput (incl. `multiline`)
// and Checkbox instead of raw <input type="checkbox">, <textarea>, or <label>-above-field.
// Not wired into CI; run manually: npx eslint --config eslint.forms.config.js "src/**/*.tsx"
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['src/**/*.tsx'],
  ignores: ['src/**/*.test.tsx', 'src/components/IconInput.tsx', 'src/components/Checkbox.tsx'],
  languageOptions: { parser: tseslint.parser },
  plugins: { 'react-hooks': reactHooks }, // only so existing eslint-disable comments resolve
  rules: {
    'no-restricted-syntax': [
      'warn',
      {
        selector: "JSXOpeningElement[name.name='textarea']",
        message: 'Use <IconInput multiline /> instead of a raw <textarea> (see CLAUDE.md).',
      },
      {
        selector: "JSXOpeningElement[name.name='label']",
        message: 'Use placeholders (and text-xs helper text) instead of <label> above fields (see CLAUDE.md).',
      },
      {
        selector: "JSXOpeningElement[name.name='input']:has(JSXAttribute[name.name='type'][value.value='checkbox'])",
        message: 'Use the <Checkbox> component instead of a raw checkbox input (see CLAUDE.md).',
      },
    ],
  },
});
