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
```js
// services/post.service.ts
import postRepository from '#repository/post.repository'
import { BadRequestError, ConflictError } from '#errors'

const createPost = async ({ title, body, authorId }) => {
    if (!title) throw new BadRequestError('Title is required')    // rule

    const slug = title.toLowerCase().replace(/\s+/g, '-')         // transformation

    const existing = await postRepository.findBySlug(slug)
    if (existing) throw new ConflictError('A post with this title already exists')

    return postRepository.create({ title, body, authorId, slug }) // hand off to repo
}

export default { createPost }
```

**Throw typed errors, don't return `null`.** A `NotFoundError` from here becomes a 404 with the right code and body without the service knowing what HTTP is — and every caller, including a CLI or a cron job, gets a failure it can catch by type.

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
