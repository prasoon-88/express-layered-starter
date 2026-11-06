# repository/

**Responsibility:** Raw database access — the only layer that talks directly to the database. The "hands."

## What goes here
- CRUD operations: find, create, update, delete
- Queries built from the models
- Nothing but data access — one method = one database operation

## What does NOT go here
- ❌ Business rules or validation (that's `services/`)
- ❌ `req` / `res` (that's `controllers/`)
- ❌ Decisions about *whether* to run a query — just *how* to run it

## Why this layer exists
It isolates the database. If you switch MongoDB → PostgreSQL, **only this folder changes** — services and controllers stay untouched because they never knew how data was stored.

That isolation is why `main` ships without a database at all: this folder and [`models/`](../models/) are the only ones a database integration touches, so each one lives on its own branch (`mongodb`, …) and merges in cleanly.

## Example
```ts
// repository/post.repository.ts
import { PostModel } from '#models/post.model'

export const createPostRepository = () => ({
  create:   (data: NewPost) => PostModel.create(data),
  findById: (id: string)    => PostModel.findById(id),
  findAll:  ()              => PostModel.find(),
  remove:   (id: string)    => PostModel.findByIdAndDelete(id),
})

export type PostRepository = ReturnType<typeof createPostRepository>
```

A repository is a factory, like the layers above it. Anything configured at startup, such as a connection pool, is passed in as an argument, and each call owns its state. That is why the in-memory [`user.repository.ts`](user.repository.ts) gives every test and every app its own store.

## What's here

| File | Holds | A database branch keeps |
|------|-------|-------------------------|
| [`user.repository.ts`](user.repository.ts) | users: `create`, `findByEmail`, `findById`, `updatePassword`, `endSessions` | a unique index on `email`; `create` rejects a duplicate with `EMAIL_TAKEN`; a `session_version` integer column, raised in the same statement as the change (`SET session_version = session_version + 1`); `updatePassword` as a compare-and-set on the old hash (`WHERE id = ? AND password_hash = ?`), returning nothing when it changed |
| [`refreshToken.repository.ts`](refreshToken.repository.ts) | the `RefreshTokenRepository` type and the in-memory store (`AUTH_STORE=memory`): `create`, `findById`, `markUsed`, `revokeFamily` | `markUsed` as one conditional `UPDATE … WHERE used_at IS NULL` checked by row count; revocation on a family row, so a token written after it is revoked too; a TTL index on `expiresAt` |
| [`refreshToken.redis.repository.ts`](refreshToken.redis.repository.ts) | the same interface on Redis (`AUTH_STORE=redis`), shared by replicas | — |

Every store is atomic where it matters: the check and the write happen in one step (a synchronous block in memory, a Lua script in Redis), so two concurrent requests cannot both pass the check. A database version must keep that property with a constraint or a conditional write, not a read followed by a write.

The refresh token stores share one contract test: [`refreshToken.repository.test.ts`](refreshToken.repository.test.ts) runs the same cases against each. A new store is done when it passes them. The Redis cases run against a real `redis-server`, started by [`testing/redisServer.ts`](../testing/redisServer.ts).

A store that depends on something remote turns its failures into `503 SERVICE_UNAVAILABLE`, so a client knows to retry. Without that, the error middleware would report a dropped connection as a `500`, which reads as a bug.

## Pagination
Repositories return raw rows and a count; [`Paginator`](../utils/paginator.util.ts) handles the arithmetic and the response meta:

```js
const findPage = async ({ pageSize, offset }) => ({
    items: await Post.find().skip(offset).limit(pageSize),
    total: await Post.countDocuments(),
})
```

```js
// in the service
import { Paginator } from '#utils/paginator.util'

const listPosts = (query) => Paginator.paginate(query, postRepository.findPage)
```

## The test
> Does this line talk to the database? → it belongs here.
> Does it decide anything or enforce a rule? → that's the service's job.

## Rule of thumb
> A repository is "dumb" on purpose. It runs the query it's told to run — the service decides which query and why.

> For small apps you may skip this layer and let services talk to models directly. Add it when queries grow or you want to isolate the database.
