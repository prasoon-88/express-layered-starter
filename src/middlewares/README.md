# middlewares/

**Responsibility:** Cross-cutting request concerns — work that applies to *many* routes regardless of what they do. Middleware sits beside the layers, not inside them.

## What goes here

- Request-wide setup (request IDs, async context)
- Observability (access logging)
- Security and parsing (auth checks, rate limiting, body parsing, headers)
- The terminal handlers (404, error handler)

## What does NOT go here

- ❌ Business logic — a middleware that knows about "posts" or "orders" is a service in disguise
- ❌ Database queries — call a service, which calls the repository
- ❌ Anything used by a single route (that's just the controller)

## The pipeline

Order matters more here than anywhere else in the codebase. From [`app.js`](../app.js):

```
requestId      →  assign req.id, open the async context
httpLogger     →  start timer, log once the response finishes
   routes
notFound       →  no route matched → NotFoundError
errorHandler   →  normalize → log → respond
```

`requestId` must run first — everything downstream, including every log line, depends on the context it opens. The two terminal handlers must run last, and `errorHandler` must be last of all. Express 5 identifies it by its **four** parameters (`err, req, res, next`); drop the unused `next` and it silently stops being an error handler.

## The factory pattern

Middleware that needs options is written as a factory — a function returning the handler — so it can be configured at mount time and tested without an app:

```js
const requestIdMiddleware = ({ header = HTTP_HEADERS.X_REQUEST_ID, trustIncoming = true } = {}) =>
    (req, res, next) => {
        // ...
    }
```

Mounted with `app.use(requestIdMiddleware())` — note the call. Middleware with nothing to configure (`notFound`, `errorHandler`) is exported as a plain handler and mounted without parentheses.

## What's here

| File | Does |
|------|------|
| `requestId.middleware.js` | Reuses a valid inbound `X-Request-Id` or generates one; sets `req.id`, echoes the header, opens the async context |
| `httpLogger.middleware.js` | One access log line per request with method, path, status, duration, IP; warns on slow or aborted requests; skips configured paths |
| `notFound.middleware.js` | Converts an unmatched route into a `NotFoundError` |
| `error.middleware.js` | Normalizes anything thrown, logs it once, responds as JSON or a rendered view |

## Writing one

```js
const requireAuth = () => (req, res, next) => {
    const token = req.get('authorization')?.replace('Bearer ', '')
    if (!token) return next(new UnauthorizedError('Missing token'))

    try {
        req.user = verifyToken(token)
        next()
    } catch (err) {
        next(err)        // let the converter turn JWT errors into ours
    }
}
```

Three rules: always call `next()` or send a response (never neither, or the request hangs); pass errors to `next(err)` rather than responding yourself; never swallow an error silently.

## Rule of thumb

> If you'd want it on routes you haven't written yet, it's middleware. If it only makes sense for one feature, it belongs in that feature's controller or service.
