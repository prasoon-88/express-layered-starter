import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { RequestHandler } from 'express';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

const { createApp } = await import('./app.ts');
const { parseEnv } = await import('#constants/env/schema');

type AppOptions = Parameters<typeof createApp>[0];

const listen = async (options: Pick<AppOptions, 'rl' | 'readinessChecks'>) => {
  const server = createApp({ env: parseEnv({ NODE_ENV: 'test' }), ...options }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

const passThrough: RequestHandler = (_req, _res, next) => {
  next();
};

describe('createApp middleware order', () => {
  let server: Server;
  let baseUrl = '';
  let limited: string[] = [];

  before(async () => {
    const countLimited: RequestHandler = (req, _res, next) => {
      limited.push(req.path);
      next();
    };

    ({ server, baseUrl } = await listen({ rl: { limit: () => countLimited } }));
  });

  after(() => {
    server.close();
  });

  it('serves static files without spending the global rate limit', async () => {
    limited = [];

    const response = await fetch(`${baseUrl}/images/default_avatar.png`);

    assert.equal(response.status, 200);
    assert.deepEqual(limited, []);
  });

  it('still rate limits application routes', async () => {
    limited = [];

    const response = await fetch(`${baseUrl}/health/live`);

    assert.equal(response.status, 200);
    assert.deepEqual(limited, ['/health/live']);
  });

  it('answers an unknown API path with the JSON error envelope and its error code', async () => {
    const response = await fetch(`${baseUrl}/api/nothing-here`);
    const body = (await response.json()) as { success: boolean; code: string };

    assert.equal(response.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, 'ROUTE_NOT_FOUND');
  });
});

describe('createApp health endpoints', () => {
  const rl = { limit: () => passThrough };
  const fail = () => Promise.reject(new Error('The client is closed'));
  const json = async (response: Response) =>
    (await response.json()) as Record<string, unknown> & { data?: unknown; details?: unknown };

  const servers: Server[] = [];
  const start = async (readinessChecks: AppOptions['readinessChecks']) => {
    const started = await listen({ rl, readinessChecks });
    servers.push(started.server);
    return started.baseUrl;
  };

  after(() => {
    servers.forEach((s) => s.close());
  });

  it('is ready when every dependency answers', async () => {
    const baseUrl = await start([{ name: 'redis', critical: true, run: () => Promise.resolve() }]);

    const response = await fetch(`${baseUrl}/health/ready`);

    assert.equal(response.status, 200);
    assert.deepEqual((await json(response)).data, {
      status: 'ok',
      checks: [{ name: 'redis', status: 'up' }],
    });
  });

  it('answers 503 on /health/ready and /health when a critical dependency is dead', async () => {
    const baseUrl = await start([{ name: 'redis', critical: true, run: fail }]);

    for (const path of ['/health/ready', '/health']) {
      const response = await fetch(`${baseUrl}${path}`);
      const body = await json(response);

      assert.equal(response.status, 503, path);
      assert.equal(body.code, 'SERVICE_UNAVAILABLE', path);
      assert.deepEqual(body.details, [{ name: 'redis', status: 'down' }], path);
      assert.equal(JSON.stringify(body).includes('client is closed'), false, path);
    }
  });

  it('keeps serving and reports degraded when only a non-critical dependency is dead', async () => {
    const baseUrl = await start([{ name: 'redis', critical: false, run: fail }]);

    const response = await fetch(`${baseUrl}/health/ready`);

    assert.equal(response.status, 200);
    assert.deepEqual((await json(response)).data, {
      status: 'degraded',
      checks: [{ name: 'redis', status: 'down' }],
    });
  });

  it('keeps /health/live at 200 whatever the dependencies do', async () => {
    const baseUrl = await start([{ name: 'redis', critical: true, run: fail }]);

    const response = await fetch(`${baseUrl}/health/live`);

    assert.equal(response.status, 200);
  });
});
