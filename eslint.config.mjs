import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const SERVER_ONLY = [
  { name: 'server-only', message: 'Not allowed in client code.' },
  { group: ['@/lib/db/service', '**/lib/db/service'], message: 'Service-role DB client is server-only. Never import it from components.' },
  { group: ['@/lib/providers/*', '**/lib/providers/*'], message: 'Fare providers are server-only (they hold PARSE_API_KEY).' },
  { group: ['@/lib/email/*', '**/lib/email/*'], message: 'Email transport is server-only (it holds RESEND_API_KEY).' },
  { group: ['@/lib/services/*', '**/lib/services/*'], message: 'Services are server-only.' },
];

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { paths: [SERVER_ONLY[0]], patterns: SERVER_ONLY.slice(1) }] },
  },
  {
    // Domain must stay pure: no provider types, no DB, no network.
    files: ['src/lib/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/lib/providers/*', '**/providers/*'], message: 'Domain must not depend on a provider implementation.' },
            { group: ['@/lib/db/*', '**/lib/db/*'], message: 'Domain must be I/O-free.' },
            { group: ['@/lib/services/*', '**/lib/services/*'], message: 'Domain must not depend on services.' },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'e2e/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];

export default eslintConfig;
