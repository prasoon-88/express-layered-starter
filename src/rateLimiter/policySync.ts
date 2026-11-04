import type { Redis } from '#lib/redis/index';
import type { Logger } from 'pino';
import type { PolicyName, PolicyRegistry } from './policies.ts';
import { policySchema, type Policy } from './types.ts';

type StartPolicySyncConfig = {
  redis: Redis;
  hasKey: string;
  registry: PolicyRegistry;
  intervalS: number;
  log: Logger;
};

type StartPolicySync = (o: StartPolicySyncConfig) => () => void;

export const startPolicySync: StartPolicySync = (o) => {
  const sync = async () => {
    try {
      const raw = await o.redis.hGetAll(o.hasKey);
      const next: Record<string, Policy> = {};
      for (const [name, json] of Object.entries(raw)) {
        if (!o.registry.has(name as PolicyName)) {
          o.log.warn({ name }, 'ignoring override for unknown policy');
          continue;
        }

        let value: unknown;
        try {
          value = JSON.parse(json);
        } catch {
          o.log.warn({ name }, 'ignoring override: invalid JSON');
          continue;
        }

        const parsed = policySchema.safeParse(value);
        if (!parsed.success) {
          o.log.warn({ name }, 'ignoring override: invalid policy');
          continue;
        }
        next[name] = parsed.data;
      }
      o.registry.setOverrides(next); // removed fields revert to defaults
    } catch (err) {
      o.log.warn({ err }, 'policy sync failed; keeping last known policies');
    }
  };

  void sync();
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const timer = setInterval(sync, o.intervalS);
  timer.unref();
  return () => clearInterval(timer);
};
