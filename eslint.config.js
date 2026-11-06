import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

// Layered architecture enforcement (see src/README.md).
// For each layer, list the layers it MAY import. Everything else is denied.
// Rules match the `#alias` import strings literally, so no import resolver is needed.
const ALLOW = {
  constants: [],
  config: ['constants'],
  errors: ['constants'],
  contexts: [],
  lib: ['config', 'constants', 'contexts', 'utils'],
  utils: ['config', 'constants', 'contexts', 'errors', 'lib'],
  models: ['constants'],
  schemas: ['constants'],
  repository: ['models', 'utils', 'lib', 'errors', 'config', 'constants'],
  services: ['repository', 'models', 'utils', 'lib', 'errors', 'config', 'constants'],
  controllers: ['services', 'utils', 'errors', 'lib', 'config', 'constants'],
  // Route files receive controllers and middleware as arguments (see src/http/README.md).
  routes: ['http', 'middlewares', 'constants', 'config'],
  middlewares: ['errors', 'lib', 'config', 'constants', 'contexts', 'schemas'],
  // The container, route definitions and mounter. Knows nothing about any feature.
  http: ['constants'],
  // Composition: each module wires one feature's repository, service, controller and routes.
  modules: [
    'http',
    'routes',
    'controllers',
    'services',
    'repository',
    'models',
    'middlewares',
    'lib',
    'utils',
    'errors',
    'config',
    'constants',
    'schemas',
  ],
  // Entry files (server.ts, app.ts) wire it in; no other layer may depend on it.
  rateLimiter: ['constants', 'config', 'lib', 'utils', 'errors', 'schemas'],
  idempotency: ['constants', 'config', 'lib', 'utils', 'errors', 'schemas'],
};

const LAYERS = Object.keys(ALLOW);

// Ban parent-relative traversal everywhere — cross-folder imports must use `#aliases`.
const noParentRelative = {
  group: ['../*', '../**'],
  message: 'Use a #alias (e.g. #services/...) instead of a ../ relative import.',
};

// Match `#alias` imports with `regex`, NOT `group`: group patterns use gitignore
// syntax where a leading `#` is a comment, so `#services/*` would silently never match.
const aliasPatterns = (layer) => {
  const denied = LAYERS.filter((l) => l !== layer && !ALLOW[layer].includes(l));
  const allowed = ALLOW[layer].length ? ALLOW[layer].join(', ') : 'nothing internal';
  return {
    regex: `^#(${denied.join('|')})(/|$)`,
    message: `Layer "${layer}/" may only import: ${allowed} (layered architecture, src/README.md).`,
  };
};

const layerConfigs = LAYERS.map((layer) => ({
  files: [`src/${layer}/**/*.ts`],
  rules: {
    'no-restricted-imports': ['error', { patterns: [noParentRelative, aliasPatterns(layer)] }],
  },
}));

export default defineConfig([
  { ignores: ['node_modules/**', 'public/**', 'coverage/**', 'dist/**'] },

  js.configs.recommended,

  // Type-aware rules: they read tsconfig.json, so they catch bugs tsc allows
  // (un-awaited promises, `any` leaking through, async functions passed where void is expected).
  tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      // `_name` marks a parameter that is unused on purpose (e.g. a stub's signature).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // node:test's describe/it return promises, but the runner awaits them itself.
  // This allow-list is typescript-eslint's documented setting for node:test; other promises stay checked.
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['describe', 'it', 'test', 'suite'] },
          ],
        },
      ],
    },
  },

  // Plain JS files (this config) are not in tsconfig.json, so type-aware rules cannot run on them.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Entry files and anything under src not in a layer: just forbid ../ traversal.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noParentRelative] }],
    },
  },

  // Per-layer dependency direction (these override the rule above for their folder).
  ...layerConfigs,

  // Must be last: turns off stylistic rules that Prettier owns.
  prettier,
]);
