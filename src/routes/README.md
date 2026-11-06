# routes/

**Responsibility:** Declare the routes: for each URL, who may call it, which middleware runs, and which controller answers. The "table of contents" of your API.

## What goes here
- Route definition functions built with [`defineRoute` and `defineGroup`](../http/routes.ts)
- The access rule of every route (`public` with a reason, `authenticated`, or `roles`)
- Route-level middleware, in order: rate limits, idempotency, anything else

## What does NOT go here
- ❌ Business logic (that's `services/`)
- ❌ Database queries (that's `repository/`)
- ❌ Request/response handling logic (that's `controllers/`)
- ❌ Importing controllers or infrastructure. A route file receives them as arguments

A route definition is data: "this URL, this access rule → these handlers."

Request validation isn't attached here either. The controller declares its own schemas with [`route()`](../lib/http/route.lib.ts) (see [`controllers/`](../controllers/README.md#validated-endpoints-with-route)), and `routes/` may not import `lib/`.

## Example

```ts
// routes/api/v1/post.routes.ts
import type { Registry } from '#http/registry'
import { defineGroup, defineRoute } from '#http/routes'

type PostRoutesDeps = Pick<Registry, 'postController' | 'limit' | 'idempotent'>

export const postRoutes = ({ postController, limit, idempotent }: PostRoutesDeps) =>
  defineGroup('/post', [
    defineRoute({
      method: 'get',
      path: '/:id',                                          // GET  /api/v1/post/:id
      access: { strategy: 'public', reason: 'Posts are readable without an account' },
      handlers: [postController.getPost],
    }),
    defineRoute({
      method: 'post',
      path: '/',                                             // POST /api/v1/post
      access: { strategy: 'authenticated' },
      pre: [limit('auth')],                                  // runs before authentication
      handlers: [idempotent('default'), postController.createPost],
    }),
  ])
```

The function receives only the keys its type names. A [module](../modules/README.md) supplies them and places the routes in the tree.

## How routing is organized

```
app.ts                    the route tree: /health, then / (global limit + timeout) → web, /api
├── health/index.ts       /health, /health/ready, /health/live
├── web/index.ts          server-rendered pages (EJS), urlencoded forms
└── api/index.ts          express.json(), then unversioned modules, then each version
    ├── docs.routes.ts    /docs/openapi.json
    └── v1/index.ts       /v1, then each module
        ├── auth.routes.ts /auth/login, /auth/refresh, /auth/logout
        └── user.routes.ts /user/register, /user/me
```

So `path: '/register'` in `user.routes.ts` is served at **`POST /api/v1/user/register`**. No file repeats a prefix its parent already added. Which modules sit under `/api/v1` is a list in [`modules/index.ts`](../modules/index.ts); a new version is a new list there and one line in `app.ts`.

JSON body parsing is mounted on the API group only, since the web routes render forms rather than consume JSON.

## Rules the mounter enforces

Every route needs an access rule, paths use only static segments and `:params`, and a route that an earlier one always answers stops the boot. The full list is in [`http/README.md`](../http/README.md#what-stops-the-boot).

## Rule of thumb
> If a route file has an `if` statement or a `db.` call, logic has leaked in. Move it down to the controller or service.
