import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import pino from 'pino';
import { parseEnv } from '#constants/env/schema';
import HTTP_HEADERS from '#constants/http/httpHeaders.constant';
import { ServiceUnavailableError } from '#errors';
import { closeRedisClient, createRedisClient } from '#lib/redis/index';
import { freePort, redisSkip as skip, startRedisServer } from '#testing/redisServer';
import { initIdempotency } from './index.ts';

const log = pino({ level: 'silent' });

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  payload: Buffer | undefined;
  writableFinished = false;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  set(field: string | Record<string, string>, value?: string) {
    if (typeof field === 'string') this.headers[field] = value ?? '';
    else Object.assign(this.headers, field);
    return this;
  }

  getHeader(name: string) {
    return this.headers[name];
  }

  send(chunk?: unknown) {
    return this.end(chunk);
  }

  end(chunk?: unknown) {
    if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) this.payload = Buffer.from(chunk);
    this.writableFinished = true;
    this.emit('finish');
    return this;
  }
}

const buildEnv = (port: number, overrides: Record<string, string> = {}) =>
  parseEnv({
    NODE_ENV: 'test',
    SERVICE_NAME: `idem-test-${randomUUID()}`,
    IDEMPOTENCY_STORE: 'redis',
    REDIS_URL: `redis://127.0.0.1:${port}`,
    REDIS_CONNECT_TIMEOUT_MS: '300',
    ...overrides,
  });

const hit = async (
  idem: Awaited<ReturnType<typeof initIdempotency>>,
  key: string,
  body: unknown,
) => {
  const res = new FakeResponse();
  let continued = false;
  const next: NextFunction = () => {
    continued = true;
    res.status(201).set('Content-Type', 'application/json').send(JSON.stringify(body));
  };
  await idem.idempotent('default')(
    {
      method: 'POST',
      baseUrl: '/api',
      path: '/pay',
      body,
      ip: '203.0.113.20',
      get: (name: string) => (name.toLowerCase() === 'idempotency-key' ? key : undefined),
    } as unknown as Request,
    res as unknown as Response,
    next,
  );
  await new Promise((resolve) => setImmediate(resolve));
  return {
    continued,
    status: res.statusCode,
    replayed: res.headers[HTTP_HEADERS.IDEMPOTENT_REPLAYED],
  };
};

describe('initIdempotency with the Redis store', { skip }, () => {
  it('replays one response across instances through Redis', async () => {
    const port = await freePort();
    await startRedisServer(port);
    const env = buildEnv(port);
    const url = env.REDIS_URL;
    assert.ok(url);
    const redis = await createRedisClient(url, log, {
      connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
    });
    const first = await initIdempotency(env, log, redis);
    const second = await initIdempotency(env, log, redis);
    try {
      const original = await hit(first, 'replay-key-1', { amount: 10 });
      const replay = await hit(second, 'replay-key-1', { amount: 10 });
      assert.equal(original.continued, true);
      assert.equal(replay.continued, false);
      assert.equal(replay.status, 201);
      assert.equal(replay.replayed, 'true');
    } finally {
      await closeRedisClient(redis);
    }
  });

  it('answers 503 when the store is down and the mode is deny', async () => {
    const port = await freePort();
    const env = buildEnv(port);
    const url = env.REDIS_URL;
    assert.ok(url);
    const redis = await createRedisClient(url, log, {
      connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
    });
    const idem = await initIdempotency(env, log, redis);
    try {
      assert.equal(idem.readinessChecks[0]?.critical, true);
      await assert.rejects(hit(idem, 'replay-key-2', { amount: 10 }), ServiceUnavailableError);
    } finally {
      await closeRedisClient(redis);
    }
  });
});
