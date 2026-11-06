import { resolve } from 'path';

// Two levels up from src/constants (dev) or dist/constants (prod): the project root either way.
const ROOT = resolve(import.meta.dirname, '../..');

export const PATHS = Object.freeze({
  ROOT,
  // Static assets are not compiled, so they stay at the project root in dev and in prod.
  PUBLIC: Object.freeze({ name: 'public', path: resolve(ROOT, 'public') }),
  // Templates sit next to the code that renders them: src/views in dev, dist/views in prod
  // (`pnpm build` copies them there), so dist/ runs without src/ present.
  VIEWS: Object.freeze({ name: 'views', path: resolve(import.meta.dirname, '../views') }),
});
