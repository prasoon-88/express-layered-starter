import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import pino from 'pino';
import { parseEnv } from '#constants/env/schema';
import { ServiceUnavailableError, TooManyRequestsError } from '#errors';
import { initRateLimit } from './index.ts';

// These tests run against a real redis-server, so they prove the limiter really shares state
// through Redis. CI installs it; locally they are skipped, with the reason, when it is missing.
const REDIS_SERVER_BIN = process.env.REDIS_SERVER_BIN ?? 'redis-server';
const hasRedisServer = spawnSync(REDIS_SERVER_BIN, ['--version']).status === 0;
const skip =
  !hasRedisServer && !process.env.CI
    ? `${REDIS_SERVER_BIN} not found (set REDIS_SERVER_BIN to run these tests)`
    : false;

const log = pino({ level: 'silent' });

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });

const servers: ChildProcess[] = [];

const startRedisServer = async (port: number) => {
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
};

after(() => {
  for (const child of servers) child.kill();
});

const buildEnv = (port: number, overrides: Record<string, string> = {}) =>
  parseEnv({
    NODE_ENV: 'test',
    SERVICE_NAME: `rl-test-${randomUUID()}`,
    RATE_LIMIT_STORE: 'redis',
    REDIS_URL: `redis://127.0.0.1:${port}`,
    REDIS_CONNECT_TIMEOUT_MS: '300',
    RATE_LIMIT_MAX: '2',
    RATE_LIMIT_POLICY_REFRESH_S: '0',
    ...overrides,
  });

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};

  set(field: string | Record<string, string>, value?: string) {
    Object.assign(this.headers, typeof field === 'string' ? { [field]: value } : field);
    return this;
  }
}

const hit = async (limiter: Awaited<ReturnType<typeof initRateLimit>>, ip: string) => {
  const res = new FakeResponse();
  let passed = false;
  const next: NextFunction = () => {
    passed = true;
  };
  await limiter.limit('global')(
    { method: 'GET', path: '/x', ip } as unknown as Request,
    res as unknown as Response,
    next,
  );
  return { passed, headers: res.headers };
};

const waitFor = async (probe: () => Promise<unknown>, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await probe();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
};

describe('initRateLimit with the Redis store', { skip }, () => {
  it('shares one limit across instances through Redis', async () => {
    const port = await freePort();
    await startRedisServer(port);
    const env = buildEnv(port);

    const first = await initRateLimit(env, log);
    const second = await initRateLimit(env, log);
    try {
      assert.equal((await hit(first, '203.0.113.10')).passed, true);
      assert.equal((await hit(second, '203.0.113.10')).passed, true);
      await assert.rejects(hit(first, '203.0.113.10'), TooManyRequestsError);
      await assert.rejects(hit(second, '203.0.113.10'), TooManyRequestsError);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('boots without waiting forever for an unreachable Redis, then recovers when it comes up', async () => {
    const port = await freePort();
    const env = buildEnv(port);

    const startedAt = Date.now();
    const limiter = await initRateLimit(env, log);
    try {
      assert.ok(Date.now() - startedAt < 3_000, 'boot waits only REDIS_CONNECT_TIMEOUT_MS');

      const [check] = limiter.readinessChecks;
      assert.ok(check);
      assert.equal(check.critical, false);
      await assert.rejects(check.run(), 'store is reported down while Redis is unreachable');

      const fallback = await hit(limiter, '203.0.113.11');
      assert.equal(fallback.passed, true, 'local mode keeps limiting from memory');

      await startRedisServer(port);
      await waitFor(() => check.run(), 10_000);
    } finally {
      await limiter.close();
    }
  });

  it('answers 503, not 429, when the store is down and the mode is deny', async () => {
    const port = await freePort();
    const limiter = await initRateLimit(buildEnv(port, { RATE_LIMIT_ON_STORE_ERROR: 'deny' }), log);
    try {
      await assert.rejects(hit(limiter, '203.0.113.12'), ServiceUnavailableError);
      assert.equal(limiter.readinessChecks[0]?.critical, true);
    } finally {
      await limiter.close();
    }
  });

  it('lets the request through without rate limit headers when the store is down and the mode is allow', async () => {
    const port = await freePort();
    const limiter = await initRateLimit(
      buildEnv(port, { RATE_LIMIT_ON_STORE_ERROR: 'allow' }),
      log,
    );
    try {
      const result = await hit(limiter, '203.0.113.13');
      assert.equal(result.passed, true);
      assert.deepEqual(result.headers, {}, 'no decision was made, so none is reported');
    } finally {
      await limiter.close();
    }
  });
});
