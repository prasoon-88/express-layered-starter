import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { initIdempotency } from '#idempotency';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

const { createApp } = await import('./app.ts');
const { parseEnv } = await import('#constants/env/schema');

type AppOptions = Parameters<typeof createApp>[0];

const listen = async (
  options: Pick<AppOptions, 'rl' | 'readinessChecks'> & Partial<Pick<AppOptions, 'idempotency'>>,
) => {
  const { app } = createApp({
    env: parseEnv({ NODE_ENV: 'test' }),
    idempotency: { idempotent: () => passThrough },
    ...options,
  });
  const server = app.listen(0);
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

  it('answers health probes without spending the global rate limit', async () => {
    limited = [];

    for (const path of ['/health', '/health/live', '/health/ready']) {
      assert.equal((await fetch(`${baseUrl}${path}`)).status, 200, path);
    }

    assert.deepEqual(limited, []);
  });

  it('still rate limits application routes', async () => {
    limited = [];

    await fetch(`${baseUrl}/api/nothing-here`);

    assert.deepEqual(limited, ['/api/nothing-here']);
  });

  it('answers an unknown API path with the JSON error envelope and its error code', async () => {
    const response = await fetch(`${baseUrl}/api/nothing-here`);
    const body = (await response.json()) as { success: boolean; code: string };

    assert.equal(response.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, 'ROUTE_NOT_FOUND');
  });
});

