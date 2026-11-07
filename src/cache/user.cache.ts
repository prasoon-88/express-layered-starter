import * as z from 'zod';
import { USER_ROLES } from '#constants/user.constant';
import { defineCacheSpec } from '#lib/cache/index';

/**
 * A user's public profile, as `GET /api/v1/users/me` shows it. Only these fields are cached: never
 * the password hash or the session version, which login, refresh and logout read from the store.
 *
 * A write that changes one of these fields, or deletes the account, records
 * `userProfileCacheSpec.tags.one(userId)` in the cache outbox in the same step as the write:
 * `cacheOutbox.enqueue([userProfileCacheSpec.tags.one(userId)])`.
 */
export const userProfileCacheSpec = defineCacheSpec({
  name: 'userProfile',
  schema: z.object({
    id: z.string(),
    fullName: z.string(),
    email: z.string(),
    role: z.enum(USER_ROLES),
  }),
  ttlS: 300,
  tags: {
    /** One user's profile, whatever key it is cached under. */
    one: (userId: string) => [userId],
  },
});
