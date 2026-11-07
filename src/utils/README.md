# utils/

**Responsibility:** Small, generic, reusable helper functions. Pure "little tools" with no dependency on external systems.

## What goes here
- Pure helper functions: formatting, parsing, small calculations
- Generic, reusable logic used across many features
- Things that take input and return output, with no side effects

## What does NOT go here
- ❌ Wrappers around databases/APIs/SDKs (that's `lib/`)
- ❌ Business logic specific to one feature (that's `services/`)
- ❌ `req` / `res` handling (that's `controllers/`)

## Utils vs Lib
| | utils/ | lib/ |
|---|---|---|
| Wraps an external system? | ❌ No | ✅ Yes |
| Has setup/connections? | ❌ Pure functions | ✅ Clients, SDKs |
| Example | `slugify()`, `formatDate()` | `logger/`, `mailer.ts` |

## What's here

### `apiResponse.util.ts`
One response shape for the whole app. Controllers call it instead of `res.json()`:

```js
apiResponse.ok(res, user)
apiResponse.created(res, user, { message: 'User registered' })
apiResponse.noContent(res)
apiResponse.pagination(res, items, { total, page, pageSize })
```

Every body comes out as `{ success, message, data, requestId }` — the request ID read straight from the [async context](../contexts/), so no layer has to pass it along. Calling it after the response is already sent logs a warning instead of throwing. The body is built by [`successEnvelope.ts`](../lib/http/successEnvelope.ts), the same code [`route()`](../lib/http/route.ts) uses, so both produce one shape and the same [ETag](../lib/README.md#http).

### `paginator.util.ts`
Turns untrusted `?page=&pageSize=` into safe integers, rejects nonsense with an `UnprocessableEntityError`, clamps to sane maximums, and computes the `meta` block:

```js
const { items, paging } = await Paginator.paginate(req.query, postRepository.findPage)
```

`parse()` gives you `{ page, pageSize, offset }` if you want to drive the query yourself.

### `sleep.util.ts`
`sleep(ms)` returns a promise that resolves after `ms` milliseconds. [`lib/lifecycle`](../lib/lifecycle/) uses it for the drain delay.

```js
import { sleep } from '#utils/sleep.util'

await sleep(5000)
```

It has **no imports**, which is what lets `lib/` use it without breaking the dependency order (see the leaf rule in [`src/README.md`](../README.md#dependency-rules-what-may-import-what)). It can't be cancelled; for that, use `setTimeout` from `node:timers/promises` with an `AbortSignal`.

## Example
```js
// utils/slug.ts
export const slugify = (text) =>
    text.toLowerCase().trim().replace(/\s+/g, '-')

// utils/date.ts
export const formatDate = (d) =>
    new Date(d).toISOString().split('T')[0]
```

## The test
> Is it a tiny, generic, pure helper with no external system? → it belongs here.

## Rule of thumb
> Utils are stateless tools anyone can grab. If a helper needs a database connection or wraps a third-party package, it's a `lib/`, not a util.
