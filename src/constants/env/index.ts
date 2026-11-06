import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PATHS from '#constants/path.constant';
import { parseEnv } from './schema.ts';

// pnpm sets npm_package_* only for its scripts, so `node dist/server.js` (a container, a process
// manager) would lose the service name and version. package.json is always deployed: Node
// resolves the #imports map from it.
const pkg = JSON.parse(readFileSync(resolve(PATHS.ROOT, 'package.json'), 'utf8')) as Record<
  string,
  unknown
>;
const fromPackage = (value: unknown) => (typeof value === 'string' ? value : undefined);

const ENV_CONSTANTS = Object.freeze(
  parseEnv({
    npm_package_name: fromPackage(pkg.name),
    npm_package_version: fromPackage(pkg.version),
    ...process.env,
  }),
);

export default ENV_CONSTANTS;
