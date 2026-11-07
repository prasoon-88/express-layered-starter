import type { JobHandler, JobSchedule } from '#lib/queue/index';
import { createExampleHandler } from './example.worker.ts';

/**
 * Every job handler the worker process runs. Each one is built here with what it needs (a
 * repository, a client), the way a module wires a service; `src/worker.ts` starts them.
 */
export type WorkerDeps = Record<string, never>;

export const createJobHandlers = (_deps: WorkerDeps): readonly JobHandler[] => [
  createExampleHandler(),
];

/**
 * The schedules the worker writes to Redis at startup (see `syncJobSchedules`). None on `main`;
 * add `exampleSchedule` from `#jobs/example.job` to see one run hourly. A schedule taken out of
 * this list stays in Redis until `pnpm jobs unschedule <queue> <id>` removes it.
 */
export const createJobSchedules = (): readonly JobSchedule[] => [];
