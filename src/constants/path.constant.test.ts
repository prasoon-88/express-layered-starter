import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PATHS } from './path.constant.ts';

describe('PATHS', () => {
  it('finds the views next to the code, not through the project root', () => {
    // Dev: src/views. Built: dist/views, copied by the build, so dist/ never needs src/.
    assert.equal(relative(PATHS.ROOT, PATHS.VIEWS.path), join('src', 'views'));
    assert.ok(existsSync(join(PATHS.VIEWS.path, 'home.ejs')));
  });

  it('keeps static assets at the project root', () => {
    assert.ok(existsSync(PATHS.PUBLIC.path));
  });
});
