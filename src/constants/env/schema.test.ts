import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from './schema.ts';

// Every case starts from the one required variable, so each test only states what it changes.
const parse = (env: Record<string, string> = {}) => parseEnv({ NODE_ENV: 'test', ...env });

describe('parseEnv', () => {
  describe('defaults', () => {
    it('applies a default to every optional variable', () => {
      assert.deepEqual(parse(), {
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
      assert.equal(parse({ NODE_ENV: 'production' }).EXPOSE_ERROR_STACK, false);
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

  describe('production guards', () => {
    it('rejects pretty logs', () => {
      assert.throws(() => parse({ NODE_ENV: 'production', LOG_PRETTY: 'true' }), /LOG_PRETTY/);
    });

    it('rejects trusting every proxy', () => {
      assert.throws(() => parse({ NODE_ENV: 'production', TRUST_PROXY: 'true' }), /TRUST_PROXY/);
    });

    it('accepts a hop count', () => {
      assert.equal(parse({ NODE_ENV: 'production', TRUST_PROXY: '1' }).TRUST_PROXY, 1);
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
