import {
  CORS_DEFAULT_HEADERS,
  CORS_DEFAULT_EXPOSED_HEADERS,
} from '#constants/http/httpHeaders.constant';
import { DEFAULT_CORS_METHODS, HTTP_METHODS } from '#constants/http/methods.constant';
import { HTTP_KEEP_ALIVE_TIMEOUT_BUFFER_MS } from '#constants/http/server.constant';
import {
  DEFAULT_RATE_LIMIT_AUTH_BLOCK_S,
  DEFAULT_RATE_LIMIT_AUTH_MAX,
  DEFAULT_RATE_LIMIT_AUTH_WINDOW_S,
  DEFAULT_RATE_LIMIT_IPV6_SUBNET,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_POLICY_REFRESH_S,
  DEFAULT_RATE_LIMIT_SKIP_PATHS,
  DEFAULT_RATE_LIMIT_STORE,
  DEFAULT_RATE_LIMIT_WINDOW_S,
  DEFAULT_STORE_ERROR_MODE,
  RATE_LIMIT_STORES,
  STORE_ERROR_MODES,
} from '#constants/rateLimit.constants';
import REGEX from '#constants/regex.constant';
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

const isOriginRule = (v: string) => {
  if (v === '*') return true;
  const probe = v.replace('://*.', '://x.');
  if (probe.includes('*')) return false;
  try {
    return new URL(probe).origin === probe;
  } catch {
    return false;
  }
};

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
      CORS_ENABLED: bool(false),
      CORS_ORIGINS: list
        .pipe(
          z.array(
            z
              .string()
              .refine(
                isOriginRule,
                'Expected "*", an exact origin (https://app.example.com), or https://*.example.com (no path, no trailing slash)',
              ),
          ),
        )
        .default([]),
      CORS_CREDENTIALS: bool(),
      CORS_METHODS: list
        .transform((a) => a.map((v) => v.toUpperCase()))
        .pipe(z.array(z.enum(HTTP_METHODS)))
        .default([...DEFAULT_CORS_METHODS]),
      CORS_ALLOWED_HEADERS: list.default([...CORS_DEFAULT_HEADERS]),
      CORS_EXPOSED_HEADERS: list.default([...CORS_DEFAULT_EXPOSED_HEADERS]),
      CORS_MAX_AGE_S: wholeNumber().default(600),
      REDIS_URL: z
        .string()
        .trim()
        .regex(REGEX.REDIS_URL, 'Expected a redis:// or rediss:// URL')
        .optional(),
      RATE_LIMIT_ENABLED: bool(true),
      RATE_LIMIT_STORE: z.enum(RATE_LIMIT_STORES).default(DEFAULT_RATE_LIMIT_STORE),
      RATE_LIMIT_ON_STORE_ERROR: z.enum(STORE_ERROR_MODES).default(DEFAULT_STORE_ERROR_MODE),
      RATE_LIMIT_WINDOW_S: wholeNumber({ min: 1 }).default(DEFAULT_RATE_LIMIT_WINDOW_S),
      RATE_LIMIT_MAX: wholeNumber({ min: 1 }).default(DEFAULT_RATE_LIMIT_MAX),
      RATE_LIMIT_AUTH_WINDOW_S: wholeNumber({ min: 1 }).default(DEFAULT_RATE_LIMIT_AUTH_WINDOW_S),
      RATE_LIMIT_AUTH_MAX: wholeNumber({ min: 1 }).default(DEFAULT_RATE_LIMIT_AUTH_MAX),
      RATE_LIMIT_AUTH_BLOCK_S: wholeNumber().default(DEFAULT_RATE_LIMIT_AUTH_BLOCK_S),
      RATE_LIMIT_IPV6_SUBNET: wholeNumber({ min: 32, max: 128 }).default(
        DEFAULT_RATE_LIMIT_IPV6_SUBNET,
      ),
      RATE_LIMIT_POLICY_REFRESH_S: wholeNumber().default(DEFAULT_RATE_LIMIT_POLICY_REFRESH_S),
      RATE_LIMIT_SKIP_PATHS: list
        .pipe(z.array(z.string().startsWith('/', 'Each path must start with "/"')))
        .default([...DEFAULT_RATE_LIMIT_SKIP_PATHS]),
      LB_IDLE_TIMEOUT_MS: wholeNumber().default(60_000),
      HTTP_KEEP_ALIVE_TIMEOUT_MS: wholeNumber().default(65_000),
      HTTP_HEADERS_TIMEOUT_MS: wholeNumber().default(67_000),
      HTTP_REQUEST_TIMEOUT_MS: wholeNumber().default(120_000),
      REQUEST_HANDLER_TIMEOUT_MS: wholeNumber({ max: MAX_TIMER_MS }).default(30_000),
    })
    .superRefine((e, ctx) => {
      const addIssue = (path: string[], message: string) =>
        ctx.addIssue({
          code: 'custom',
          path,
          message,
        });

      if (e.SHUTDOWN_DELAY_MS >= e.SHUTDOWN_TIMEOUT_MS)
        addIssue(['SHUTDOWN_DELAY_MS'], 'Must be less than SHUTDOWN_TIMEOUT_MS');

      if (e.NODE_ENV === 'production') {
        if (e.LOG_PRETTY) addIssue(['LOG_PRETTY'], 'Disable in production');

        if (e.TRUST_PROXY === true)
          addIssue(['TRUST_PROXY'], 'Use a hop count or CIDR in production');
      }

      if (e.CORS_ENABLED) {
        if (!e.CORS_ORIGINS.length) addIssue(['CORS_ORIGINS'], 'Required when CORS_ENABLED=true');

        const wildcard = e.CORS_ORIGINS.includes('*');
        if (wildcard) {
          if (e.CORS_CREDENTIALS)
            addIssue(
              ['CORS_CREDENTIALS'],
              'Cannot combine with CORS_ORIGINS="*" (browsers reject it)',
            );

          if (e.NODE_ENV === 'production')
            addIssue(['CORS_ORIGINS'], 'Wildcard not allowed in production; list exact origins');
        }
      }

      if (e.RATE_LIMIT_ENABLED) {
        if (e.RATE_LIMIT_STORE === 'redis' && !e.REDIS_URL) {
          addIssue(['REDIS_URL'], 'Required when RATE_LIMIT_STORE=redis');
        }
      }

      if (e.HTTP_KEEP_ALIVE_TIMEOUT_MS <= e.LB_IDLE_TIMEOUT_MS)
        addIssue(
          ['HTTP_KEEP_ALIVE_TIMEOUT_MS'],
          'must exceed LB_IDLE_TIMEOUT_MS ( LB_IDLE_TIMEOUT_MS < HTTP_KEEP_ALIVE_TIMEOUT_MS )',
        );

      // Node closes an idle keep-alive socket at keepAlive + buffer. A headers timeout that fires
      // at the same moment can answer a reused connection with a 408, so it must come later.
      // 0 disables a timer in Node, so a disabled timer takes no part in these comparisons.
      if (
        e.HTTP_KEEP_ALIVE_TIMEOUT_MS > 0 &&
        e.HTTP_HEADERS_TIMEOUT_MS > 0 &&
        e.HTTP_HEADERS_TIMEOUT_MS <=
          e.HTTP_KEEP_ALIVE_TIMEOUT_MS + HTTP_KEEP_ALIVE_TIMEOUT_BUFFER_MS
      )
        addIssue(
          ['HTTP_HEADERS_TIMEOUT_MS'],
          'must exceed HTTP_KEEP_ALIVE_TIMEOUT_MS + 1000 ( HTTP_KEEP_ALIVE_TIMEOUT_MS + 1000 < HTTP_HEADERS_TIMEOUT_MS )',
        );

      // Node refuses to start when requestTimeout is smaller than headersTimeout.
      if (
        e.HTTP_HEADERS_TIMEOUT_MS > 0 &&
        e.HTTP_REQUEST_TIMEOUT_MS > 0 &&
        e.HTTP_HEADERS_TIMEOUT_MS > e.HTTP_REQUEST_TIMEOUT_MS
      )
        addIssue(
          ['HTTP_REQUEST_TIMEOUT_MS'],
          'must be at least HTTP_HEADERS_TIMEOUT_MS ( HTTP_HEADERS_TIMEOUT_MS <= HTTP_REQUEST_TIMEOUT_MS )',
        );

      // Past the load balancer's idle timeout the client sees the balancer's 504, never our 408.
      if (
        e.LB_IDLE_TIMEOUT_MS > 0 &&
        e.REQUEST_HANDLER_TIMEOUT_MS > 0 &&
        e.REQUEST_HANDLER_TIMEOUT_MS >= e.LB_IDLE_TIMEOUT_MS
      )
        addIssue(
          ['REQUEST_HANDLER_TIMEOUT_MS'],
          'must be less than LB_IDLE_TIMEOUT_MS ( REQUEST_HANDLER_TIMEOUT_MS < LB_IDLE_TIMEOUT_MS )',
        );
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
