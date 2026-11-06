# controllers/

**Responsibility:** Handle the HTTP layer — read the request, call a service, send the response. The "translator" between the web and your app's logic.

## What goes here
- Reading input: `req.params`, `req.body`, `req.query`, `req.file`
- Declaring what an endpoint accepts: Zod schemas for `body`, `query` and `params`, through [`route()`](../lib/http/route.lib.ts)
- Calling a service to do the actual work
- Sending the response via [`apiResponse`](../utils/apiResponse.util.ts) — `ok`, `created`, `pagination`, `redirect`
- Forwarding errors to the error middleware with `next(err)`

## What does NOT go here
- ❌ Business rules, including checks that need data such as "email already taken" (that's `services/`). Shape checks (types, formats, required fields) *do* belong here, as `route()` schemas.
- ❌ Database access (that's `repository/`)
- ❌ Knowing *how* data is stored or computed
- ❌ Formatting error responses or picking error status codes (that's `middlewares/error.middleware.ts`)

The controller should read like a short script: get input → call service → send output.

## Controllers are factories

A controller receives its services; it never imports a ready-made one. Its [module](../modules/README.md) builds it, and a test can pass a fake service:

```ts
// controllers/api/post.controller.ts
import type { RequestHandler } from 'express'
import type { PostService } from '#services/post.service'
import { apiResponse } from '#utils/apiResponse.util'

export const createPostController = ({ postService }: { postService: PostService }) => {
  const getPost: RequestHandler = async (req, res) => {
    const post = await postService.getPostById(req.params.id)   // service does the work
    apiResponse.ok(res, post)
  }

  return { getPost }
}

export type PostController = ReturnType<typeof createPostController>
```

Note what's missing: no status codes chosen by hand, no error shaping, no `try`/`catch`. Express 5 forwards a rejected promise to the error middleware, the service throws a typed error, and the middleware turns it into the right response.

A controller with no dependencies (like the web page controllers) can stay a plain object; its module registers it as is.

## Validated endpoints with `route()`

For JSON endpoints, wrap the controller in [`route()`](../lib/http/route.lib.ts). It validates the input before your code runs and forwards every error to the error middleware, so there is no `try`/`catch`:

```ts
// controllers/api/post.controller.ts
import { z } from 'zod'
import { route } from '#lib/http/route.lib'
import type { PostService } from '#services/post.service'

export const createPostController = ({ postService }: { postService: PostService }) => ({
  getPost: route(
    { params: z.object({ id: z.uuid() }) },
    ({ params }) => postService.getPostById(params.id),   // params.id is a valid UUID here
  ),

  createPost: route(
    { body: z.object({ title: z.string().min(1), body: z.string() }) },
    ({ body }) => postService.createPost(body),
    { status: 201 },
  ),
})
```

The route file stays the same: `handlers: [postController.getPost]`. Bad input gets a `400` listing every failing field. See [`lib/README.md`](../lib/README.md#http) for what each kind of error becomes, and for how the return value is sent.

## Paginated lists
```ts
const listPosts: RequestHandler = async (req, res) => {
  const { page, pageSize } = req.query
  const { items, paging } = await postService.listPosts({ page, pageSize })
  apiResponse.pagination(res, items, paging)
}
```

## The test
> Does this code touch `req` or `res`? → it belongs here.
> Is it a rule or a decision? → push it down to the service.

## Rule of thumb
> A controller never queries the database and never contains business rules. It only translates HTTP ↔ service calls.
