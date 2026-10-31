# errors/

**Responsibility:** Define failure as a type. Every way the app can fail is a class here, carrying the HTTP status, a machine-readable code, and optional details — so the layer that *detects* a problem never has to decide how it's reported.

## What goes here

- Error classes extending `AppError` (one per HTTP failure category)
- Converters in [`converter/`](converter/) that translate *foreign* errors (JWT, database drivers, Express) into our classes
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

`isOperational` is the important one. Anything that reaches the handler *without* it is treated as an unexpected crash: logged with its original stack, reported as a generic 500, and never leaked to the client.

Available: `BadRequestError` · `UnauthorizedError` · `ForbiddenError` · `NotFoundError` · `ConflictError` · `UnprocessableEntityError` · `TooManyRequestsError` · `InternalServerError` · `ServiceUnavailableError`

## Example

```js
// in a service — just throw, don't format
import { NotFoundError, ConflictError } from '#errors'

if (!user) throw new NotFoundError('User not found')

if (existing) {
    throw new ConflictError('Email already registered', ERROR_CODES.DUPLICATE_EMAIL)
}
```

With field details:

```js
import { UnprocessableEntityError } from '#errors'

throw new UnprocessableEntityError('Validation failed', ERROR_CODES.VALIDATION_FAILED, [
    { field: 'email', message: 'must be a valid address' },
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

> The database-specific converter lives on the branch for that database, not on `main`.

## Adding a new error type

1. Create `yourCase.error.ts` extending `AppError` with a fixed status and default code.
2. Add its code to [`constants/errorCodes.constant.ts`](../constants/errorCodes.constant.ts).
3. Export it from `index.ts`.

## Rule of thumb

> If a caller might reasonably want to catch *this specific failure* and react differently, it deserves a class. If it's just "something broke," let it become an `InternalServerError`.
