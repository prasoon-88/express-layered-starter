import HTTP_HEADERS from '#constants/http/httpHeaders.constant';
import type { Decision } from './types.ts';

// IETF draft-ietf-httpapi-ratelimit-headers-07: `RateLimit-Policy: 100;w=60` and
// `RateLimit: limit=100, remaining=42, reset=60`, where reset is delta-seconds.
export const rateLimitHeaders = ({
  limit,
  remaining,
  windowS,
  resetMs,
}: Pick<Decision, 'limit' | 'remaining' | 'windowS' | 'resetMs'>) => ({
  [HTTP_HEADERS.RATE_LIMIT_POLICY]: `${limit};w=${windowS}`,
  [HTTP_HEADERS.RATE_LIMIT]: `limit=${limit}, remaining=${remaining}, reset=${Math.ceil(resetMs / 1000)}`,
});
