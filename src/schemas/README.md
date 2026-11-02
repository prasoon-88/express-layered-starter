# schemas/

**Responsibility:** Shared [Zod](https://zod.dev/) schemas, the reusable building blocks for describing data at the app's boundaries. A schema lives here only when **more than one file** needs it.

## What goes here
- Primitive building blocks: ids, email, password, pagination query (`common.schema.ts`)
- Resource shapes reused by several endpoints, such as the public user returned by every user route (`user.schema.ts`)
- Types derived from them with `z.infer`, exported next to the schema

## What does NOT go here
- ❌ The env schema. It lives in [`constants/env/schema.ts`](../constants/env/), next to its only consumer (see [below](#why-the-env-schema-is-not-here))
- ❌ Schemas used by a single endpoint. Keep those at the top of their controller (see [the rule of two](#the-rule-of-two))
- ❌ Checks that need data, such as "email already taken". That's a business rule for `services/`
- ❌ Database models (that's `models/`)
- ❌ Imports from any layer except `constants/`

## Where does this schema go?

| The schema is... | Put it in |
|------------------|-----------|
| For environment variables | `constants/env/schema.ts` |
| Used by one endpoint only (a body, query or params) | The top of that controller file |
| Used by two or more files | `schemas/<name>.schema.ts` |
| Checking data from the database or a third-party API | The `repository/` or `lib/` file that receives it, unless it's shared |

Every boundary is validated once, where the data enters: env at boot, requests at the controller, external data at the repository or client. Code past the boundary trusts the types and does not re-check.

## The rule of two

A schema starts next to the code that uses it. Move it here the moment a **second** file needs it, and not before.

```
controllers/api/v1/user.controller.ts   createUserBody     ← used once, stays here
                    │
      a second file needs the email rule
                    ▼
schemas/common.schema.ts                emailSchema        ← now shared
```

Moving schemas here "in case they're reused" is how a shared folder turns into a dumping ground that nobody dares to change.

## Why the env schema is not here

**It would create an import cycle.** Shared schemas import constants (`REGEX`, `USER_ROLES`). If `constants/env` imported its schema from here, each layer would depend on the other:

```
constants/env  ──imports──▶  schemas/env.schema
schemas/common ──imports──▶  constants/regex       ✗ cycle
```

That breaks the "`constants/` depends on nothing" rule, and circular ESM imports can crash at boot with `Cannot access 'X' before initialization`.

**It has one consumer.** Nothing but `constants/env/index.ts` ever reads it, so the rule of two keeps it there.

**It follows different rules.** Both use Zod, but little else is the same:

| | Env schema | Request schema |
|---|---|---|
| Runs | Once, at boot | On every request |
| On failure | Prints every issue and exits | Responds `400` with every issue |
| Input | Always strings | JSON types, plus strings in query/params |
| Unknown keys | Stripped (`z.object`): `process.env` has hundreds | Rejected (`z.strictObject`) |
| `z.coerce.number()` | Unsafe: `''` becomes `0`, a valid delay | Safe: `.min(1)` rejects the `0` |

## Conventions

| Thing | Convention | Example |
|-------|------------|---------|
| File | `<name>.schema.ts` | `common.schema.ts`, `user.schema.ts` |
| Shared schema | camelCase + `Schema` | `emailSchema`, `publicUserSchema` |
| Endpoint schema (in a controller) | action + location | `createUserBody`, `listUsersQuery`, `userIdParams` |
| Type | PascalCase, from `z.infer` | `type Email = z.infer<typeof emailSchema>` |

- **Derive types, never hand-write them.** `z.infer` keeps the type and the runtime check from drifting apart.
- **Clean first, then validate.** `z.email().trim()` rejects `"  a@b.com "` because the email check runs before the trim. Write `z.string().trim().toLowerCase().pipe(z.email())`.
- **Request bodies use `z.strictObject`.** An unexpected `"admin": true` should be a `400`, not silently dropped.
- **Response schemas use `z.object`.** In [`route()`](../lib/http/route.lib.ts) the response schema is an allowlist: fields it doesn't name (`passwordHash`) are stripped before the response leaves.
- **Limits come from `constants/`.** A pagination schema reads its maximums from a constant, not a literal, so the schema and [`paginator.util.ts`](../utils/paginator.util.ts) cannot disagree.

## Example

```ts
// schemas/common.schema.ts
import { z } from 'zod'
import REGEX from '#constants/regex.constant'

export const idSchema = z.string().regex(REGEX.SAFE_ID, 'Invalid id')

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

export type Email = z.infer<typeof emailSchema>
```

```ts
// schemas/user.schema.ts: the shape every user endpoint returns
import { z } from 'zod'
import { idSchema } from './common.schema.ts'

export const publicUserSchema = z.object({
    id: idSchema,
    email: z.email(),
    name: z.string(),
})

export type PublicUser = z.infer<typeof publicUserSchema>
```

```ts
// controllers/api/v1/user.controller.ts
import { z } from 'zod'
import { route } from '#lib/http/route.lib'
import { emailSchema } from '#schemas/common.schema'
import { publicUserSchema } from '#schemas/user.schema'

// Endpoint-only: stays in the controller until a second file needs it.
const createUserBody = z.strictObject({
    email: emailSchema,
    name: z.string().trim().min(1),
})

export const createUser = route(
    { body: createUserBody, response: publicUserSchema },
    ({ body }) => userService.createUser(body),
    { status: 201 },
)
```

## Types across layers

A service may not import from `controllers/`, so it cannot reuse an endpoint schema's type. Two options, in order of preference:

1. **The service declares its own input type** (`interface CreateUserInput { email: string; name: string }`). TypeScript checks that the controller's parsed body fits when it calls the service. Use this for endpoint-only shapes.
2. **The type comes from here** (`import type { PublicUser } from '#schemas/user.schema'`). Use this for shapes that are already shared.

## Dependency rules

```
constants/    ← depends on nothing
   ↑
schemas/      ← may import constants/ (and zod), nothing else
   ↑
repository/ · services/ · controllers/
```

The rules are enforced, not just documented:

- **Alias** in `package.json` `"imports"`: `"#schemas/*"` resolves to `src/schemas/*.ts` in dev and `dist/schemas/*.js` in production.
- **Lint rule** in [`eslint.config.js`](../../eslint.config.js): `schemas: ['constants']` in `ALLOW`, and `'schemas'` added to the allowed list of each layer that uses it. Any other import fails `pnpm lint`.

Inside this folder, import siblings relatively (`./common.schema.ts`), like every other layer.

## The test
> Is it a Zod schema that two or more files need, and that depends on nothing but `constants/`? → it belongs here.

## Rule of thumb
> Schemas start where they're used and move here when they're shared. The env schema never moves: it belongs to `constants/env/`.
