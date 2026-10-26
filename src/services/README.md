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
// services/post.service.js
import * as postRepository from '../repository/post.repository.js'

export const createPost = async ({ title, body, authorId }) => {
    if (!title) throw new Error('Title is required')          // rule

    const slug = title.toLowerCase().replace(/\s+/g, '-')     // transformation
    const post = await postRepository.create({                // hand off to repo
        title, body, authorId, slug,
    })
    return post
}
```

## The test
> Is this a rule, a decision, or a sequence of steps? → it belongs here.
> If you removed Express entirely, this code should still make sense and run.

## Rule of thumb
> The service is where "what should happen and why" lives. It never sees HTTP and never writes raw queries — it decides and delegates.
