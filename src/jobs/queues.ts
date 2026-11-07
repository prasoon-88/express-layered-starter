import { defineQueue } from '#lib/queue/index';

/**
 * Every queue, defined once and shared by the jobs that run on it. Give work with another urgency
 * or cost a queue of its own, with its own concurrency, and a rate limit where a provider sets
 * one, e.g. `defineQueue({ name: 'email', concurrency: 10, rateLimit: { max: 14, perMs: 1_000 } })`.
 */
export const defaultQueue = defineQueue({ name: 'default' });
