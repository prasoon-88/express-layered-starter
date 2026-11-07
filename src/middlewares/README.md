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

Order matters more here than anywhere else in the codebase. From [`app.ts`](../app.ts):

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
const createRequestIdMiddleware = ({ header = HTTP_HEADERS.X_REQUEST_ID, trustIncoming = true } = {}) =>
    (req, res, next) => {
        // ...
    }
```

Mounted with `app.use(createRequestIdMiddleware())` — note the call. Middleware with nothing to configure (`notFoundMiddleware`, `errorHandlerMiddleware`) is exported as a plain handler and mounted without parentheses.

The name says which one you have: a factory is `create<Name>Middleware`, a ready handler is `<name>Middleware`, where `<name>` is the file's (`requestId.middleware.ts` exports `createRequestIdMiddleware`).

## What's here

| File | Does |
|------|------|
| `requestId.middleware.ts` | Reuses a valid inbound `X-Request-Id` or generates one; sets `req.id`, echoes the header, opens the async context |
| `httpLogger.middleware.ts` | One access log line per request with method, path, status, duration, IP; warns on slow or aborted requests; skips configured paths |
| `authenticate.middleware.ts` | `createAuthenticateMiddleware({ accessTokens })`: verifies `Authorization: Bearer <jwt>`, validates the claims with `authUserSchema`, sets `req.user`. A `401` carries `WWW-Authenticate`. The auth module provides it; the `authenticated` and `roles` strategies run it |
| `authorize.middleware.ts` | `createAuthorizeMiddleware(roles)`, registered as the container's `authorize`: `403` unless `req.user.role` is listed, `401` if nobody was authenticated. The `roles` access strategy puts it after `authenticate` |
| `notFound.middleware.ts` | Converts an unmatched route into a `NotFoundError` |
| `errorHandler.middleware.ts` | Normalizes anything thrown, logs it once, responds as JSON or a rendered view, always with `Cache-Control: no-store` |

A route's `Cache-Control` is not set by middleware here: it is the route's `cache` rule, which `mount` applies (see [`http/README.md`](../http/README.md#cache-rules)).

## Writing one

```ts
// middlewares/requireHeader.middleware.ts
export const createRequireHeaderMiddleware = (name: string): RequestHandler => (req, _res, next) => {
    if (!req.get(name)) return next(new BadRequestError(`Missing ${name} header`))
    next()
}
```

[`authenticate.middleware.ts`](authenticate.middleware.ts) is a complete real one: it takes its dependency as an argument, refuses with typed errors, and hands errors it did not create to `next(err)` so a converter turns them into ours.

Three rules: always call `next()` or send a response (never neither, or the request hangs); pass errors to `next(err)` rather than responding yourself; never swallow an error silently.

## Rule of thumb

> If you'd want it on routes you haven't written yet, it's middleware. If it only makes sense for one feature, it belongs in that feature's controller or service.
