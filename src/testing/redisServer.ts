import { after } from 'node:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

// Test-only. Starts throwaway redis-server processes so integration tests prove behavior against
// a real Redis. CI installs the binary; locally the suite is skipped, with the reason, without it.
const REDIS_SERVER_BIN = process.env.REDIS_SERVER_BIN ?? 'redis-server';
const hasRedisServer = spawnSync(REDIS_SERVER_BIN, ['--version']).status === 0;

/** Pass as `describe(name, { skip: redisSkip }, …)`. Never skips in CI, where a missing binary is a failure. */
export const redisSkip =
  !hasRedisServer && !process.env.CI
    ? `${REDIS_SERVER_BIN} not found (set REDIS_SERVER_BIN to run these tests)`
    : false;

export const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });

const servers: ChildProcess[] = [];

after(() => {
  for (const child of servers) child.kill();
});

/** Resolves once the server accepts connections. Every server is killed when the test file ends. */
export const startRedisServer = async (port: number) => {
  const child = spawn(REDIS_SERVER_BIN, [
    '--port',
    String(port),
    '--save',
    '',
    '--appendonly',
    'no',
  ]);
  servers.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('Ready to accept connections')) resolve();
    });
  });
  return child;
};
