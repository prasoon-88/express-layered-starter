# `cache/`

One cache spec per kind of data: what is cached, for how long, and what it can be invalidated by. The engine lives in [`lib/cache/`](../lib/cache/); its rules are in the root [README](../../README.md#server-side-cache).

**What belongs here:** `<entity>.cache.ts` files, each exporting `defineCacheSpec(…)` values named `<name>CacheSpec`. Nothing else: no store, no Redis, no repository, so any module can import a spec and use its tags without creating a cycle or opening a connection.

```ts
// cache/user.cache.ts
import * as z from 'zod'
import { defineCacheSpec } from '#lib/cache/index'
import { userPublicSchema } from '#models/user.model'

export const userCacheSpec = defineCacheSpec({
  name: 'user',
  schema: userPublicSchema,          // what is cached: leave secrets (passwordHash) out of it
  ttlS: 300,
  tags: { one: (id: string) => [id] },
})

export const userListCacheSpec = defineCacheSpec({
  name: 'userList',
  schema: z.array(userPublicSchema), // a list is its own kind of data
  ttlS: 60,
  tags: { byTenant: (tenantId: string) => [tenantId] },
})
```

```ts
// where the data is read and written
const users = cache.entity(userCacheSpec)
const findById = (id: string) =>
  users.query({ key: ['byId', id], tags: [users.tags.one(id)] }, () => db.user.find(id))
// in the repository, with the write that changed the user
cacheOutbox.enqueue([userCacheSpec.tags.one(id), userListCacheSpec.tags.byTenant(tenantId)])
```

- **The schema decides what is stored.** Fields it does not list never reach the store, so cache a projection, not a row with secrets. It must describe plain JSON: dates as ISO strings.
- **One spec per shape.** An item and a list of items are two specs.
- **Tags are the spec's functions, never strings.** They are typed: an entity's `invalidate` takes its own tags only, and `cache.invalidate` crosses entities on purpose.
- **Name every tag that can make a value wrong.** Their versions are part of the key and read in one round trip, however many there are.
- **Names are unique.** A spec's name keys its entries and tags; [`conventions.test.ts`](../conventions.test.ts) fails when two specs share one.
- **No spec for security state.** Session versions, permissions and balances are read from their store every time.

On `main`, [`user.cache.ts`](user.cache.ts) holds `userProfileCacheSpec`: the public profile that `GET /api/v1/users/me` returns, read through the cache by [`user.service.ts`](../services/user.service.ts). Its `one(userId)` tag is the handle a write that changes a profile records in the outbox: `cacheOutbox.enqueue([userProfileCacheSpec.tags.one(userId)])`. The password hash and session version stay out of it, and the auth service reads them from the store every time.
