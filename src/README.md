# src/ — Architecture Overview

This app uses a **layered architecture**. Each layer has one job and only talks to the layer directly below it. This keeps code easy to find, test, and change.

## The layers

| Layer | Folder | Responsibility | Touches `req`/`res`? | Touches DB? |
|-------|--------|----------------|:---:|:---:|
| Route | [`routes/`](routes/) | Map URL → controller | ❌ | ❌ |
| Controller | [`controllers/`](controllers/) | HTTP: read req, send res | ✅ | ❌ |
| Service | [`services/`](services/) | Business logic & rules | ❌ | ❌ |
| Repository | [`repository/`](repository/) | Raw database access | ❌ | ✅ |
| Model | [`models/`](models/) | Data shape / schema | ❌ | — |

**Cross-cutting (sit beside the layers, not in them):**
[`middlewares/`](middlewares/) · [`errors/`](errors/) · [`contexts/`](contexts/)

**Shared (usable by any layer):**
[`config/`](config/) · [`constants/`](constants/) · [`utils/`](utils/) · [`lib/`](lib/)

**Presentation:** [`views/`](views/) (SSR templates)

## Request flow

```
HTTP request
   ↓
requestId       assign req.id, open the async context
   ↓
httpLogger      start the timer, log on finish
   ↓
routes/         "GET /posts/:id → postController.getPost"
   ↓
controllers/    read req.params.id → call service → apiResponse.ok()
   ↓
services/       "exists? allowed? shape it" — the rules
   ↓
repository/     db query (findById)
   ↓
models/ → Database
```

Each arrow is a one-way handoff. Data flows down as calls, back up as return values.

When nothing matches, or anything throws:

```
notFound        turn an unmatched route into a NotFoundError
   ↓
errorHandler    normalize → log → respond (JSON for /api, rendered view otherwise)
```

## A feature across all layers (example: get one post)

```js
// routes/api/v1/post.routes.js
postRouter.get('/posts/:id', postController.getPost)
```

```js
// controllers/api/post.controller.js — HTTP only
import apiResponse from '#utils/apiResponse.util.js'

export const getPost = async (req, res, next) => {
    try {
        const post = await postService.getPostById(req.params.id)
        apiResponse.ok(res, post)
    } catch (err) {
        next(err)            // hand it to the error middleware, never format it here
    }
}
```

```js
// services/post.service.js — the rules
import { NotFoundError } from '#errors'

export const getPostById = async (id) => {
    const post = await postRepository.findById(id)
    if (!post) throw new NotFoundError('Post not found')   // business rule
    return post
}
```

```js
// repository/post.repository.js — raw DB
export const findById = (id) => Post.findById(id)
```

Note what the controller does *not* do: no status codes picked by hand, no error shaping, no database. It translates HTTP to a service call and back.

## Where does my code go? (decision guide)

| Ask yourself... | Put it in |
|-----------------|-----------|
| Does it touch `req` / `res`? | `controllers/` |
| Is it a rule, decision, or sequence of steps? | `services/` |
| Does it run a database query? | `repository/` |
| Does it define a data shape/schema? | `models/` |
| Does it run on *every* request regardless of route? | `middlewares/` |
| Is it a failure case callers should be able to catch by type? | `errors/` |
| Does it need to be readable anywhere in a request without being passed? | `contexts/` |
| Is it a tunable setting (maybe from `.env`)? | `config/` |
| Is it a fixed value that never changes? | `constants/` |
| Is it a tiny generic helper (pure function)? | `utils/` |
| Does it wrap an external system or SDK? | `lib/` |
| Is it a page template to display? | `views/` |

## Dependency rules (what may import what)

```
constants/   ← depends on nothing
   ↑
config/      ← may use constants
   ↑
errors/      ← may use constants
   ↑
contexts/    ← depends on nothing (node:async_hooks only)
   ↑
lib/         ← may use config + constants + contexts
   ↑
utils/       ← may use config + constants + errors + lib
   ↑
repository/  ← uses models
   ↑
services/    ← uses repository, utils, lib, errors, config
   ↑
controllers/ ← uses services, utils, errors
   ↑
routes/      ← uses controllers + middlewares
```

**Dependencies point downward only.** A lower layer must never import an upper layer (e.g. a service never imports a controller) — that creates circular dependencies and breaks reusability.

Imports across folders use the subpath aliases declared in `package.json`:

```js
import userService from '#services/user.service.js'
import { NotFoundError } from '#errors'
```

Never `../../services/user.service.js`. The alias keeps a file's imports stable when it moves.

## Two things that are not layers

**`errors/`** gives you typed failures. Throw `NotFoundError` in a service and the HTTP status, error code, and response shape are already decided — the service never learns what a 404 is.

**`contexts/`** holds request-scoped state in `AsyncLocalStorage`. It's how the logger tags every line with the current request ID, and how `apiResponse` includes it, without any layer passing `req` downward. Read from it; don't use it to smuggle arguments between layers.

> Each folder has its own `README.md` with detailed rules and examples. Start there when adding code to a layer you're unsure about.
