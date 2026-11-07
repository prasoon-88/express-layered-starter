import * as z from 'zod';
import { defineJob, defineSchedule } from '#lib/queue/index';
import { defaultQueue } from './queues.ts';

/**
 * A placeholder that shows the shape of a job; its handler does nothing. Copy it for real work,
 * then delete it and its handler in `workers/example.worker.ts`.
 *
 * Enqueued from a service with the `jobs` dependency:
 *
 *   await jobs.enqueue(exampleJob, { message: 'hello' }, { jobId: `example-${id}` })
 *
 * That is not atomic with a database write made before it: a crash between the two loses the job.
 * Enqueuing in the same transaction as the write needs a real database, so it comes with the
 * database branch (an outbox, as the cache has). Real email flows (password reset, email
 * verification) need that database too.
 */
export const exampleJob = defineJob({
  name: 'example.noop',
  queue: defaultQueue,
  schema: z.object({ message: z.string().max(200) }),
  attempts: 3,
  timeoutMs: 10_000,
});

/**
 * The example job, hourly: the shape of a schedule. Not run: add it to `createJobSchedules` in
 * `workers/index.ts` to run it. `cron: '0 3 * * *', timezone: 'Europe/Berlin'` instead of `every`
 * runs it at 03:00 Berlin time.
 */
export const exampleSchedule = defineSchedule({
  id: 'example-hourly',
  job: exampleJob,
  payload: { message: 'scheduled' },
  every: 60 * 60 * 1_000,
});
