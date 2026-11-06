import type { CorsOptions } from 'cors';
import { ENV_CONSTANTS } from '#constants/env/index';

// Built once at startup, not per request.
const rules = ENV_CONSTANTS.CORS_ORIGINS;
const allowAll = rules.includes('*');
const exact = new Set(rules.filter((rule) => !rule.includes('*')));

// "https://*.example.com" -> prefix "https://", suffix ".example.com"
const wildcards = rules
  .filter((rule) => rule.includes('://*.'))
  .map((rule) => {
    const at = rule.indexOf('://*.');
    return { prefix: rule.slice(0, at + 3), suffix: rule.slice(at + 4) };
  });

// Subdomains only: matches https://api.example.com, not https://example.com or https://evilexample.com.
const matchesWildcard = (origin: string) =>
  wildcards.some(
    ({ prefix, suffix }) =>
      origin.startsWith(prefix) &&
      origin.endsWith(suffix) &&
      origin.length > prefix.length + suffix.length,
  );

const isAllowedOrigin = (origin: string) =>
  allowAll || exact.has(origin) || matchesWildcard(origin);

export const corsConfig = Object.freeze({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl, server-to-server, health checks
    cb(null, isAllowedOrigin(origin)); // false = no CORS headers, not an error
  },
  credentials: ENV_CONSTANTS.CORS_CREDENTIALS,
  methods: ENV_CONSTANTS.CORS_METHODS,
  allowedHeaders: ENV_CONSTANTS.CORS_ALLOWED_HEADERS,
  exposedHeaders: ENV_CONSTANTS.CORS_EXPOSED_HEADERS,
  maxAge: ENV_CONSTANTS.CORS_MAX_AGE_S,
  optionsSuccessStatus: 204,
} satisfies CorsOptions);
