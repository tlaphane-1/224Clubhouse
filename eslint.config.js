import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // Node-context files: contract tests, Playwright e2e/config, and ops/test
  // setup scripts read process.env and run under Node, not the browser.
  {
    files: [
      'src/__tests__/**/*.{js,jsx}',
      'e2e/**/*.{js,jsx}',
      'playwright.config.js',
      'test/**/*.{js,mjs}',
      'scripts/**/*.{js,mjs}',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
