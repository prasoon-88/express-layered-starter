import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { listen, postJson, waitFor } from '#testing/http';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';

// The real server in a child process, started the way pnpm start starts it, exporting OTLP/JSON
// to a receiver in this test. Instrumentation only works from the preload, so nothing less
// than a separate process tests it.

const ROOT = resolve(import.meta.dirname, '../../..');
const PASSWORD = 'correct-horse-1';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT_SPAN_ID = '00f067aa0ba902b7';
const SERVER = 2;
const CLIENT = 3;

type Attribute = { key: string; value: { stringValue?: string; intValue?: string | number } };
type Span = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  attributes: Attribute[];
};

const attr = (span: Span, key: string) => {
  const value = span.attributes.find((a) => a.key === key)?.value;
  return value?.stringValue ?? value?.intValue;
};

// An OTLP/HTTP endpoint: keeps every body it is sent, per signal path.
const startReceiver = async () => {
  const bodies: Record<string, unknown[]> = {};
  const { server, baseUrl } = await listen(
    createServer((req, res) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => (raw += chunk));
      req.on('end', () => {
        (bodies[req.url ?? ''] ??= []).push(JSON.parse(raw));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
      });
    }),
  );

  const spans = () =>
    (bodies['/v1/traces'] ?? []).flatMap((body) =>
      (body as { resourceSpans: { scopeSpans: { spans: Span[] }[] }[] }).resourceSpans.flatMap(
        (rs) => rs.scopeSpans.flatMap((ss) => ss.spans),
      ),
    );
  return { url: baseUrl, bodies, spans, server };
};

type Started = { child: ChildProcess; baseUrl: string; stdout: () => string; stderr: () => string };

const children: ChildProcess[] = [];

const startApp = async (
  env: Record<string, string>,
  { preload = true }: { preload?: boolean } = {},
): Promise<Started> => {
  const port = await freePort();
  // A clean slate of OTEL_* variables, so the developer's or CI's own never leak in.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('OTEL_')),
  );
  const child = spawn(
    process.execPath,
    [
      '--conditions=app-source',
      ...(preload ? ['--import', './src/instrumentation.ts'] : []),
      'src/server.ts',
    ],
    {
      cwd: ROOT,
      env: {
        ...inherited,
        // No coverage from the child. Under test:coverage it would write its own next to this
        // process's, but the preload's hook rewrites every module it loads (`app.ts?iitm=true`),
        // and those counts, merged into the report, wreck the line coverage of all of src/.
        // Empty, not absent: spawn copies an absent NODE_V8_COVERAGE in from process.env.
        NODE_V8_COVERAGE: '',
        NODE_ENV: 'production',
        JWT_SECRET: 'telemetry-test-only-not-a-real-secret-0123',
        PORT: String(port),
        SHUTDOWN_DELAY_MS: '0',
        LOG_IGNORE_PATHS: '/favicon.ico',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(child);

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));

  const baseUrl = `http://127.0.0.1:${port}`;
  // Generous: the suite boots several of these while every other test file runs alongside.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await fetch(`${baseUrl}/health/live`);
      break;
    } catch {
      if (Date.now() > deadline || child.exitCode !== null)
        throw new Error(`the app did not start:\n${stdout}\n${stderr}`);
      await sleep(100);
    }
  }
  return { child, baseUrl, stdout: () => stdout, stderr: () => stderr };
};

after(() => {
  for (const child of children) child.kill();
});

