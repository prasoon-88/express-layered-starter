# routes/

**Responsibility:** Map URLs (HTTP method + path) to controller functions. The "table of contents" of your API.

## What goes here
- `express.Router()` instances
- Route definitions: `router.get('/posts/:id', postController.getPost)`
- Attaching route-level middleware (auth, validation): `router.post('/posts', requireAuth, postController.createPost)`

## What does NOT go here
- ❌ Business logic (that's `services/`)
- ❌ Database queries (that's `repository/`)
- ❌ Request/response handling logic (that's `controllers/`)

A route should be **one line**: "this URL → that controller."

## How routing is organized

Routers nest, and each level adds one prefix:

```
routes/index.js            mounts  /      → web,  /api → api
├── web/index.js           server-rendered pages (EJS)
└── api/index.js           mounts express.json(), then /v1
    └── v1/index.js        mounts /user, /post, …
        └── user.routes.js the actual endpoints
```

So `userRouter.post('/register', …)` is served at **`/api/v1/user/register`**. No file repeats a prefix its parent already added — that's what keeps versioning to a one-line change in `api/index.js`.

JSON body parsing is mounted on the API router only, since the web routes render forms rather than consume JSON.

## Example
```js
// routes/api/v1/post.routes.js
import { Router } from 'express'
import postController from '#controllers/api/post.controller.js'

const postRouter = Router()

postRouter.get('/', postController.listPosts)       // GET  /api/v1/post
postRouter.get('/:id', postController.getPost)      // GET  /api/v1/post/:id
postRouter.post('/', postController.createPost)     // POST /api/v1/post

export default postRouter
```

Then one line in `v1/index.js`:

```js
API_V1_ROUTER.use('/post', postRouter)
```

## Rule of thumb
> If a route file has an `if` statement or a `db.` call, logic has leaked in — move it down to the controller or service.
