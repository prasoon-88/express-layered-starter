import { exampleJob } from '#jobs/example.job';
import { handleJob } from '#lib/queue/index';

/**
 * Runs `exampleJob`, and does nothing: a placeholder for the shape of a handler. A real one does
 * its work here, passing `signal` on (it fires at the job's timeoutMs), and is safe to run twice:
 * a job runs at least once, and again after a retry or a worker that died mid-run.
 */
export const createExampleHandler = () =>
  handleJob(exampleJob, ({ message }, { log }) => {
    log.debug({ message }, 'example job ran; it does nothing');
    return Promise.resolve();
  });
