# errors/

**Responsibility:** Define failure as a type. Every way the app can fail is a class here, carrying the HTTP status, a machine-readable code, and optional details — so the layer that *detects* a problem never has to decide how it's reported.

## What goes here

- Error classes extending `AppError` (one per HTTP failure category)
- Converters in [`converter/`](converter/) that translate *foreign* errors (Zod, JWT, database drivers, Express) into our classes
- The barrel export in `index.ts`

## What does NOT go here

- ❌ Response formatting or `res.status(...)` — that's [`middlewares/error.middleware.ts`](../middlewares/error.middleware.ts)
- ❌ Logging — the handler logs once, centrally
- ❌ Business rules about *when* to fail — that's `services/`

## The hierarchy

Every class extends `AppError`, which fixes the shape:

| Property | Meaning |
|----------|---------|
| `message` | Human-readable, safe to show a client |
| `statusCode` | HTTP status to respond with |
| `code` | Stable machine-readable string clients can branch on |
| `details` | Optional structured extras (e.g. per-field validation errors) |
| `isOperational` | `true` — an expected failure, not a bug |

`isOperational` is the important one. Anything that reaches the handler *without* it is treated as an unexpected crash: logged with its original stack, reported as a generic 500, and its message never sent to the client. The one exception is local debugging: with `NODE_ENV=development` set explicitly, every error response also carries the original `stack`. Any other value, including an unset `NODE_ENV`, leaves it out.

Available: `BadRequestError` · `UnauthorizedError` · `ForbiddenError` · `NotFoundError` · `ConflictError` · `UnprocessableEntityError` · `TooManyRequestsError` · `RequestTimeoutError` · `InternalServerError` · `ServiceUnavailableError`

## Example

```js
// in a service — just throw, don't format
import { NotFoundError, ConflictError } from '#errors'

if (!user) throw new NotFoundError('User not found')

if (existing) {
    throw new ConflictError('Email already registered', ERROR_CODES.DUPLICATE_EMAIL)
}
```

With field details, in the same `{ path, message }` shape that request validation produces, so clients parse one format:

```js
import { UnprocessableEntityError } from '#errors'

throw new UnprocessableEntityError('Validation failed', ERROR_CODES.VALIDATION_FAILED, [
    { path: 'email', message: 'must be a valid address' },
])
```

## Converters

A converter takes an unknown error and returns one of our classes, or `null` if it doesn't recognize it. That's how a driver-specific error becomes a clean 409 without the service ever importing the driver:

```js
// converter/jwt.converter.ts
const jwtConverter = (err) => {
    if (err.name === 'TokenExpiredError') return new UnauthorizedError('Token expired')
    return null
}
```

Converters run in order until one returns something. Add a new one to the array in [`converter/index.ts`](converter/index.ts).

On `main` they run in this order:

| Converter | Recognizes | Becomes |
|-----------|------------|---------|
| [`zod.converter.ts`](converter/zod.converter.ts) | a `ZodError` from request validation in [`route()`](../lib/http/route.lib.ts) | `400 BAD_REQUEST`, `details: [{ path, message }]` |
| [`http.converter.ts`](converter/http.converter.ts) | body-parser errors (bad JSON, body too large, bad charset), and other `http-errors` with `expose: true` | `400` / `413` / `415`, or the error's own 4xx status |
| [`jwt.converter.ts`](converter/jwt.converter.ts) | `TokenExpiredError`, `NotBeforeError`, `JsonWebTokenError` | `401` |

The Zod converter only ever sees *input* errors. `route()` wraps a `ZodError` thrown inside a handler in a plain `Error`, so that one is reported as a `500` (it means your own data failed a check), not as a `400` blaming the client.

> The database-specific converter lives on the branch for that database, not on `main`.

## Adding a new error type

1. Create `yourCase.error.ts` extending `AppError` with a fixed status and default code.
2. Add its code to [`constants/errorCodes.constant.ts`](../constants/errorCodes.constant.ts).
3. Export it from `index.ts`.

## Rule of thumb

> If a caller might reasonably want to catch *this specific failure* and react differently, it deserves a class. If it's just "something broke," let it become an `InternalServerError`.
