import type { Redis } from '#lib/redis/index';
import type { Logger } from 'pino';
import type { PolicyName, PolicyRegistry } from './policies.ts';
import { policySchema, type Policy } from './types.ts';
import { MS_PER_SECOND } from '#constants/time.constant';

type StartPolicySyncConfig = {
  redis: Pick<Redis, 'hgetall'>;
  hasKey: string;
  registry: PolicyRegistry;
  intervalS: number;
  log: Logger;
};

type StartPolicySync = (o: StartPolicySyncConfig) => () => void;

export const startPolicySync: StartPolicySync = (o) => {
  const sync = async () => {
    try {
      const raw = await o.redis.hgetall(o.hasKey);
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
  const timer = setInterval(() => void sync(), o.intervalS * MS_PER_SECOND);
  timer.unref();
  return () => clearInterval(timer);
};