describe('createApp route table', () => {
  const build = () =>
    createApp({
      env: parseEnv({ NODE_ENV: 'test' }),
      rl: { limit: () => passThrough },
      idempotency: { idempotent: () => passThrough },
    });

  it('serves only these routes without credentials', () => {
    const publicRoutes = build()
      .routes.filter((route) => route.access.strategy === 'public')
      .map((route) => `${route.method} ${route.path}`)
      .sort();

    // Adding a public route means adding it here, so it shows up in review.
    assert.deepEqual(publicRoutes, [
      'GET /',
      'GET /api/docs/openapi.json',
      'GET /health',
      'GET /health/live',
      'GET /health/ready',
      'GET /signup',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/user/register',
    ]);
  });

  it('refuses to build with AUTH_STORE=redis and no Redis client, naming what is missing', () => {
    assert.throws(
      () =>
        createApp({
          env: parseEnv({ NODE_ENV: 'test', AUTH_STORE: 'redis', REDIS_URL: 'redis://x:6379' }),
          rl: { limit: () => passThrough },
          idempotency: { idempotent: () => passThrough },
        }),
      /redis/,
    );
  });

  it('requires a signed-in caller for the profile', () => {
    const me = build().routes.find((r) => r.path === '/api/v1/user/me');
    assert.deepEqual(me?.access, { strategy: 'authenticated' });
  });

  it('gives every route an access rule and an owning module', () => {
    for (const route of build().routes) {
      assert.ok(route.access.strategy, `${route.method} ${route.path}`);
      assert.ok(route.module, `${route.method} ${route.path}`);
    }
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

describe('POST /api/v1/user/register', () => {
  let server: Server;
  let baseUrl = '';
  const limitedWith: unknown[] = [];

  before(async () => {
    const idempotency = await initIdempotency(
      parseEnv({ NODE_ENV: 'test', SERVICE_NAME: 'register-idem' }),
      pino({ level: 'silent' }),
    );
    ({ server, baseUrl } = await listen({
      rl: {
        limit: ((policy: unknown) => {
          limitedWith.push(policy);
          return passThrough;
        }) as AppOptions['rl']['limit'],
      },
      idempotency,
    }));
  });

  after(() => {
    server.close();
  });

  const post = (body: unknown) =>
    fetch(`${baseUrl}/api/v1/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const valid = { fullName: 'Ada Lovelace', email: 'Ada@Example.com', password: 'correct-horse-1' };

  it('creates the user and returns the public fields only', async () => {
    const response = await post(valid);
    const body = (await response.json()) as { success: boolean; data: Record<string, unknown> };

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.deepEqual(Object.keys(body.data).sort(), ['email', 'fullName', 'id']);
    assert.equal(body.data.email, 'ada@example.com', 'the email is normalised');
    assert.equal(JSON.stringify(body).includes(valid.password), false);
  });

  it('answers 409 EMAIL_TAKEN for an email that is already registered', async () => {
    await post({ ...valid, email: 'taken@example.com' });

    const response = await post({ ...valid, email: 'TAKEN@example.com' });
    const body = (await response.json()) as { code: string };

    assert.equal(response.status, 409);
    assert.equal(body.code, 'EMAIL_TAKEN');
  });

  it('answers 400 listing every failing field', async () => {
    const response = await post({
      fullName: ' ',
      email: 'nope@x',
      password: 'short',
      extra: 1,
    });
    const body = (await response.json()) as { code: string; details: { path: string }[] };

    assert.equal(response.status, 400);
    assert.equal(body.code, 'BAD_REQUEST');
    assert.deepEqual(body.details.map((d) => d.path).sort(), [
      'body.email',
      'body.extra',
      'body.fullName',
      'body.password',
    ]);
  });

  it('is covered by the strict auth rate limit policy', () => {
    assert.ok(limitedWith.includes('auth'));
  });

  it('replays the first response when the same Idempotency-Key is sent again', async () => {
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'replay-key-1' };
    const payload = JSON.stringify({ ...valid, email: 'replay@example.com' });
    const first = await fetch(`${baseUrl}/api/v1/user/register`, {
      method: 'POST',
      headers,
      body: payload,
    });
    const firstBody = await first.json();
    const second = await fetch(`${baseUrl}/api/v1/user/register`, {
      method: 'POST',
      headers,
      body: payload,
    });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.headers.get('Idempotent-Replayed'), 'true');
    assert.deepEqual(await second.json(), firstBody);
  });

  it('rejects the same Idempotency-Key when the body differs', async () => {
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'replay-key-2' };
    const first = await fetch(`${baseUrl}/api/v1/user/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...valid, email: 'replay-a@example.com' }),
    });
    const second = await fetch(`${baseUrl}/api/v1/user/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...valid, email: 'replay-b@example.com' }),
    });
    const body = (await second.json()) as { code: string };

    assert.equal(first.status, 201);
    assert.equal(second.status, 422);
    assert.equal(body.code, 'IDEMPOTENCY_KEY_REUSED');
  });
});

describe('auth flow over HTTP', () => {
  let server: Server;
  let baseUrl = '';
  const limitedWith: unknown[] = [];

  type Envelope = {
    success: boolean;
    code?: string;
    data: { accessToken: string; refreshToken: string; tokenType: string; expiresIn: number };
  };

  before(async () => {
    ({ server, baseUrl } = await listen({
      rl: {
        limit: ((policy: unknown) => {
          limitedWith.push(policy);
          return passThrough;
        }) as AppOptions['rl']['limit'],
      },
    }));
    const registered = await post('/api/v1/user/register', credentials);
    assert.equal(registered.status, 201);
  });

  after(() => {
    server.close();
  });

  const credentials = {
    fullName: 'Ada Lovelace',
    email: 'auth-flow@example.com',
    password: 'correct-horse-1',
  };

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const login = async () => {
    const response = await post('/api/v1/auth/login', {
      email: 'AUTH-FLOW@example.com',
      password: credentials.password,
    });
    assert.equal(response.status, 200);
    return ((await response.json()) as Envelope).data;
  };

  const me = (authorization?: string) =>
    fetch(`${baseUrl}/api/v1/user/me`, {
      headers: authorization ? { Authorization: authorization } : {},
    });

  it('logs in with the email in any case and returns a Bearer pair that is never cached', async () => {
    const response = await post('/api/v1/auth/login', {
      email: 'Auth-Flow@Example.com',
      password: credentials.password,
    });
    const body = (await response.json()) as Envelope;

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(body.data.tokenType, 'Bearer');
    assert.equal(body.data.expiresIn, 900);
    assert.equal(JSON.stringify(body).includes(credentials.password), false);
  });

  it('refuses a wrong password with 401 INVALID_CREDENTIALS', async () => {
    const response = await post('/api/v1/auth/login', {
      email: credentials.email,
      password: 'wrong-password',
    });

    assert.equal(response.status, 401);
    assert.equal(((await response.json()) as Envelope).code, 'INVALID_CREDENTIALS');
  });

  it('serves the profile to the bearer of the access token', async () => {
    const { accessToken } = await login();
    const response = await me(`Bearer ${accessToken}`);
    const body = (await response.json()) as { data: Record<string, unknown> };

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(Object.keys(body.data).sort(), ['email', 'fullName', 'id', 'role']);
    assert.equal(body.data.role, 'NORMAL');
  });

  it('answers the profile with 401 and a challenge when there is no or a bad token', async () => {
    const missing = await me();
    assert.equal(missing.status, 401);
    assert.equal(missing.headers.get('WWW-Authenticate'), 'Bearer');
    assert.equal(missing.headers.get('Cache-Control'), 'no-store');
    assert.equal(((await missing.json()) as Envelope).code, 'UNAUTHORIZED');

    const forged = await me('Bearer not.a.token');
    assert.equal(forged.status, 401);
    assert.equal(forged.headers.get('WWW-Authenticate'), 'Bearer error="invalid_token"');
    assert.equal(((await forged.json()) as Envelope).code, 'TOKEN_INVALID');
  });

  it('refuses an access token from an app with another secret', async () => {
    const other = await listen({ rl: { limit: () => passThrough } });
    try {
      const response = await me(`Bearer ${(await login()).accessToken}`);
      assert.equal(response.status, 200, 'accepted where it was issued');

      const elsewhere = await fetch(`${other.baseUrl}/api/v1/user/me`, {
        headers: { Authorization: `Bearer ${(await login()).accessToken}` },
      });
      assert.equal(elsewhere.status, 401);
    } finally {
      other.server.close();
    }
  });

  it('rotates on refresh, and a reused refresh token revokes the whole login', async () => {
    const first = await login();

    const rotated = await post('/api/v1/auth/refresh', { refreshToken: first.refreshToken });
    assert.equal(rotated.status, 200);
    const second = ((await rotated.json()) as Envelope).data;
    assert.notEqual(second.refreshToken, first.refreshToken);

    const reused = await post('/api/v1/auth/refresh', { refreshToken: first.refreshToken });
    assert.equal(reused.status, 401);
    assert.equal(((await reused.json()) as Envelope).code, 'TOKEN_INVALID');

    const afterTheft = await post('/api/v1/auth/refresh', { refreshToken: second.refreshToken });
    assert.equal(afterTheft.status, 401, 'the rotated token died with its family');
  });

  it('logs out with 204, after which the refresh token no longer works', async () => {
    const { refreshToken } = await login();

    const response = await post('/api/v1/auth/logout', { refreshToken });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');

    const refreshed = await post('/api/v1/auth/refresh', { refreshToken });
    assert.equal(refreshed.status, 401);
  });

  it('answers 400 for a body that is not a token request', async () => {
    for (const body of [{}, { refreshToken: '' }, { refreshToken: 'x', extra: 1 }]) {
      const response = await post('/api/v1/auth/refresh', body);
      assert.equal(response.status, 400, JSON.stringify(body));
    }
  });

  it('counts only failed attempts against the strict auth limit', () => {
    const credentialLimits = limitedWith.filter(
      (p) => typeof p === 'object' && p !== null && 'policy' in p,
    );
    assert.equal(credentialLimits.length, 3, 'login, refresh and logout');
    for (const p of credentialLimits)
      assert.deepEqual(p, { policy: 'auth', refundOnSuccess: true });
  });
});

describe('sessions shared through Redis (AUTH_STORE=redis)', { skip: redisSkip }, () => {
  const servers: Server[] = [];
  let redis: Redis;
  let env: ReturnType<typeof parseEnv>;

  before(async () => {
    const port = await freePort();
    await startRedisServer(port);
    env = parseEnv({
      NODE_ENV: 'test',
      SERVICE_NAME: `auth-replicas-${randomUUID()}`,
      AUTH_STORE: 'redis',
      REDIS_URL: `redis://127.0.0.1:${port}`,
      JWT_SECRET: 'replicas-share-this-secret-0123456789',
    });
    redis = await createRedisClient(env.REDIS_URL!, pino({ level: 'silent' }), {
      connectTimeoutMs: 1000,
    });
  });

  after(async () => {
    servers.forEach((s) => s.close());
    await closeRedisClient(redis);
  });

  const replica = async () => {
    const { app } = createApp({
      env,
      rl: { limit: () => passThrough },
      idempotency: { idempotent: () => passThrough },
      redis,
    });
    const server = app.listen(0);
    servers.push(server);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return `http://127.0.0.1:${address.port}/api/v1`;
  };

  const post = (url: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  // Users are still per app (main has no database), so the user lives on replica a only. The
  // reuse check runs before the user lookup, which is what lets replica b act on a's tokens.
  it('detects on one replica the reuse of a token another replica rotated', async () => {
    const [a, b] = [await replica(), await replica()];
    const user = { fullName: 'Ada', email: 'replica@example.com', password: 'correct-horse-1' };
    assert.equal((await post(`${a}/user/register`, user)).status, 201);

    type Pair = { data: { refreshToken: string } };
    const login = await post(`${a}/auth/login`, { email: user.email, password: user.password });
    const first = ((await login.json()) as Pair).data;
    const rotated = await post(`${a}/auth/refresh`, { refreshToken: first.refreshToken });
    assert.equal(rotated.status, 200);
    const second = ((await rotated.json()) as Pair).data;

    const reusedOnB = await post(`${b}/auth/refresh`, { refreshToken: first.refreshToken });
    assert.equal(reusedOnB.status, 401);

    // Only true when b revoked the family in the store a reads from.
    const afterOnA = await post(`${a}/auth/refresh`, { refreshToken: second.refreshToken });
    assert.equal(afterOnA.status, 401, 'b revoked the family for every replica');
  });

  it('logs out on one replica a login made on another', async () => {
    const [a, b] = [await replica(), await replica()];
    const user = { fullName: 'Ada', email: 'logout@example.com', password: 'correct-horse-1' };
    await post(`${a}/user/register`, user);
    const login = await post(`${a}/auth/login`, { email: user.email, password: user.password });
    const { refreshToken } = ((await login.json()) as { data: { refreshToken: string } }).data;

    assert.equal((await post(`${b}/auth/logout`, { refreshToken })).status, 204);
    assert.equal((await post(`${a}/auth/refresh`, { refreshToken })).status, 401);
  });
});