describe('OpenTelemetry, end to end', { skip: redisSkip }, () => {
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  let redisUrl = '';

  before(async () => {
    receiver = await startReceiver();
    const port = await freePort();
    await startRedisServer(port);
    redisUrl = `redis://127.0.0.1:${port}`;
  });

  after(() => {
    receiver.server.close();
  });

  describe('with an OTLP endpoint', () => {
    let app: Started;
    let secrets: string[] = [];

    before(async () => {
      app = await startApp({
        OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        OTEL_BSP_SCHEDULE_DELAY: '100',
        OTEL_METRIC_EXPORT_INTERVAL: '500',
        // Left empty, as a .env copied from .env.example has them: empty means the default.
        OTEL_EXPORTER_OTLP_HEADERS: '',
        OTEL_METRICS_EXPORTER: '',
        OTEL_TRACES_SAMPLER: '',
        REDIS_URL: redisUrl,
        AUTH_STORE: 'redis',
        RATE_LIMIT_STORE: 'redis',
        IDEMPOTENCY_STORE: 'redis',
      });

      const api = `${app.baseUrl}/api/v1`;
      const user = { fullName: 'Ada', email: 'otel@example.com', password: PASSWORD };
      assert.equal((await postJson(`${api}/user/register`, user)).status, 201);

      const login = await postJson(`${api}/auth/login`, { email: user.email, password: PASSWORD });
      const { refreshToken } = ((await login.json()) as { data: { refreshToken: string } }).data;
      assert.equal((await postJson(`${api}/auth/refresh`, { refreshToken })).status, 200);
      secrets = [PASSWORD, ...refreshToken.split('.')];

      const traced = await postJson(
        `${api}/auth/login`,
        { email: user.email, password: 'wrong-password-0' },
        { traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`, 'X-Request-Id': 'req-otel-1' },
      );
      assert.equal(traced.status, 401);
      secrets.push('wrong-password-0');

      await fetch(`${app.baseUrl}/health/ready`);
    });

    // It keeps exporting metrics; the tests after this block expect a quiet receiver.
    after(() => {
      app.child.kill();
    });

    const loginSpan = () =>
      waitFor(
        () => receiver.spans().find((s) => s.kind === SERVER && s.traceId === TRACE_ID),
        'the traced login span',
      );

    it('names the server span by its route and continues the caller’s trace', async () => {
      const span = await loginSpan();

      assert.equal(span.name, 'POST /api/v1/auth/login');
      assert.equal(attr(span, 'http.route'), '/api/v1/auth/login');
      assert.equal(span.parentSpanId, PARENT_SPAN_ID);
      assert.equal(attr(span, 'app.request_id'), 'req-otel-1');
    });

    it('traces Redis inside the request, recording the command and nothing else', async () => {
      await loginSpan();
      const redisSpans = receiver
        .spans()
        .filter((s) => s.kind === CLIENT && attr(s, 'db.system.name') === 'redis');

      assert.ok(redisSpans.length > 0, 'redis spans exported');
      assert.ok(
        redisSpans.some((s) => s.traceId === TRACE_ID),
        'the rate limit check, in the request',
      );
      const commandSpans = redisSpans.filter((s) => s.name !== 'connect');
      assert.ok(commandSpans.length > 0, 'redis command spans exported');
      // A bare command name (`EVAL`, `HGETALL`, `MULTI` for a transaction): no key, no argument.
      for (const span of commandSpans)
        assert.match(String(attr(span, 'db.query.text')), /^[A-Z]+$/, span.name);
    });

    it('exports no password, refresh token or token id anywhere', async () => {
      await loginSpan();
      const exported = JSON.stringify(receiver.bodies);
      for (const secret of secrets) assert.equal(exported.includes(secret), false, secret);
    });

    it('does not trace health probes', async () => {
      await loginSpan();
      const paths = receiver
        .spans()
        .map((s) => String(attr(s, 'url.path') ?? attr(s, 'http.route') ?? ''));
      assert.equal(
        paths.some((p) => p.startsWith('/health')),
        false,
      );
    });

    it('adds trace_id and span_id to the log lines of a traced request', async () => {
      const span = await loginSpan();
      const line = await waitFor(
        () =>
          app
            .stdout()
            .split('\n')
            .find((l) => l.includes('"Request Failed"') && l.includes(TRACE_ID)),
        'the log line',
      );
      const log = JSON.parse(line) as Record<string, unknown>;

      assert.equal(log.trace_id, TRACE_ID);
      assert.equal(typeof log.span_id, 'string');
      assert.equal(log.requestId, 'req-otel-1');
      assert.equal(span.traceId, log.trace_id);
    });

    it('exports HTTP metrics', async () => {
      const names = await waitFor(() => {
        const found = JSON.stringify(receiver.bodies['/v1/metrics'] ?? []);
        return found.includes('http.server.request.duration') ? found : undefined;
      }, 'http.server.request.duration');
      assert.ok(names.includes('http.server.request.duration'));
    });

    it('starts without a deprecation warning or a missing-preload warning', () => {
      assert.equal(/DeprecationWarning|DEP0\d+/.test(app.stderr()), false, app.stderr());
      assert.equal(app.stdout().includes('was not started'), false);
    });
  });

  // With no destination the preload starts nothing, so pino is not instrumented either.
  it('starts nothing without a destination: no trace ids in the logs, no warning', async () => {
    const app = await startApp({});
    await postJson(`${app.baseUrl}/api/v1/auth/login`, {
      email: 'nobody@example.com',
      password: 'x',
    });
    await waitFor(
      () => (app.stdout().includes('"Request Failed"') ? true : undefined),
      'the failed login log line',
    );

    assert.equal(app.stdout().includes('trace_id'), false);
    assert.equal(app.stdout().includes('was not started'), false);
  });

  it('warns when a destination is set but the preload was not', async () => {
    const app = await startApp(
      { OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json' },
      { preload: false },
    );
    await waitFor(
      () =>
        app.stdout().includes('OpenTelemetry is configured but was not started') ? true : undefined,
      'the warning',
    );
  });

  // Windows has no SIGTERM: child.kill() there ends the process without running its handlers.
  it(
    'flushes spans still buffered when the process shuts down',
    { skip: process.platform === 'win32' && 'needs a real SIGTERM' },
    async () => {
      const flushTrace = '0af7651916cd43dd8448eb211c80319c';
      const app = await startApp({
        OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        // Never on a timer: the span can only arrive through the shutdown flush.
        OTEL_BSP_SCHEDULE_DELAY: '600000',
        OTEL_METRICS_EXPORTER: 'none',
      });
      await fetch(`${app.baseUrl}/`, {
        headers: { traceparent: `00-${flushTrace}-${PARENT_SPAN_ID}-01` },
      });

      app.child.kill('SIGTERM');
      await once(app.child, 'exit');

      assert.ok(receiver.spans().some((s) => s.traceId === flushTrace));
    },
  );
});
