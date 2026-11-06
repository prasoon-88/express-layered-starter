# modules/

**Responsibility:** Wire one feature. A module registers the feature's repository, service and controller in the container, says what its routes need, and hands back those routes. It is the only place where the layers of a feature meet.

## What goes here
- One `<feature>.module.ts` per feature, built with [`defineModule`](../http/routes.ts)
- The `Registry` augmentation for every key the module provides
- [`index.ts`](index.ts): which modules are mounted, and where

## What does NOT go here
- ❌ Logic of any kind. A module only connects factories: `(get) => createX({ y: get('y') })`
- ❌ Route definitions (that's `routes/`)
- ❌ Infrastructure that needs I/O, such as Redis or the rate limiter. `server.ts` builds it and `app.ts` registers it

## Example

```ts
// modules/user.module.ts
import { createUserController, type UserController } from '#controllers/api/v1/user.controller'
import { defineModule } from '#http/routes'
import { createUserRepository, type UserRepository } from '#repository/user.repository'
import { userRoutes } from '#routes/api/v1/user.routes'
import { createUserService, type UserService } from '#services/user.service'

declare module '#http/registry' {
  interface Registry {
    userRepository: UserRepository
    userService: UserService
    userController: UserController
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
})
```

Then one entry in [`index.ts`](index.ts), in the list for where it is served:

```ts
export const apiV1Modules = [userModule, postModule]
```

`app.ts` places each list in the route tree (`probeModules` before the global rate limit, `pageModules` and `apiV1Modules` after it), so adding a feature never changes `app.ts`. A new API version is a new list here and one line in the tree. The lists are explicit on purpose: order is the order Express tries routes in, and the unreachable-route check depends on it.

## Rules
- **A key has one owner.** Two modules registering the same key stops the boot. Share a service by having one module provide it and the others list it in `needs`, or `get` it in a provider. [`auth.module.ts`](auth.module.ts) does the second: its `authService` uses `get('userRepository')` from the user module.
- **A module may provide a platform key.** The auth module provides `authenticate`, which the access strategies run. Swapping auth schemes means swapping that module.
- **Names are unique.** The name appears in every error and in the route list `createApp` returns.
- **Modules sit in the tree, not inside each other.** A module's `routes` returns a route or a group. Nest features by placing their modules in groups in `app.ts`.

The full set of rules, and what stops the boot when one is broken, is in [`http/README.md`](../http/README.md).

## Dependency rules

Modules are composition, so they may import every layer except `rateLimiter/` and `idempotency/`. Those two reach routes through the container, registered once in `app.ts`. Nothing but `app.ts` imports a module. Enforced in [`eslint.config.js`](../../eslint.config.js).

## The test
> Does it connect a feature's factories and routes, and nothing more? → it belongs here.
