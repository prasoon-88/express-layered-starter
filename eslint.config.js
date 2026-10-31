import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

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
  repository: ['models', 'utils', 'lib', 'errors', 'config', 'constants'],
  services: ['repository', 'models', 'utils', 'lib', 'errors', 'config', 'constants'],
  controllers: ['services', 'utils', 'errors', 'lib', 'config', 'constants'],
  routes: ['controllers', 'middlewares', 'constants', 'config'],
  middlewares: ['errors', 'lib', 'config', 'constants', 'contexts'],
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
  files: [`src/${layer}/**/*.js`],
  rules: {
    'no-restricted-imports': ['error', { patterns: [noParentRelative, aliasPatterns(layer)] }],
  },
}));

export default [
  { ignores: ['node_modules/**', 'public/**', 'coverage/**', 'dist/**'] },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'error',
    },
  },

  // Entry files and anything under src not in a layer: just forbid ../ traversal.
  {
    files: ['src/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noParentRelative] }],
    },
  },

  // Per-layer dependency direction (these override the rule above for their folder).
  ...layerConfigs,

  // Must be last: turns off stylistic rules that Prettier owns.
  prettier,
];
