import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['app.js', 'src/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['*.config.js', 'tests/**/*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
  },
  prettier,
];
