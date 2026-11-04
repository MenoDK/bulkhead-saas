import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'jest.config.js', 'web'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // Nest resolves constructor dependencies from runtime type metadata, so injected classes must
    // stay *value* imports -- `consistent-type-imports` would break dependency injection.
    files: ['src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['src/database/migrate-cli.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // The landing page and the lab are plain browser scripts with no build step. The browser tests exercise them.
    files: ['site/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    // Command-line tools print to the terminal on purpose.
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
