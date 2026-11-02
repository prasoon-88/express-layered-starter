import { isIP } from 'node:net';
import type { LevelWithSilent } from 'pino';
import * as z from 'zod';

const NODE_ENVS = ['development', 'test', 'production'] as const;
const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const satisfies readonly LevelWithSilent[];
const PROXY_PRESETS = ['loopback', 'linklocal', 'uniquelocal'];

// setTimeout's limit. A larger delay overflows and fires after 1 ms instead.
const MAX_TIMER_MS = 2_147_483_647;

const isProxyAddress = (item: string) => {
  if (PROXY_PRESETS.includes(item)) return true;

  const [ip = '', prefix, ...extra] = item.split('/');
  if (extra.length > 0 || isIP(ip) === 0) return false;
  if (prefix === undefined) return true;

  const max = isIP(ip) === 4 ? 32 : 128;
  return /^\d+$/.test(prefix) && Number(prefix) >= 1 && Number(prefix) <= max;
};

const isValidTrustProxy = (value: string) =>
  value === 'true' ||
  value === 'false' ||
  /^\d+$/.test(value) || // hop count
  value.split(',').every((item) => isProxyAddress(item.trim())); // every item is valid

const toTrustProxy = (value: string): boolean | number | string => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value; // names / IPs: Express reads them
};

const trustProxy = () =>
  z
    .string()
    .trim()
    .refine(isValidTrustProxy, 'Expected true, false, a hop count, or loopback/IP/CIDR values')
    .transform(toTrustProxy);

const wholeNumber = ({ min = 0, max = Number.MAX_SAFE_INTEGER } = {}) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, 'Expected a whole number')
    .transform(Number)
    .pipe(z.number().min(min).max(max));

const bool = (value = false) => z.stringbool().default(value);

const list = z.string().transform((value) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
);

// `KEY=` in a .env file arrives as "". Treat it as unset, because Zod only applies
// `.default()` when a value is undefined. Removing this breaks boot with `.env.example`.
const withoutEmptyValues = (env: unknown): unknown =>
  typeof env === 'object' && env !== null
    ? Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''))
    : env;

const envSchema = z.preprocess(
  withoutEmptyValues,
  z
    .object({
      NODE_ENV: z.enum(NODE_ENVS),
      PORT: wholeNumber({ min: 1, max: 65_535 }).default(8000),
      SERVICE_NAME: z.string().trim().min(1).optional(),
      // Set by pnpm/npm for every script; the fallback service name.
      npm_package_name: z.string().optional(),
      LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
      LOG_PRETTY: bool(),
      LOG_IGNORE_PATHS: list
        .pipe(z.array(z.string().startsWith('/', 'Each path must start with "/"')))
        .default(['/health', '/favicon.ico']),
      TRUST_PROXY: trustProxy().default(false),
      LOG_SLOW_MS: wholeNumber().default(1000),
      SHUTDOWN_TIMEOUT_MS: wholeNumber({ max: MAX_TIMER_MS }).default(8000),
      SHUTDOWN_DELAY_MS: wholeNumber({ max: MAX_TIMER_MS }).default(5000),
    })
    .superRefine((e, ctx) => {
      if (e.SHUTDOWN_DELAY_MS >= e.SHUTDOWN_TIMEOUT_MS)
        ctx.addIssue({
          code: 'custom',
          path: ['SHUTDOWN_DELAY_MS'],
          message: 'Must be less than SHUTDOWN_TIMEOUT_MS',
        });

      if (e.NODE_ENV === 'production' && e.LOG_PRETTY)
        ctx.addIssue({
          code: 'custom',
          path: ['LOG_PRETTY'],
          message: 'Disable in production',
        });
      if (e.NODE_ENV === 'production' && e.TRUST_PROXY === true)
        ctx.addIssue({
          code: 'custom',
          path: ['TRUST_PROXY'],
          message: 'Use a hop count or CIDR in production',
        });
    })
    .transform(({ npm_package_name, ...e }) => ({
      ...e,
      SERVICE_NAME: e.SERVICE_NAME ?? npm_package_name ?? 'app',
      EXPOSE_ERROR_STACK: e.NODE_ENV === 'development',
    })),
);

export type Env = z.output<typeof envSchema>;

// Throws instead of calling process.exit, so tests can assert on a bad env.
// Thrown while the module loads, it still stops the app with exit code 1.
export const parseEnv = (env: unknown): Env => {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};
