# constants/

**Responsibility:** Hold fixed values that never change and are identical in every environment. The app's "vocabulary."

## What goes here
- HTTP status codes: `HTTP_STATUS.OK = 200`
- Fixed roles/enums: `USER_ROLES.ADMIN = 'admin'`
- Reusable messages: `MESSAGES.POST_NOT_FOUND`
- Magic numbers given a name: `SIZE.MB = 1024 * 1024`

## What does NOT go here
- ❌ Values that differ per environment or that you might tune (that's `config/`)
- ❌ Logic or functions

## The one exception: `env/`

[`env/`](env/) is the only place allowed to read `process.env`. [`env/schema.ts`](env/schema.ts) validates every variable with Zod, applies defaults and coerces types — so `PORT` is a number and `LOG_IGNORE_PATHS` is an array by the time anyone else sees it. [`env/index.ts`](env/index.ts) parses `process.env` once at startup and exports the frozen result as `ENV_CONSTANTS`. An invalid environment stops the app before it serves a request.

It lives here rather than in `config/` because the *list of variables the app understands* is itself a fixed fact. Everything downstream, `config/` included, imports `ENV_CONSTANTS` and never touches `process.env` again.

## Config vs Constants — the test
> "Would this value be different on my laptop vs production, or might I tune it?"
> - Yes → `config/`
> - No, it's fixed forever → `constants/`

```
MAX_FILE_SIZE   → might change   → config
HTTP_STATUS.OK  → always 200     → constants
USER_ROLES      → fixed set      → constants
```

## Dependency direction
`constants/` depends on **nothing**. `config/` may import constants — never the reverse.

## Example
```ts
// constants/http/httpStatus.constant.ts: a lookup table is a frozen object
export const HTTP_STATUS = Object.freeze({
    OK: 200,
    CREATED: 201,
    NOT_FOUND: 404,
})

// constants/user.constant.ts: a fixed set is an `as const` list, with its type derived from it
export const USER_ROLES = ['NORMAL', 'ADMIN'] as const
export type UserRole = (typeof USER_ROLES)[number]

// constants/rateLimit.constant.ts: a feature's values share its prefix, durations name their unit
export const DEFAULT_RATE_LIMIT_WINDOW_S = 60
export const DEFAULT_RATE_LIMIT_STORE: RateLimitStoreName = 'memory'
```

The conventions, as in the example:

- One file per topic, named `<topic>.constant.ts`, with named exports only.
- A lookup table is `Object.freeze({...})`. A fixed set is `[...] as const`, and its type is derived from it, never written out a second time.
- A feature's values start with its name (`RATE_LIMIT_`, `IDEMPOTENCY_`), and a default is `DEFAULT_<NAME>`, matching the env variable it is the default of.
- A duration ends in its unit, `_S` or `_MS`. Convert with [`time.constant.ts`](time.constant.ts) (`MS_PER_SECOND`, `SECONDS_PER_DAY`), and round at the call site.
- A type annotation only where inference would be wrong, such as a default narrowed to its union.

## Rule of thumb
> Constants are facts that are true by definition. Name them in `UPPERCASE`, keep them pure: they import only other constants, never env (outside `env/`) and never logic.
