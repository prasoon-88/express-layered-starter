import { resolve } from 'path';

// Two levels up from src/constants (dev) or dist/constants (prod): the project root either way.
const ROOT = resolve(import.meta.dirname, '../..');

const resolveFolder = (folderName: string, ...parents: string[]) =>
  Object.freeze({
    name: folderName,
    path: resolve(ROOT, ...parents, folderName),
  });

const PATHS = Object.freeze({
  ROOT,
  SRC: resolveFolder('src'),
  UPLOAD: resolveFolder('upload'),
  PUBLIC: resolveFolder('public'),
  VIEWS: resolveFolder('views', 'src'),
});

export default PATHS;
