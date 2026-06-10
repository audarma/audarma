import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // Generated / vendored output — never linted.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      // The library runs in the browser (React provider) and the CLI runs in
      // Node, so both global sets are valid across the codebase.
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // The adapter interfaces intentionally accept arbitrary user-defined
      // WHERE-clause shapes, so `any` is a deliberate part of the public API
      // surface — flag it for awareness without failing the lint.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // The CLI entrypoint loads the user config at runtime via require()/jiti
    // and uses the CommonJS `require.main === module` guard.
    files: ['cli/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
