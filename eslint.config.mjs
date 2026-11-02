// Lint catches likely bugs; Prettier owns formatting. See .claude/rules/testing-runtime.md.
import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', '.astro/', '.wrangler/', 'playwright-report/', 'test-results/'],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  {
    rules: {
      'array-callback-return': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-constructor-return': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'prefer-promise-reject-errors': 'error',
      radix: 'error',
      // Storage can throw in private modes; those catches ignore it on purpose.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `new Promise((resolve) => setTimeout(resolve, ms))` and similar wrappers are deliberate.
      'no-promise-executor-return': 'off',
      // A leading underscore marks a name kept only for its position or type.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  // Promise and type-aware checks on TypeScript, where async Actions and delivery live.
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['tests/*.ts', 'playwright.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      // Async event listeners are deliberate; a rejection there reports like a thrown listener.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],
    },
  },
  // Build scripts, tests and tool config run on Node.
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Code that runs in the visitor's browser.
  {
    files: ['src/components/pre-paint.js', '**/*.astro'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