describe('GET /api/docs/openapi.json', () => {
  let server: Server;
  let baseUrl = '';
  let routes: ReturnType<typeof createApp>['routes'];

  type Doc = {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<
      string,
      Record<string, { security: unknown[]; requestBody?: unknown; responses: object }>
    >;
  };

  before(async () => {
    ({ server, baseUrl } = await listen({ rl: { limit: () => passThrough } }));
    routes = createApp({
      env: parseEnv({ NODE_ENV: 'test' }),
      rl: { limit: () => passThrough },
      idempotency: { idempotent: () => passThrough },
    }).routes;
  });

  after(() => {
    server.close();
  });

  const fetchDoc = async () => {
    const response = await fetch(`${baseUrl}/api/docs/openapi.json`);
    assert.equal(response.status, 200);
    return (await response.json()) as Doc;
  };

  it('serves the bare document, not wrapped in the success envelope', async () => {
    const doc = await fetchDoc();

    assert.equal(doc.openapi, '3.1.0');
    assert.equal(doc.info.title, 'app');
    assert.equal('success' in doc, false);
  });

  it('documents every /api route and nothing outside /api', async () => {
    const doc = await fetchDoc();
    const documented = Object.entries(doc.paths)
      .flatMap(([path, ops]) =>
        Object.keys(ops).map((m) => `${m.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`),
      )
      .sort();
    const mounted = routes
      .filter((r) => r.path.startsWith('/api/'))
      .map((r) => `${r.method} ${r.path}`)
      .sort();

    assert.deepEqual(documented, mounted);
    assert.ok(documented.length >= 6);
  });

  it('requires the bearer token exactly where the route does', async () => {
    const { paths } = await fetchDoc();

    assert.deepEqual(paths['/api/v1/user/me']?.get?.security, [{ bearerAuth: [] }]);
    assert.deepEqual(paths['/api/v1/auth/login']?.post?.security, []);
  });

  it('describes request bodies and the documented status of each route', async () => {
    const { paths } = await fetchDoc();

    assert.ok(paths['/api/v1/auth/login']?.post?.requestBody);
    assert.ok('201' in (paths['/api/v1/user/register']?.post?.responses ?? {}));
    assert.ok('204' in (paths['/api/v1/auth/logout']?.post?.responses ?? {}));
  });

  it('serves the same document on every request', async () => {
    assert.deepEqual(await fetchDoc(), await fetchDoc());
  });
});

describe('createApp dependency isolation', () => {
  const servers: Server[] = [];

  after(() => {
    servers.forEach((s) => s.close());
  });

  it('gives each app its own services, so two apps never share users', async () => {
    const register = async () => {
      const started = await listen({ rl: { limit: () => passThrough } });
      servers.push(started.server);
      return fetch(`${started.baseUrl}/api/v1/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Grace Hopper',
          email: 'grace@example.com',
          password: 'correct-horse-2',
        }),
      });
    };

    assert.equal((await register()).status, 201);
    assert.equal((await register()).status, 201);
  });
});
