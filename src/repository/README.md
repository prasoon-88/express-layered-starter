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

## Example
```js
// repository/post.repository.js
import Post from '../models/post.model.js'

export const create   = (data) => Post.create(data)
export const findById = (id)   => Post.findById(id)
export const findAll  = ()     => Post.find()
export const remove   = (id)   => Post.findByIdAndDelete(id)
```

## The test
> Does this line talk to the database? → it belongs here.
> Does it decide anything or enforce a rule? → that's the service's job.

## Rule of thumb
> A repository is "dumb" on purpose. It runs the query it's told to run — the service decides which query and why.

> For small apps you may skip this layer and let services talk to models directly. Add it when queries grow or you want to isolate the database.
