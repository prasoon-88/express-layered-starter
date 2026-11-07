import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The naming rules of src/README.md that a linter cannot see: a file in a layer folder carries
// that layer's suffix, so its role shows in every import and every stack trace. Feature folders
// (lib/<system>/, http/, rateLimiter/, idempotency/, contexts/) are their own role and have none.

const SRC = import.meta.dirname;

// Per layer folder, the names a source file may have. A test is checked as the file it tests.
const RULES: Record<string, RegExp> = {
  cache: /\.cache\.ts$/,
  config: /\.config\.ts$/,
  constants: /\.constant\.ts$|^env\/(index|schema)\.ts$/,
  controllers: /\.controller\.ts$/,
  jobs: /\.job\.ts$|^queues\.ts$/,
  errors: /\.error\.ts$|^index\.ts$|^converter\/(\w+\.converter|index)\.ts$/,
  middlewares: /\.middleware\.ts$/,
  models: /\.model\.ts$/,
  modules: /\.module\.ts$|^index\.ts$/,
  repository: /\.repository\.ts$/,
  routes: /\.routes\.ts$|(^|\/)index\.ts$/,
  schemas: /\.schema\.ts$/,
  services: /\.service\.ts$/,
  utils: /\.util\.ts$/,
  workers: /\.worker\.ts$|^index\.ts$/,
};

const sourceFiles = (layer: string) =>
  readdirSync(join(SRC, layer), { recursive: true, encoding: 'utf8' })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => file.replace(/\.test\.ts$/, '.ts'));

// A value defineCacheSpec made: frozen, with a name, a schema version and tag functions.
const isCacheSpec = (value: unknown): value is { name: string } =>
  typeof value === 'object' &&
  value !== null &&
  Object.isFrozen(value) &&
  'name' in value &&
  'version' in value &&
  'tags' in value;

describe('file naming', () => {
  for (const [layer, rule] of Object.entries(RULES)) {
    it(`gives every file in ${layer}/ its layer's suffix`, () => {
      const wrong = sourceFiles(layer).filter((file) => !rule.test(file));
      assert.deepEqual(wrong, [], `rename these in ${layer}/ to match ${rule}`);
    });
  }

  it('gives every cache spec its own name, since the name keys its entries and tags', async () => {
    const names: string[] = [];
    // A Set: a spec file and its test both list as the spec file.
    for (const file of new Set(sourceFiles('cache'))) {
      const module = (await import(pathToFileURL(join(SRC, 'cache', file)).href)) as object;
      for (const value of Object.values(module)) if (isCacheSpec(value)) names.push(value.name);
    }
    assert.ok(names.length > 0, 'found no cache spec, so this test checks nothing');
    const repeated = names.filter((name, i) => names.indexOf(name) !== i);
    assert.deepEqual(repeated, [], 'rename one of each pair: they would share keys and tags');
  });

  it('names only folders that exist, so a misspelt rule cannot pass by checking nothing', () => {
    const folders = readdirSync(SRC, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const layer of Object.keys(RULES)) assert.ok(folders.includes(layer), layer);
  });
});
