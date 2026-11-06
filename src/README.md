# src/ — Architecture Overview

This app uses a **layered architecture**. Each layer has one job and only talks to the layer directly below it. This keeps code easy to find, test, and change.

## The layers

| Layer | Folder | Responsibility | Touches `req`/`res`? | Touches DB? |
|-------|--------|----------------|:---:|:---:|
| Module | [`modules/`](modules/) | Wire one feature: providers, needs, routes | ❌ | ❌ |
| Route | [`routes/`](routes/) | Map URL + access rule → middleware and controller | ❌ | ❌ |
| Controller | [`controllers/`](controllers/) | HTTP: read req, send res | ✅ | ❌ |
| Service | [`services/`](services/) | Business logic & rules | ❌ | ❌ |
| Repository | [`repository/`](repository/) | Raw database access | ❌ | ✅ |
| Model | [`models/`](models/) | Data shape / schema | ❌ | — |

**Cross-cutting (sit beside the layers, not in them):**
[`middlewares/`](middlewares/) · [`errors/`](errors/) · [`contexts/`](contexts/)

**Assembly:** [`http/`](http/) builds one router from the route tree in `app.ts` and supplies every route through a typed container. Each layer below exports **factories** (`createUserService({ userRepository })`), never configured singletons, so a module can wire them and a test can pass fakes.

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
routes/         "GET /posts/:id, public → postController.getPost"
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

```ts
// routes/api/v1/post.routes.ts: the URL, who may call it, and what answers
export const postRoutes = ({ postController }: Pick<Registry, 'postController'>) =>
  defineGroup('/post', [
    defineRoute({
      method: 'get',
      path: '/:id',
      access: { strategy: 'public', reason: 'Posts are readable without an account' },
      handlers: [postController.getPost],
    }),
  ])
```

```ts
// controllers/api/post.controller.ts: HTTP only
export const createPostController = ({ postService }: { postService: PostService }) => ({
  getPost: route({ params: z.object({ id: z.uuid() }) }, ({ params }) =>
    postService.getPostById(params.id),
  ),
})
```

```ts
// services/post.service.ts: the rules
export const createPostService = ({ postRepository }: { postRepository: PostRepository }) => ({
  getPostById: async (id: string) => {
    const post = await postRepository.findById(id)
    if (!post) throw new NotFoundError('Post not found')   // business rule
    return post
  },
})
```

```ts
// repository/post.repository.ts: raw DB
export const createPostRepository = () => ({
  findById: (id: string) => Post.findById(id),
})
```

```ts
// modules/post.module.ts: the wiring, and nothing else
export const postModule = defineModule({
  name: 'post',
  providers: {
    postRepository: () => createPostRepository(),
    postService: (get) => createPostService({ postRepository: get('postRepository') }),
    postController: (get) => createPostController({ postService: get('postService') }),
  },
  needs: ['postController'],
  routes: postRoutes,
})
```

Note what the controller does *not* do: no status codes picked by hand, no error shaping, no database. It translates HTTP to a service call and back. And no layer imports the one below as a ready-made singleton: each receives it, which is what lets a test hand a service a fake repository.

## Where does my code go? (decision guide)

| Ask yourself... | Put it in |
|-----------------|-----------|
| Does it touch `req` / `res`? | `controllers/` |
| Does it check the shape of request input (types, formats, required fields)? | `controllers/`, as [`route()`](lib/http/route.lib.ts) schemas |
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
| Does it count, throttle or report request volume? | `rateLimiter/` |
| Does it declare a URL, its access rule and its middleware? | `routes/` |
| Does it wire one feature's repository, service, controller and routes? | `modules/` |
| Does it assemble, check or supply routes for every feature? | `http/` |
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
lib/         ← may use config + constants + contexts (+ leaf utils)
   ↑
utils/       ← may use config + constants + errors + lib
   ↑
repository/  ← uses models
   ↑
services/    ← uses repository, utils, lib, errors, config
   ↑
controllers/ ← uses services (types), utils, errors, lib (route()), schemas (shared rules such as newPasswordSchema)
   ↑
routes/      ← uses http (definitions) + middlewares; receives controllers as arguments
   ↑
modules/     ← composition: may use every layer above except rateLimiter/idempotency
   ↑
app.ts       ← the route tree and the container

http/        ← uses constants only. Imported by routes/, modules/ and app.ts.

rateLimiter/ ← uses constants, config, lib, utils, errors, schemas. Nothing imports it
idempotency/   except the entry files: server.ts builds them, app.ts registers their
               middleware factories in the container (`limit`, `idempotent`), and route
               files receive them as arguments.
```

**Dependencies point downward only.** A lower layer must never import an upper layer (e.g. a service never imports a controller) — that creates circular dependencies and breaks reusability.

**One exception: leaf utils.** A util with **no imports of its own** (such as [`sleep.util.ts`](utils/sleep.util.ts)) sits at the bottom of the graph and may be used by any layer, including `lib/`. It cannot create a cycle because it depends on nothing. A util that imports `lib/` (like `apiResponse.util.ts`) is not a leaf and stays above it.

Imports across folders use the subpath aliases declared in `package.json`:

```js
import { createUserService } from '#services/user.service'
import { NotFoundError } from '#errors'
```

Never `../../services/user.service.ts`. The alias keeps a file's imports stable when it moves.

## Two things that are not layers

**`errors/`** gives you typed failures. Throw `NotFoundError` in a service and the HTTP status, error code, and response shape are already decided — the service never learns what a 404 is.

**`contexts/`** holds request-scoped state in `AsyncLocalStorage`. It's how the logger tags every line with the current request ID, and how `apiResponse` includes it, without any layer passing `req` downward. Read from it; don't use it to smuggle arguments between layers.

> Each folder has its own `README.md` with detailed rules and examples. Start there when adding code to a layer you're unsure about.
