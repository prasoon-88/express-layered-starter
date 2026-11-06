# http/

**Responsibility:** Turn a tree of route definitions into one Express router, and supply every route with what it needs through a typed container. It knows nothing about any feature. Users, health and the web pages are all plugged in from [`modules/`](../modules/README.md).

## What goes here
- The container: one instance per key, built on first use ([`container.ts`](container.ts))
- The registry: the type of every key the container can provide, and every access strategy ([`registry.ts`](registry.ts))
- The definitions: `defineRoute`, `defineGroup`, `defineModule` ([`routes.ts`](routes.ts))
- The access strategies: `public`, `authenticated`, `roles` ([`strategies.ts`](strategies.ts))
- The path rules and the unreachable-route check ([`paths.ts`](paths.ts))
- The mounter, which checks the whole tree and builds the router ([`mount.ts`](mount.ts))

## What does NOT go here
- ❌ Any feature's routes, controllers or services (those are `routes/`, `controllers/`, `services/`, wired in `modules/`)
- ❌ The middleware itself: rate limiting, idempotency, authentication. This folder only puts them in place
- ❌ Imports from any layer except `constants/`

## How the pieces fit

```
server.ts    builds what needs I/O (Redis, the rate limiter, idempotency)
   ↓
app.ts       creates the container, registers that infrastructure, and declares the route tree
   ↓
mount()      registers each module's providers → resolves what each module needs →
             checks every route → builds one Express router
   ↓
modules/     each one: its providers (repository → service → controller), what it needs, its routes
   ↓
routes/      route definitions: path, access rule, middleware, controller, all received as arguments
```

The tree in [`app.ts`](../app.ts) is the whole URL space on one screen:

```ts
defineGroup('/', [
  ...probeModules,                                      // /health, before the global limit
  defineGroup('/', [...pageModules, apiRoutes([...apiModules, apiV1Routes(apiV1Modules)])], {
    use: [rl.limit('global'), requestTimeoutMiddleware(env.REQUEST_HANDLER_TIMEOUT_MS)],
  }),
])
```

The module lists live in [`modules/index.ts`](../modules/index.ts), so the tree stays this size however many features there are.

## A route

```ts
// routes/api/v1/user.routes.ts
export const userRoutes = ({ userController, limit, idempotent }: UserRoutesDeps) =>
  defineGroup('/user', [
    defineRoute({
      method: 'post',
      path: '/register',
      access: { strategy: 'public', reason: 'Account signup: the caller has no credentials yet' },
      handlers: [limit('auth'), idempotent('default'), userController.register],
    }),
  ]);
```

A route runs its middleware in this order:

| Step | From | Typical use |
|------|------|-------------|
| 1 | each enclosing group's `use`, outermost first | body parsing, the global limit |
| 2 | the route's `pre` | a rate limit that must also count rejected callers |
| 3 | the middleware its `access` strategy returns | `authenticate`, then `authorize(roles)` |
| 4 | the route's `handlers`, in order; the last one is the controller | per-route limit, idempotency, the controller |

To change the order, move an entry within `pre` or `handlers`, or move it between the two. Any `RequestHandler` works in either array, so a new middleware never needs a change here.

## Access rules

Every route must say who may call it. `access` is required by the type, and checked again when the app starts, so a route without one cannot ship.

| Strategy | Options | Adds | Use for |
|----------|---------|------|---------|
| `public` | `reason` (required, not blank) | nothing | pages and endpoints for callers without credentials |
| `authenticated` | none | `authenticate` | any signed-in caller |
| `roles` | `roles`, at least one, each in `USER_ROLES` | `authenticate`, then `authorize(roles)` | admin and staff endpoints |

Groups have no access default on purpose. If they had one, moving a route into another group could change who may call it without anyone noticing.

[`app.test.ts`](../app.test.ts) lists every public route. Adding one fails that test until it is added to the list, so making something public always shows up in review.

`authenticate` comes from the auth module ([`modules/auth.module.ts`](../modules/auth.module.ts)). It verifies the `Authorization: Bearer` access token and sets `req.user`. The `authenticated` and `roles` strategies need it, so if the auth module is removed from `modules/index.ts`, any route using either one stops the boot with `No provider for "authenticate"`. A different scheme (sessions, API keys, an external identity provider) replaces that one provider; no route changes.

```ts
defineRoute({ method: 'get', path: '/me', access: { strategy: 'authenticated' }, handlers: [userController.me] })
defineRoute({ method: 'delete', path: '/:id', access: { strategy: 'roles', roles: ['ADMIN'] }, handlers: [userController.remove] })
```

## A module

```ts
// modules/user.module.ts
declare module '#http/registry' {
  interface Registry {
    userRepository: UserRepository;
    userService: UserService;
    userController: UserController;
  }
}

export const userModule = defineModule({
  name: 'user',
  providers: {
    userRepository: () => createUserRepository(),
    userService: (get) => createUserService({ userRepository: get('userRepository') }),
    userController: (get) => createUserController({ userService: get('userService') }),
  },
  needs: ['userController', 'limit', 'idempotent'],
  routes: userRoutes,
});
```

- `providers` registers keys in the container. `get` inside a provider resolves another key, building it first if needed.
- `needs` lists what the routes receive. `routes` gets exactly those keys, typed, and nothing else.
- Each key's type is declared next to the code that provides it, by augmenting `Registry`. No file lists every dependency.

