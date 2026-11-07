# `jobs/`

One job definition per kind of background work: its name, the queue it runs on, what its payload must match, and how it is retried. The engine is in [`lib/queue/`](../lib/queue/); the rules are in the root [README](../../README.md#background-jobs).

**What belongs here:** [`queues.ts`](queues.ts), which defines every queue once (`defineQueue`: its name, concurrency and rate limit), and `<name>.job.ts` files, each exporting `defineJob(…)` values named `<name>Job`, and the `defineSchedule(…)` values that run them on a schedule, named `<name>Schedule`. Nothing else: no queue, no Redis, no handler. A definition is pure, so a service imports it to enqueue the job, and a handler in [`workers/`](../workers/) imports it to run the job, without either depending on the other.

```ts
// jobs/example.job.ts
export const exampleJob = defineJob({
  name: 'example.noop',               // <area>.<action>, unique across queues
  queue: defaultQueue,                // from ./queues.ts
  schema: z.object({ message: z.string().max(200) }),
  attempts: 3,                        // the first run included
  timeoutMs: 10_000,
})
```

```ts
// a service, given `jobs` from the container
await jobs.enqueue(exampleJob, { message: 'hello' }, { jobId: `example-${id}` })
```

- **The payload is a reference, not a copy.** Put the id of what the job is about, and let the handler read the current record: a job can run minutes after it was enqueued, and a payload is stored as JSON in a Redis that never evicts. Its size is capped by `maxPayloadBytes` (64 KiB by default); a larger one is refused when enqueued.
- **The schema must describe plain JSON.** `defineJob` refuses dates, bigints and functions: the payload is stored as JSON and parsed again before it runs.
- **A queue is a deployment decision.** Jobs on one queue share its workers, its concurrency and its rate limit; give work with another urgency, cost or provider limit its own queue in `queues.ts`, and `WORKER_QUEUES` can then run it in its own processes.
- **A schedule is a job plus when.** `defineSchedule({ id, job, payload, every | cron, timezone? })` checks its payload now; it runs once listed in `createJobSchedules` in [`workers/index.ts`](../workers/index.ts). Its `id` names it in Redis: change it and the old one stays until `pnpm jobs unschedule`.

[`example.job.ts`](example.job.ts) is a placeholder that shows the shape, with an hourly `exampleSchedule` that is not listed; its handler does nothing. Copy it for real work, then delete it and its handler.

**Not yet possible here: crash-proof enqueue.** `jobs.enqueue` after a database write is not atomic with it: a crash between the two loses the job. Enqueuing in the same transaction as the write (an outbox, as the cache has) needs a real database, so it comes with the database branch. Real email flows (password reset, email verification) need that database too.
