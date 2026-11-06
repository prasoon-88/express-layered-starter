import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from './schema.ts';

// Every case starts from the one required variable, so each test only states what it changes.
const parse = (env: Record<string, string> = {}) => parseEnv({ NODE_ENV: 'test', ...env });

describe('parseEnv', () => {
  describe('defaults', () => {
    it('applies a default to every optional variable', () => {
      const { JWT_SECRET, ...env } = parse();

      assert.ok(JWT_SECRET.length >= 32, 'a random secret outside production');
      assert.deepEqual(env, {
        NODE_ENV: 'test',
        PORT: 8000,
        SERVICE_NAME: 'app',
        LOG_LEVEL: 'info',
        LOG_PRETTY: false,
        LOG_IGNORE_PATHS: ['/health', '/favicon.ico'],
        TRUST_PROXY: false,
        LOG_SLOW_MS: 1000,
        SHUTDOWN_TIMEOUT_MS: 8000,
        SHUTDOWN_DELAY_MS: 5000,
        CORS_ENABLED: false,
        CORS_ORIGINS: [],
        CORS_CREDENTIALS: false,
        CORS_METHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        CORS_ALLOWED_HEADERS: ['Content-Type', 'Authorization', 'Idempotency-Key'],
        CORS_EXPOSED_HEADERS: ['X-Request-Id', 'Idempotent-Replayed'],
        CORS_MAX_AGE_S: 600,
        REDIS_CONNECT_TIMEOUT_MS: 5000,
        RATE_LIMIT_ENABLED: true,
        RATE_LIMIT_STORE: 'memory',
        RATE_LIMIT_ON_STORE_ERROR: 'local',
        RATE_LIMIT_WINDOW_S: 60,
        RATE_LIMIT_MAX: 100,
        RATE_LIMIT_AUTH_WINDOW_S: 900,
        RATE_LIMIT_AUTH_MAX: 10,
        RATE_LIMIT_AUTH_BLOCK_S: 900,
        RATE_LIMIT_IPV6_SUBNET: 56,
        RATE_LIMIT_POLICY_REFRESH_S: 30,
        RATE_LIMIT_SKIP_PATHS: [],
        IDEMPOTENCY_ENABLED: true,
        IDEMPOTENCY_STORE: 'memory',
        IDEMPOTENCY_ON_STORE_ERROR: 'deny',
        IDEMPOTENCY_TTL_S: 86_400,
        IDEMPOTENCY_LOCK_TTL_S: 60,
        IDEMPOTENCY_MAX_BODY_BYTES: 256 * 1024,
        JWT_ACCESS_TTL_S: 900,
        JWT_REFRESH_TTL_S: 2_592_000,
        LB_IDLE_TIMEOUT_MS: 60_000,
        HTTP_KEEP_ALIVE_TIMEOUT_MS: 65_000,
        HTTP_HEADERS_TIMEOUT_MS: 67_000,
        HTTP_REQUEST_TIMEOUT_MS: 120_000,
        REQUEST_HANDLER_TIMEOUT_MS: 30_000,
        EXPOSE_ERROR_STACK: false,
      });
    });

    it('treats empty values (`KEY=`) as unset', () => {
      const env = parse({ PORT: '', SERVICE_NAME: '', LOG_PRETTY: '', TRUST_PROXY: '' });
      assert.equal(env.PORT, 8000);
      assert.equal(env.SERVICE_NAME, 'app');
      assert.equal(env.LOG_PRETTY, false);
      assert.equal(env.TRUST_PROXY, false);
    });

    it('returns only known keys, never the rest of process.env', () => {
      const env = parse({ PATH: '/usr/bin', npm_package_name: 'pkg' });
      assert.equal('PATH' in env, false);
      assert.equal('npm_package_name' in env, false);
    });
  });

  describe('NODE_ENV', () => {
    it('is required', () => {
      assert.throws(() => parseEnv({}), /NODE_ENV/);
    });

    it('rejects unknown environments', () => {
      assert.throws(() => parse({ NODE_ENV: 'staging' }), /NODE_ENV/);
    });

    it('exposes error stacks only in development', () => {
      assert.equal(parse({ NODE_ENV: 'development' }).EXPOSE_ERROR_STACK, true);
      assert.equal(parse({ NODE_ENV: 'test' }).EXPOSE_ERROR_STACK, false);
      assert.equal(
        parse({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) }).EXPOSE_ERROR_STACK,
        false,
      );
    });
  });

  describe('SERVICE_NAME', () => {
    it('prefers SERVICE_NAME, then the package name, then "app"', () => {
      assert.equal(parse({ SERVICE_NAME: 'api', npm_package_name: 'pkg' }).SERVICE_NAME, 'api');
      assert.equal(parse({ npm_package_name: 'pkg' }).SERVICE_NAME, 'pkg');
      assert.equal(parse().SERVICE_NAME, 'app');
    });
  });

  describe('PORT', () => {
    it('parses a whole number and trims whitespace', () => {
      assert.equal(parse({ PORT: ' 3000 ' }).PORT, 3000);
    });

    for (const PORT of ['0', '65536', 'abc', '80.5', '-1']) {
      it(`rejects ${JSON.stringify(PORT)}`, () => {
        assert.throws(() => parse({ PORT }), /PORT/);
      });
    }
  });

  describe('LOG_PRETTY', () => {
    it('accepts the usual boolean spellings', () => {
      assert.equal(parse({ LOG_PRETTY: 'yes' }).LOG_PRETTY, true);
      assert.equal(parse({ LOG_PRETTY: '0' }).LOG_PRETTY, false);
    });

    it('rejects anything else', () => {
      assert.throws(() => parse({ LOG_PRETTY: 'maybe' }), /LOG_PRETTY/);
    });
  });

  describe('LOG_IGNORE_PATHS', () => {
    it('splits a comma list, trimming and dropping empty items', () => {
      assert.deepEqual(parse({ LOG_IGNORE_PATHS: '/a, /b,' }).LOG_IGNORE_PATHS, ['/a', '/b']);
    });

    it('requires every path to start with "/"', () => {
      assert.throws(() => parse({ LOG_IGNORE_PATHS: '/a,health' }), /LOG_IGNORE_PATHS/);
    });
  });

  describe('TRUST_PROXY', () => {
    const cases: [string, boolean | number | string][] = [
      ['true', true],
      ['false', false],
      ['2', 2],
      ['loopback', 'loopback'],
      ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
      ['::1/128', '::1/128'],
    ];

    for (const [input, expected] of cases) {
      it(`parses ${JSON.stringify(input)}`, () => {
        assert.equal(parse({ TRUST_PROXY: input }).TRUST_PROXY, expected);
      });
    }

    for (const TRUST_PROXY of ['10.0.0.0/33', 'not-an-ip', 'loopback,', '1.2.3.4/8/8']) {
      it(`rejects ${JSON.stringify(TRUST_PROXY)}`, () => {
        assert.throws(() => parse({ TRUST_PROXY }), /TRUST_PROXY/);
      });
    }
  });

  describe('handler timeout', () => {
    it('must finish before the load balancer gives up on the connection', () => {
      // LB_IDLE_TIMEOUT_MS defaults to 60_000: past that the client sees the LB's 504, not our 408.
      assert.throws(
        () => parse({ REQUEST_HANDLER_TIMEOUT_MS: '60000' }),
        /REQUEST_HANDLER_TIMEOUT_MS/,
      );
      assert.equal(
        parse({ REQUEST_HANDLER_TIMEOUT_MS: '59999' }).REQUEST_HANDLER_TIMEOUT_MS,
        59999,
      );
    });

    it('is not compared with the load balancer when that timeout is unset (0)', () => {
      const env = parse({
        LB_IDLE_TIMEOUT_MS: '0',
        REQUEST_HANDLER_TIMEOUT_MS: '300000',
        HTTP_REQUEST_TIMEOUT_MS: '600000',
        IDEMPOTENCY_LOCK_TTL_S: '301',
      });
      assert.equal(env.REQUEST_HANDLER_TIMEOUT_MS, 300000);
    });

    it('accepts 0 as disabled', () => {
      assert.equal(parse({ REQUEST_HANDLER_TIMEOUT_MS: '0' }).REQUEST_HANDLER_TIMEOUT_MS, 0);
    });

    it('rejects a timeout larger than setTimeout can hold', () => {
      assert.throws(
        () => parse({ REQUEST_HANDLER_TIMEOUT_MS: '3000000000' }),
        /REQUEST_HANDLER_TIMEOUT_MS/,
      );
    });
  });

  describe('socket timers', () => {
    it("requires HTTP_HEADERS_TIMEOUT_MS to exceed HTTP_KEEP_ALIVE_TIMEOUT_MS plus Node's 1s keep-alive buffer", () => {
      // Node closes an idle keep-alive socket at keepAlive + 1000ms. A headers timeout that fires
      // at the same moment can answer a reused connection with a 408.
      assert.throws(
        () => parse({ HTTP_KEEP_ALIVE_TIMEOUT_MS: '65000', HTTP_HEADERS_TIMEOUT_MS: '66000' }),
        /HTTP_HEADERS_TIMEOUT_MS/,
      );
      assert.equal(
        parse({ HTTP_KEEP_ALIVE_TIMEOUT_MS: '65000', HTTP_HEADERS_TIMEOUT_MS: '66001' })
          .HTTP_HEADERS_TIMEOUT_MS,
        66001,
      );
    });

    it('requires HTTP_REQUEST_TIMEOUT_MS to be at least HTTP_HEADERS_TIMEOUT_MS', () => {
      assert.throws(() => parse({ HTTP_REQUEST_TIMEOUT_MS: '50000' }), /HTTP_REQUEST_TIMEOUT_MS/);
    });

    it('lets HTTP_REQUEST_TIMEOUT_MS=0 disable the request timeout, as Node does', () => {
      assert.equal(parse({ HTTP_REQUEST_TIMEOUT_MS: '0' }).HTTP_REQUEST_TIMEOUT_MS, 0);
    });

    it('lets HTTP_HEADERS_TIMEOUT_MS=0 disable the headers timeout, as Node does', () => {
      assert.equal(parse({ HTTP_HEADERS_TIMEOUT_MS: '0' }).HTTP_HEADERS_TIMEOUT_MS, 0);
    });
  });

  describe('shutdown timers', () => {
    it('requires SHUTDOWN_DELAY_MS < SHUTDOWN_TIMEOUT_MS', () => {
      assert.throws(
        () => parse({ SHUTDOWN_DELAY_MS: '8000', SHUTDOWN_TIMEOUT_MS: '8000' }),
        /SHUTDOWN_DELAY_MS/,
      );
    });

    it('rejects a timeout larger than setTimeout can hold', () => {
      assert.throws(
        () => parse({ SHUTDOWN_TIMEOUT_MS: '3000000000', SHUTDOWN_DELAY_MS: '0' }),
        /SHUTDOWN_TIMEOUT_MS/,
      );
    });
  });

  describe('idempotency', () => {
    it('requires REDIS_URL when the store is redis', () => {
      assert.throws(() => parse({ IDEMPOTENCY_STORE: 'redis' }), /REDIS_URL/);
    });

    it('requires the lock to outlive the request handler', () => {
      assert.throws(
        () => parse({ IDEMPOTENCY_LOCK_TTL_S: '30', REQUEST_HANDLER_TIMEOUT_MS: '30000' }),
        /IDEMPOTENCY_LOCK_TTL_S/,
      );
    });

    it('skips those checks when idempotency is disabled', () => {
      const env = parse({ IDEMPOTENCY_ENABLED: 'false', IDEMPOTENCY_STORE: 'redis' });
      assert.equal(env.IDEMPOTENCY_ENABLED, false);
      assert.equal(env.REDIS_URL, undefined);
    });
  });

  describe('production guards', () => {
    it('rejects pretty logs', () => {
      assert.throws(() => parse({ NODE_ENV: 'production', LOG_PRETTY: 'true' }), /LOG_PRETTY/);
    });

    it('rejects trusting every proxy', () => {
      assert.throws(() => parse({ NODE_ENV: 'production', TRUST_PROXY: 'true' }), /TRUST_PROXY/);
    });

    it('accepts a hop count', () => {
      assert.equal(
        parse({ NODE_ENV: 'production', TRUST_PROXY: '1', JWT_SECRET: 'x'.repeat(32) }).TRUST_PROXY,
        1,
      );
    });

    it('requires JWT_SECRET, since a random one would sign out every user on each restart', () => {
      assert.throws(() => parse({ NODE_ENV: 'production' }), /JWT_SECRET/);
    });
  });

  describe('jwt', () => {
    it('keeps a JWT_SECRET that is set', () => {
      assert.equal(parse({ JWT_SECRET: 's'.repeat(40) }).JWT_SECRET, 's'.repeat(40));
    });

    it('generates a different secret for every process that has none', () => {
      assert.notEqual(parse().JWT_SECRET, parse().JWT_SECRET);
    });

    it('rejects a secret shorter than 32 characters', () => {
      assert.throws(() => parse({ JWT_SECRET: 'short' }), /JWT_SECRET/);
    });

    it('requires refresh tokens to outlive access tokens', () => {
      assert.throws(
        () => parse({ JWT_ACCESS_TTL_S: '900', JWT_REFRESH_TTL_S: '900' }),
        /JWT_REFRESH_TTL_S/,
      );
    });
  });

  describe('error message', () => {
    it('names the variable but never prints its value', () => {
      const secret = 'sup3r-s3cret-value';
      assert.throws(
        () => parse({ PORT: secret }),
        (err: unknown) =>
          err instanceof Error && err.message.includes('PORT') && !err.message.includes(secret),
      );
    });
  });
});