Infrastructure is registered in `app.ts` with the same mechanism: `env`, `limit`, `idempotent`, `readinessChecks`, `authorize`, and `redis` when `server.ts` opened a connection. A provider reads settings with `get('env')`, so a test app built with a different env gets different settings, with nothing global to reset.

`mount` itself provides one key, `routeTable`, so a module can describe the app it is part of (the docs module builds the OpenAPI document from it). `routeTable.all()` returns the same entries as `routes` below. It throws while mounting is still running, because the table is incomplete until then, so read it from a request handler, not from a provider.

## The container

| Behaviour | Why |
|-----------|-----|
| One instance per key, built the first time it is asked for | Wiring order doesn't matter, and unused providers cost nothing |
| A new container per `createApp` | Two apps in one process (tests) never share state |
| No registration after the first `get` | What a route received cannot change after it was built |
| Providers are synchronous | An async provider would hand routes a promise. Open connections in `server.ts`, then register the ready value |
| No request scope | Per-request state lives in [`contexts/`](../contexts/README.md) (`AsyncLocalStorage`), which the app already uses for request IDs |

## What stops the boot

Every check runs once, inside `mount()`. Nothing is checked per request. Each error names the route, group or module at fault.

| Mistake | Message (abridged) |
|---------|--------------------|
| No `access` on a route | `GET /x has no access rule` |
| Unknown strategy, including names inherited from `Object` such as `toString` | `uses unknown access strategy "nobody"` |
| `public` without a reason | `a public route needs a reason` |
| `roles` that is empty, or names an unknown role | `needs at least one role` / `unknown role "ROOT"` |
| A strategy needs a key nobody registered | `GET /me: No provider for "authenticate"` |
| Method outside `get`, `post`, `put`, `patch`, `delete` | `method "trace" must be one of …` |
| A path that is not canonical, or uses syntax the checker can't compare | `path segment "*rest" is not allowed` |
| The same param name twice, across a prefix and a path | `uses the param ":id" twice` |
| The same method and path twice, in any letter case | `GET /x is defined twice` |
| A route an earlier one always answers | `GET /users/me can never be reached: GET /users/:id is registered first` |
| A handler that is not a function | `GET /x handlers #2 is not a function` |
| A four-parameter function among the handlers (Express would skip it as an error handler) | `pre #1 takes 4 parameters` |
| A route with no handlers, or a group with no children | `needs at least one handler` / `Group /api has no routes` |
| Two sibling groups at the same prefix | `Group / has two groups at /API` |
| A module that needs a key nobody provides | `Module "user" needs "mailer", but nothing provides it` |
| A provider that throws, returns `undefined`, or returns a promise | `Module "user": …` |
| Two owners register the same key | `"userService" is registered by both "user" and "billing"` |
| A circular dependency | `Circular dependency: a -> b -> a` |
| The same module twice, or two modules with one name | `Module "user" is included twice` |
| A module inside another module's routes | `list it in a group of the route tree instead` |

## Paths

Paths may contain only static segments (letters, digits, `._~-`) and whole-segment params (`:id`). They start with `/` and have no trailing `/` and no empty segment.

That subset is what makes the unreachable-route check exact. Express matches case-insensitively and ignores a trailing slash, so `/Users` and `/users/` are the same route as `/users`, and the check treats them that way. Wildcards (`*rest`), optional groups (`{/:id}`) and params mixed with text (`:from-:to`) would need a model of Express's matcher, so they are refused rather than guessed at.

Routes are registered depth-first, which is the order Express tries them in. A static route before a param route of the same shape is fine (`/users/me`, then `/users/:id`). The reverse order stops the boot.

Params in a group prefix reach the route, because every group router is created with `mergeParams`.

## Group middleware

A group's `use` runs for every request whose path starts with the prefix, including requests no route matches. The global limit relies on this to count unknown paths too. Keep group middleware to work that is cheap and safe for any request (body parsing, limits, headers). Put access checks on routes, through `access`.

## Adding things

| To add | Change |
|--------|--------|
| A route | Its route file only |
| A middleware on one route | Put it in that route's `pre` or `handlers` |
| A feature | A controller/service/repository as factories, a route file, a module, and one entry in a list in `modules/index.ts` |
| A dependency for one feature | That module's `providers`, with its `Registry` augmentation |
| Infrastructure for every feature | `container.provide(...)` in `app.ts`, with its `Registry` augmentation there |
| An access strategy | Augment `AccessStrategies` with its options, write an `AccessStrategy` for it, and pass `{ ...builtInStrategies, yours }` to `mount`. The `Strategies` type rejects a strategy without an implementation |

## Testing

- [`container.test.ts`](container.test.ts), [`paths.test.ts`](paths.test.ts) and [`mount.test.ts`](mount.test.ts) cover every rule above, against a real Express server.
- A module can be mounted alone with a fresh container and fakes for only the keys it needs.
- `createApp` returns `{ app, routes }`. `routes` lists every route's method, full path, access rule, module and `controller` (its last handler, whose [`route()`](../lib/http/route.lib.ts) schemas the OpenAPI document reads), and is what the public-route test reads.

## Dependency rules

```
constants/   ← the only layer http/ imports (USER_ROLES)
   ↑
http/        ← imported by routes/ (definitions, Registry type), modules/, and app.ts
```

Enforced by `http: ['constants']` in [`eslint.config.js`](../../eslint.config.js). Inside this folder, siblings are imported relatively.

## The test
> Does it decide how routes are assembled, checked or supplied with dependencies, for any feature? → it belongs here.
> Does it belong to one feature? → that's `modules/` and the layers below it.
