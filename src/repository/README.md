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
import Post from '#models/post.model'

export const createPostRepository = () => ({
  create:   (data: NewPost) => Post.create(data),
  findById: (id: string)    => Post.findById(id),
  findAll:  ()              => Post.find(),
  remove:   (id: string)    => Post.findByIdAndDelete(id),
})

export type PostRepository = ReturnType<typeof createPostRepository>
```

A repository is a factory, like the layers above it. Anything configured at startup, such as a connection pool, is passed in as an argument, and each call owns its state. That is why the in-memory [`user.repository.ts`](user.repository.ts) gives every test and every app its own store.

## What's here

| File | Holds | A database branch keeps |
|------|-------|-------------------------|
| [`user.repository.ts`](user.repository.ts) | users: `create`, `findByEmail`, `findById` | a unique index on `email`; `create` rejects a duplicate with `EMAIL_TAKEN` |
| [`refreshToken.repository.ts`](refreshToken.repository.ts) | refresh tokens: `create`, `findById`, `markUsed`, `revokeFamily` | `markUsed` as one conditional `UPDATE … WHERE used_at IS NULL` checked by row count; revocation on a family row, so a token written after it is revoked too; a TTL index on `expiresAt` |

Both are atomic where it matters: the check and the write happen in one synchronous step, so two concurrent requests cannot both pass the check. A database version must keep that property with a constraint or a conditional write, not a read followed by a write.

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
