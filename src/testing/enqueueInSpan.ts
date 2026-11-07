// Test-only. A producer process for src/worker.test.ts: started with the telemetry preload, it
// enqueues the example job inside a span, prints that span's trace id, and flushes its spans, so
// the test can check the worker's spans for the same job carry the same trace.
import { trace } from '@opentelemetry/api';
import { ENV_CONSTANTS } from '#constants/env/index';
import { exampleJob } from '#jobs/example.job';
import { getLogger } from '#lib/logger/index';
import { initJobs } from '#lib/queue/index';
import { shutdownTelemetry } from '#lib/telemetry/state';

const { jobs, close } = await initJobs(ENV_CONSTANTS, getLogger('enqueue-in-span'));
const traceId = await trace
  .getTracer('enqueue-in-span')
  .startActiveSpan('request', async (span) => {
    await jobs.enqueue(exampleJob, { message: 'traced' }, { jobId: process.argv[2] });
    span.end();
    return span.spanContext().traceId;
  });
await close();
await shutdownTelemetry();
process.stdout.write(`${traceId}\n`);
