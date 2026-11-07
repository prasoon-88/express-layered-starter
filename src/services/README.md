# services/

**Responsibility:** The business logic — the rules, decisions, and steps that make your app *do* what it does. The "brain."

## What goes here
- Validation and business rules ("a post must have a title", "only the author can delete")
- Orchestration: calling multiple repositories/libs in the right order
- Transformations (hashing passwords, generating slugs, shaping output)
- Side effects (sending emails, clearing caches) — usually via `lib/`

## What does NOT go here
- ❌ `req` / `res` (that's `controllers/` — services must work even if called from a CLI or cron job)
- ❌ Raw database queries (that's `repository/`)

## Example
```ts
// services/post.service.ts
import type { PostRepository } from '#repository/post.repository'
import { BadRequestError, ConflictError } from '#errors'

type PostServiceDeps = { postRepository: Pick<PostRepository, 'findBySlug' | 'create'> }

export const createPostService = ({ postRepository }: PostServiceDeps) => {
  const createPost = async ({ title, body, authorId }: NewPost) => {
    if (!title) throw new BadRequestError('Title is required')    // rule

    const slug = title.toLowerCase().replace(/\s+/g, '-')         // transformation

    const existing = await postRepository.findBySlug(slug)
    if (existing) throw new ConflictError('A post with this title already exists')

    return postRepository.create({ title, body, authorId, slug }) // hand off to repo
  }

  return { createPost }
}

export type PostService = ReturnType<typeof createPostService>
```

**Receive dependencies, don't import them.** A service is a factory that takes its repositories (and other services) as arguments, typed with `Pick` down to what it calls. Its [module](../modules/README.md) wires the real ones; a test passes a fresh in-memory one. Import the repository's *type* only.

**Throw typed errors, don't return `null`.** A `NotFoundError` from here becomes a 404 with the right code and body without the service knowing what HTTP is — and every caller, including a CLI or a cron job, gets a failure it can catch by type.

## Caching a read

The cache is a dependency like a repository: the service receives `cache` and never imports a configured instance. Describe each kind of data once with a spec, bind it with `cache.entity`, and read through `query`, naming the tags that can make the value wrong. The repository that writes records which tags its write changed, in the same step:

```ts
// cache/post.cache.ts — pure: any module may import it and use its tags
import * as z from 'zod'
import { defineCacheSpec } from '#lib/cache/index'
import { postSchema } from '#models/post.model'

export const postCacheSpec = defineCacheSpec({
  name: 'post',
  schema: postSchema,
  ttlS: 60,
  tags: { one: (id: string) => [id] },
})

// A list is its own kind of data, with its own schema.
export const postListCacheSpec = defineCacheSpec({
  name: 'postList',
  schema: z.array(postSchema),
  ttlS: 60,
  tags: { recent: () => [] },
})
```

```ts
// repository/post.repository.ts — the write and what it invalidates, together
const update = async (id: string, changes: PostChanges) =>
  db.transaction(async (tx) => {
    const post = await tx.posts.update(id, changes)
    await cacheOutbox.enqueue(tx, [postCacheSpec.tags.one(id), postListCacheSpec.tags.recent()])
    return post
  })
```

```ts
// services/post.service.ts — reads only
import type { Cache } from '#lib/cache/index'
import { postCacheSpec, postListCacheSpec } from '#cache/post.cache'
import type { PostChanges } from '#models/post.model'
import type { PostRepository } from '#repository/post.repository'

type PostServiceDeps = {
  postRepository: Pick<PostRepository, 'findById' | 'listRecent' | 'update'>
  cache: Cache
}

export const createPostService = ({ postRepository, cache }: PostServiceDeps) => {
  const posts = cache.entity(postCacheSpec)
  const postLists = cache.entity(postListCacheSpec)

  return {
    getPost: (id: string) =>
      posts.query({ key: ['byId', id], tags: [posts.tags.one(id)] }, () =>
        postRepository.findById(id),
      ),

    listRecent: () =>
      postLists.query({ key: ['recent'], tags: [postLists.tags.recent()] }, () =>
        postRepository.listRecent(),
      ),

    updatePost: (id: string, changes: PostChanges) => postRepository.update(id, changes),
  }
}
```

`app.ts` registers `cache` and `cacheOutbox` in the container, so a module wires them like any other key: `postRepository: (get) => createPostRepository({ cacheOutbox: get('cacheOutbox') })`. On `main` the outbox is in memory and `enqueue(tags)` takes no transaction: an in-memory repository calls it in the same synchronous step as its write. A database store must pass [`cacheOutboxContract`](../testing/cacheOutboxContract.ts), run against the real database. A test builds a real cache with `initCache(parseEnv({ NODE_ENV: 'test' }), logger).cache`: the memory store, no Redis.

- **One spec per shape.** A post and a list of posts are two specs; each has its own schema, so a hit is checked against what it really is.
- **Tags are what you invalidate together.** A list that shows a post's fields carries a tag the post's write invalidates too (`recent` above). However many tags a query names, their versions are read in one round trip.
- **Tag the reader with what it reads.** A profile that shows a post count carries `postListCacheSpec.tags.recent()` among its tags, so the post writes stay unaware of it.
- **Record invalidations in the outbox, with the write.** `cache.invalidate` after the commit works too, but a crash between the two leaves the old value until its TTL, and it rejects, failing the request, when the store did not take it. The outbox has neither problem: the relay retries until the cache took it.
- **A read never fails because of the cache:** it falls through to the loader.
- **Never cache what a security decision reads** (a session version, a permission, a balance): read it from its store every time.

The rules are in the root [README](../../README.md#server-side-cache).

## Logging from a service
```js
import { getLogger } from '#lib/logger/index'

const logger = getLogger('post.service')

logger.info({ postId: post.id }, 'post published')
```

The current request ID is attached automatically — see [`contexts/`](../contexts/). You never need `req` here.

## The test
> Is this a rule, a decision, or a sequence of steps? → it belongs here.
> If you removed Express entirely, this code should still make sense and run.

## Rule of thumb
> The service is where "what should happen and why" lives. It never sees HTTP and never writes raw queries — it decides and delegates.
