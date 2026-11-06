process.env.NODE_ENV ??= 'test';
// Set before telemetry.config reads them. Traces only, never exported on a timer: a span can
// only reach the receiver through the shutdown flush.
process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json';
process.env.OTEL_TRACES_EXPORTER = 'otlp';
process.env.OTEL_METRICS_EXPORTER = 'none';
process.env.OTEL_BSP_SCHEDULE_DELAY = '600000';
process.env.OTEL_SDK_DISABLED = 'false';

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';

// startTelemetry and shutdownTelemetry in this process. The end-to-end test (index.test.ts)
// proves what gets traced through the real preload; this one the start/shutdown contract. The
// preload's ES module hook is not registered here: it rewrites every module loaded after it,
// which would make this process's coverage report meaningless.

const received: string[] = [];
const receiver = createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => (raw += chunk));
  req.on('end', () => {
    received.push(raw);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  });
});

let state: typeof import('./state.ts');
let startTelemetry: typeof import('./index.ts').startTelemetry;

before(async () => {
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  const address = receiver.address();
  assert.ok(address && typeof address === 'object');
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}`;

  state = await import('./state.ts');
  ({ startTelemetry } = await import('./index.ts'));
});

after(() => {
  receiver.close();
});

describe('startTelemetry', () => {
  it('starts nothing until it is called', async () => {
    assert.equal(state.isTelemetryStarted(), false);
    await state.shutdownTelemetry();
  });

  it('starts the SDK when a destination is set', () => {
    startTelemetry();
    assert.equal(state.isTelemetryStarted(), true);
  });

  // A second SDK would replace the one shutdown flushes, losing what the first one buffered.
  it('exports the spans still buffered when shutdownTelemetry resolves, even after a second start', async () => {
    const { trace } = await import('@opentelemetry/api');
    trace.getTracer('start.test').startSpan('buffered-at-shutdown').end();
    assert.equal(received.length, 0, 'nothing is exported before the flush');

    startTelemetry();
    await state.shutdownTelemetry();

    assert.ok(received.some((body) => body.includes('"buffered-at-shutdown"')));
  });
});
