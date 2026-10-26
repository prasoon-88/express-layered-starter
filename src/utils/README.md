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
| Example | `slugify()`, `formatDate()` | `db.js`, `mailer.js` |

## Example
```js
// utils/slug.js
export const slugify = (text) =>
    text.toLowerCase().trim().replace(/\s+/g, '-')

// utils/date.js
export const formatDate = (d) =>
    new Date(d).toISOString().split('T')[0]
```

## The test
> Is it a tiny, generic, pure helper with no external system? → it belongs here.

## Rule of thumb
> Utils are stateless tools anyone can grab. If a helper needs a database connection or wraps a third-party package, it's a `lib/`, not a util.
