# `workers/`

The job handlers the worker process runs (`pnpm start:worker`, [`src/worker.ts`](../worker.ts)): one `<name>.worker.ts` per job in [`jobs/`](../jobs/), and [`index.ts`](index.ts), which builds them all with their dependencies, the way a module wires a service.

```ts
// workers/example.worker.ts
export const createExampleHandler = () =>
  handleJob(exampleJob, async ({ message }, { signal, log, attempt, jobId }) => {
    // the work
  })

// workers/index.ts
export const createJobHandlers = (deps: WorkerDeps) => [createExampleHandler()]
export const createJobSchedules = () => [] // e.g. [exampleSchedule]
```

- **A handler is safe to run twice.** A job runs at least once: a retry, or a worker that died mid-run, runs it again. Check before acting (is the email already sent?), or make the effect idempotent.
- **Pass `signal` on.** It fires at the job's `timeoutMs`, and when shutdown cancels the job. Work that ignores it keeps running after the run was given up.
- **Throw `PermanentJobError` for what no retry can fix** (the record is gone, the address is refused): the job fails at once instead of spending its attempts.
- **Read the current state, not the payload's copy of it.** The payload names what to work on; the handler loads it, through a service or a repository given in `deps`.
- **A schedule needs a handler here.** The worker writes the schedules in `createJobSchedules` at startup, and stops if one names a job no handler runs.
- **A handler only runs jobs.** It never serves requests and is never imported by the API process, so the API's container and the worker's dependencies stay apart.

[`example.worker.ts`](example.worker.ts) handles the placeholder job and does nothing; delete both once a real job exists.
