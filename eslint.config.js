import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', '.wrangler/', 'worker-configuration.d.ts'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['*.config.js', 'tests/**/*.{js,ts}', 'scripts/**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
  },
  {
    // Tests that run under jsdom.
    files: [
      'tests/**/*.integration.test.js',
      'tests/app/motion.test.js',
      'tests/app/discover.test.js',
      'tests/app/engagement.test.js',
      'tests/app/admin-beta.test.js',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['worker/**/*.ts', 'tests/**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      // Allow `const { id, ...rest } = obj` to drop fields.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['worker/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
  prettier,
);
