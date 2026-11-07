import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Queue } from 'bullmq';
import pino from 'pino';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { listen } from '#testing/http';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';

// The worker process itself, as `pnpm start:worker` runs it: boots, reports ready, runs a job
// another process enqueued (carrying that process's trace), refuses a Redis it must not use, and
// stops cleanly on SIGTERM.

const ROOT = resolve(import.meta.dirname, '..');
const SERVICE_NAME = 'worker-process-test';
// OTLP's SpanKind: the span BullMQ makes for running a job is a consumer.
const CONSUMER = 5;
const silent = pino({ level: 'silent' });

type Span = { traceId: string; name: string; kind: number };

// An OTLP/HTTP endpoint that keeps every span it is sent.
const startReceiver = async () => {
  const spans: Span[] = [];
  const { server, baseUrl } = await listen(
    createServer((req, res) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => (raw += chunk));
      req.on('end', () => {
        if (req.url === '/v1/traces') {
          const body = JSON.parse(raw) as {
            resourceSpans: { scopeSpans: { spans: Span[] }[] }[];
          };
          for (const rs of body.resourceSpans)
            for (const ss of rs.scopeSpans) spans.push(...ss.spans);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
      });
    }),
  );
  return { url: baseUrl, spans, server };
};

const children: ChildProcess[] = [];

after(() => {
  for (const child of children) child.kill();
});

/** Spawns a script from src/ the way the package scripts do, with the telemetry preload. */
const spawnScript = (script: string, env: Record<string, string>, args: string[] = []) => {
  // A clean slate of OTEL_* variables, so the developer's or CI's own never leak in.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('OTEL_')),
  );
  const child = spawn(
    process.execPath,
    ['--conditions=app-source', '--import', './src/instrumentation.ts', script, ...args],
    {
      cwd: ROOT,
      env: {
        ...inherited,
        // See lib/telemetry/index.test.ts: a child's coverage would corrupt this process's report.
        NODE_V8_COVERAGE: '',
        NODE_ENV: 'production',
        SERVICE_NAME,
        JWT_SECRET: 'worker-test-only-not-a-real-secret-012345',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(child);
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  return { child, output: () => output };
};

const until = async (condition: () => boolean | Promise<boolean>, what: string, ms = 30_000) => {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) assert.fail(`timed out waiting until ${what}`);
    await sleep(50);
  }
};

const ready = async (port: number) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health/ready`)).status === 200;
  } catch {
    return false;
  }
};

describe('the worker process', { skip: redisSkip }, () => {
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  let url = '';
  let redis: Redis;

  before(async () => {
    receiver = await startReceiver();
    const port = await freePort();
    // noeviction is Redis's default, so production accepts it.
    await startRedisServer(port);
    url = `redis://127.0.0.1:${port}`;
    redis = await createRedisClient(url, silent, { connectTimeoutMs: 1_000 });
  });

  after(async () => {
    receiver.server.close();
    await closeRedisClient(redis);
  });

  const telemetry = () => ({
    OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_BSP_SCHEDULE_DELAY: '100',
    OTEL_METRICS_EXPORTER: 'none',
  });

  it('runs a job another process enqueued, in the same trace, and reports ready', async () => {
    const healthPort = await freePort();
    const worker = spawnScript('src/worker.ts', {
      QUEUE_REDIS_URL: url,
      WORKER_HEALTH_PORT: String(healthPort),
      ...telemetry(),
    });
    await until(() => ready(healthPort), `the worker was ready:\n${worker.output()}`);

    const producer = spawnScript(
      'src/testing/enqueueInSpan.ts',
      { QUEUE_REDIS_URL: url, ...telemetry() },
      ['traced-1'],
    );
    const [code] = (await once(producer.child, 'exit')) as [number];
    assert.equal(code, 0, producer.output());
    const traceId = producer.output().trim().split('\n').at(-1)!;
    assert.match(traceId, /^[0-9a-f]{32}$/);

    const view = new Queue('default', {
      connection: redis,
      prefix: `${SERVICE_NAME}:jobs`,
      skipVersionCheck: true,
    });
    try {
      await until(
        async () => (await (await view.getJob('traced-1'))?.getState()) === 'completed',
        'the worker completed the job',
      );
    } finally {
      await view.close();
    }

    // The producer's span, BullMQ's span for adding the job, and the worker's span for running
    // it: one trace across both processes.
    await until(
      () =>
        receiver.spans.some(
          (span) =>
            span.traceId === traceId && span.kind === CONSUMER && span.name.includes('process'),
        ),
      `the worker exported a span in trace ${traceId}; got ${JSON.stringify(receiver.spans.map((s) => [s.name, s.traceId]))}`,
    );
  });

  it(
    'stops on SIGTERM: not ready any more, then exits 0',
    // Windows has no SIGTERM: child.kill() there ends the process without running its handlers.
    { skip: process.platform === 'win32' && 'needs a real SIGTERM' },
    async () => {
      const healthPort = await freePort();
      const worker = spawnScript('src/worker.ts', {
        QUEUE_REDIS_URL: url,
        WORKER_HEALTH_PORT: String(healthPort),
      });
      await until(() => ready(healthPort), `the worker was ready:\n${worker.output()}`);
      worker.child.kill('SIGTERM');
      const [code] = (await once(worker.child, 'exit')) as [number];
      assert.equal(code, 0, worker.output());
    },
  );

  it('refuses, in production, a queue Redis that evicts, and exits', async () => {
    const port = await freePort();
    await startRedisServer(port);
    const evicting = await createRedisClient(`redis://127.0.0.1:${port}`, silent, {
      connectTimeoutMs: 1_000,
    });
    try {
      await evicting.config('SET', 'maxmemory-policy', 'allkeys-lru');
      const worker = spawnScript('src/worker.ts', {
        QUEUE_REDIS_URL: `redis://127.0.0.1:${port}`,
        WORKER_HEALTH_PORT: String(await freePort()),
      });
      const [code] = (await once(worker.child, 'exit')) as [number];
      assert.notEqual(code, 0);
      assert.match(worker.output(), /maxmemory-policy allkeys-lru/);
    } finally {
      await closeRedisClient(evicting);
    }
  });

  it('refuses to start without a queue Redis', async () => {
    const worker = spawnScript('src/worker.ts', {
      QUEUE_REDIS_URL: '',
      REDIS_URL: '',
      WORKER_HEALTH_PORT: String(await freePort()),
    });
    const [code] = (await once(worker.child, 'exit')) as [number];
    assert.equal(code, 1);
    assert.match(worker.output(), /set QUEUE_REDIS_URL, or REDIS_URL/);
  });
});
