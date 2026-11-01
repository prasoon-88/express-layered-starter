# routes/

**Responsibility:** Map URLs (HTTP method + path) to controller functions. The "table of contents" of your API.

## What goes here
- `express.Router()` instances
- Route definitions: `router.get('/posts/:id', postController.getPost)`
- Attaching route-level middleware (auth): `router.post('/posts', requireAuth, postController.createPost)`

## What does NOT go here
- ❌ Business logic (that's `services/`)
- ❌ Database queries (that's `repository/`)
- ❌ Request/response handling logic (that's `controllers/`)

A route should be **one line**: "this URL → that controller."

Request validation isn't attached here either. The controller declares its own schemas with [`route()`](../lib/http/route.lib.ts) (see [`controllers/`](../controllers/README.md#validated-endpoints-with-route)), and `routes/` may not import `lib/`.

## How routing is organized

Routers nest, and each level adds one prefix:

```
routes/index.ts            mounts  /      → web,  /api → api
├── web/index.ts           server-rendered pages (EJS)
└── api/index.ts           mounts express.json(), then /v1
    └── v1/index.ts        mounts /user, /post, …
        └── user.routes.ts the actual endpoints
```

So `userRouter.post('/register', …)` is served at **`/api/v1/user/register`**. No file repeats a prefix its parent already added — that's what keeps versioning to a one-line change in `api/index.ts`.

JSON body parsing is mounted on the API router only, since the web routes render forms rather than consume JSON.

## Example
```js
// routes/api/v1/post.routes.ts
import { Router } from 'express'
import postController from '#controllers/api/post.controller'

const postRouter = Router()

postRouter.get('/', postController.listPosts)       // GET  /api/v1/post
postRouter.get('/:id', postController.getPost)      // GET  /api/v1/post/:id
postRouter.post('/', postController.createPost)     // POST /api/v1/post

export default postRouter
```

Then one line in `v1/index.ts`:

```js
API_V1_ROUTER.use('/post', postRouter)
```

## Rule of thumb
> If a route file has an `if` statement or a `db.` call, logic has leaked in — move it down to the controller or service.
