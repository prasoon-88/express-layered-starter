# controllers/

**Responsibility:** Handle the HTTP layer — read the request, call a service, send the response. The "translator" between the web and your app's logic.

## What goes here
- Reading input: `req.params`, `req.body`, `req.query`, `req.file`
- Calling a service to do the actual work
- Sending the response via [`apiResponse`](../utils/apiResponse.util.ts) — `ok`, `created`, `pagination`, `redirect`
- Forwarding errors to the error middleware with `next(err)`

## What does NOT go here
- ❌ Business rules / validation logic (that's `services/`)
- ❌ Database access (that's `repository/`)
- ❌ Knowing *how* data is stored or computed
- ❌ Formatting error responses or picking error status codes (that's `middlewares/error.middleware.ts`)

The controller should read like a short script: get input → call service → send output.

## Example
```js
// controllers/api/post.controller.ts
import postService from '#services/post.service'
import { apiResponse } from '#utils/apiResponse.util'

export const getPost = async (req, res, next) => {
    try {
        const post = await postService.getPostById(req.params.id)  // service does the work
        apiResponse.ok(res, post)
    } catch (err) {
        next(err)                                                  // handler decides the status
    }
}
```

Note what's missing: no status codes chosen by hand, no error shaping. The service throws a typed error, the middleware turns it into the right response, and the controller stays three lines long.

## Paginated lists
```js
export const listPosts = async (req, res, next) => {
    try {
        const { page, pageSize } = req.query
        const { items, paging } = await postService.listPosts({ page, pageSize })
        apiResponse.pagination(res, items, paging)
    } catch (err) {
        next(err)
    }
}
```

## The test
> Does this code touch `req` or `res`? → it belongs here.
> Is it a rule or a decision? → push it down to the service.

## Rule of thumb
> A controller never queries the database and never contains business rules. It only translates HTTP ↔ service calls.
