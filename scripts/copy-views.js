// tsc compiles .ts only, so the templates must be copied into dist/ for the built app to render.
import { cpSync } from 'node:fs';
import { extname } from 'node:path';

cpSync('src/views', 'dist/views', {
  recursive: true,
  // Directories pass through; of the files, only templates ship (the folder's README stays behind).
  filter: (source) => extname(source) === '' || extname(source) === '.ejs',
});
