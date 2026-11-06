import { HTTP_HEADERS } from '#constants/http/httpHeaders.constant';
import { concatenateStrings } from '#utils/concatenateStrings.util';
import type { Decision } from './types.ts';
import { MS_PER_SECOND } from '#constants/time.constant';

// IETF draft-ietf-httpapi-ratelimit-headers-07: `RateLimit-Policy: 100;w=60` and
// `RateLimit: limit=100, remaining=42, reset=60`, where reset is delta-seconds.
export const rateLimitHeaders = ({
  limit,
  remaining,
  windowS,
  resetMs,
}: Pick<Decision, 'limit' | 'remaining' | 'windowS' | 'resetMs'>) => ({
  [HTTP_HEADERS.RATE_LIMIT_POLICY]: concatenateStrings([limit, `w=${windowS}`], ';'),
  [HTTP_HEADERS.RATE_LIMIT]: concatenateStrings(
    [`limit=${limit}`, `remaining=${remaining}`, `reset=${Math.ceil(resetMs / MS_PER_SECOND)}`],
    ', ',
  ),
});
