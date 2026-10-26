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

## Example
```js
// routes/post.routes.js
import express from 'express'
import * as postController from '../controllers/post.controller.js'

const postRouter = express.Router()

postRouter.get('/posts', postController.listPosts)
postRouter.get('/posts/:id', postController.getPost)
postRouter.post('/posts', postController.createPost)

export default postRouter
```

## Rule of thumb
> If a route file has an `if` statement or a `db.` call, logic has leaked in — move it down to the controller or service.
