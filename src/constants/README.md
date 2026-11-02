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
```js
// constants/http.ts
export const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    SERVER_ERROR: 500,
}

// constants/roles.ts
export const USER_ROLES = { ADMIN: 'admin', USER: 'user' }
```

## Rule of thumb
> Constants are facts that are true by definition. Name them in `UPPERCASE`, keep them pure (no imports, no env, no logic).
