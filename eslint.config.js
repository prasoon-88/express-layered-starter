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
  // Cache specs: pure descriptions (defineCacheSpec), so any data layer may import them.
  cache: ['models', 'lib', 'constants'],
  repository: ['cache', 'models', 'utils', 'lib', 'errors', 'config', 'constants'],
  services: [
    'cache',
    'jobs',
    'repository',
    'models',
    'utils',
    'lib',
    'errors',
    'config',
    'constants',
  ],
  controllers: ['services', 'utils', 'errors', 'lib', 'config', 'constants', 'schemas'],
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
    'cache',
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
  // Job definitions: pure descriptions (defineJob), so a service can import one to enqueue it.
  jobs: ['models', 'lib', 'constants'],
  // Job handlers, built with their dependencies the way a module builds a service.
  workers: [
    'jobs',
    'services',
    'repository',
    'cache',
    'models',
    'lib',
    'utils',
    'errors',
    'config',
    'constants',
  ],
  rateLimiter: ['constants', 'config', 'lib', 'utils', 'errors', 'schemas'],
  idempotency: ['constants', 'config', 'lib', 'utils', 'errors', 'schemas'],
};

const LAYERS = Object.keys(ALLOW);

// Utils that import nothing internal, so any layer may use them (src/README.md, "leaf utils").
const LEAF_UTILS = ['concatenateStrings', 'sleep'];
const LEAF_UTIL_IMPORT = `#utils/(${LEAF_UTILS.join('|')})\\.util$`;

// Ban parent-relative traversal everywhere — cross-folder imports must use `#aliases`.
const noParentRelative = {
  group: ['../*', '../**'],
  message: 'Use a #alias (e.g. #services/...) instead of a ../ relative import.',
};

// `./x.ts` is for a file in the same folder; reaching into a subfolder is a cross-folder import.
const noSubfolderRelative = {
  regex: '^\\./[^/]+/',
  message: 'Use a #alias (e.g. #constants/http/...) instead of a relative import into a subfolder.',
};

// Match `#alias` imports with `regex`, NOT `group`: group patterns use gitignore
// syntax where a leading `#` is a comment, so `#services/*` would silently never match.
const aliasPatterns = (layer) => {
  const denied = LAYERS.filter((l) => l !== layer && !ALLOW[layer].includes(l));
  const allowed = ALLOW[layer].length ? ALLOW[layer].join(', ') : 'nothing internal';
  return {
    regex: `^(?!${LEAF_UTIL_IMPORT})#(${denied.join('|')})(/|$)`,
    message: `Layer "${layer}/" may only import: ${allowed}, and the leaf utils (layered architecture, src/README.md).`,
  };
};

const leafUtilConfig = {
  files: LEAF_UTILS.map((name) => `src/utils/${name}.util.ts`),
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            regex: '^(#|\\.)',
            message:
              'A leaf util imports nothing internal, so every layer may use it (src/README.md).',
          },
        ],
      },
    ],
  },
};

// Both static `import` and `await import()`, for each restricted source.
const restrictImports = (sourceRegex, message) =>
  ['ImportDeclaration', 'ImportExpression'].map((node) => ({
    selector: `${node}[source.value=/${sourceRegex}/]`,
    message,
  }));

const noTestingImports = restrictImports(
  '^#testing\\u002F',
  '#testing/* is for *.test.ts files only; it is not part of the build.',
);

const noTelemetrySdkImports = restrictImports(
  '^(@opentelemetry\\u002F(?!api$)|import-in-the-middle)',
  'Only src/lib/telemetry and src/instrumentation.ts load the OpenTelemetry SDK. Use @opentelemetry/api.',
);

// Named exports only: the imported name then matches the declared one, so renames and grep both work.
const noDefaultExport = [
  { selector: 'ExportDefaultDeclaration', message: 'Use a named export (src/README.md).' },
  {
    selector: 'ExportSpecifier[exported.name="default"]',
    message: 'Use a named export (src/README.md).',
  },
];

// `type` for shapes. An interface is only for declaration merging: augmenting a module or a global.
const noInterface = [
  {
    selector: 'TSInterfaceDeclaration:not(TSModuleDeclaration TSInterfaceDeclaration)',
    message: 'Use a `type` alias; `interface` is only for declaration merging (src/README.md).',
  },
];

const conventions = [...noDefaultExport, ...noInterface];

const layerConfigs = LAYERS.map((layer) => ({
  files: [`src/${layer}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: [noParentRelative, noSubfolderRelative, aliasPatterns(layer)] },
    ],
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
    files: ['**/*.test.ts', 'src/testing/**/*.ts'],
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
      'no-restricted-imports': ['error', { patterns: [noParentRelative, noSubfolderRelative] }],
    },
  },

  // Per-layer dependency direction (these override the rule above for their folder).
  ...layerConfigs,
  leafUtilConfig,

  // Test helpers are not built into dist/, so production code importing one would crash at boot.
  // The OpenTelemetry SDK is started by the preload only; app code uses @opentelemetry/api,
  // which does nothing until the SDK runs. A separate rule from no-restricted-imports, so the
  // per-layer configs above don't replace it. A later block replaces this rule rather than
  // adding to it, so each block lists `conventions` again.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...conventions],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/testing/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...conventions,
        ...noTestingImports,
        ...noTelemetrySdkImports,
      ],
    },
  },
  {
    files: ['src/lib/telemetry/**/*.ts', 'src/instrumentation.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...conventions, ...noTestingImports],
    },
  },

  // Must be last: turns off stylistic rules that Prettier owns.
  prettier,
]);
