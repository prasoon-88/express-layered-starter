# rateLimiter/

**Responsibility:** Decide whether a request may proceed, and tell the client where it stands. Built on [`rate-limiter-flexible`](https://github.com/animir/node-rate-limiter-flexible), with an in-memory store or Redis.

## What goes here
- Policies (how many requests per window) and the registry that holds them
- The engine that spends points against a store and reports a decision
- The middleware factory, `rl.limit(...)`, that routes and `app.ts` attach
- Client keys (IP, user, header, body field), the `RateLimit-*` headers, the store readiness check

## What does NOT go here
- ❌ Business rules ("a free user may create 5 posts"). A limit protects the server from volume; it does not decide what a user may do (that's `services/`)
- ❌ The Redis client itself. It comes from [`lib/redis/`](../lib/redis/index.ts), and this folder only uses it

## How it is wired

```
server.ts   initRateLimit(env, logger)  →  { limit, close, readinessChecks }
app.ts      container.provide('limit', () => rl.limit)
            defineGroup('/', [...], { use: [rl.limit('global'), ...] })    every route in the group
routes      handlers: [limit('auth'), ...]      the strict `auth` policy, `limit` received as an argument
```

In the route tree in `app.ts`, `/health` sits **outside** the group that carries the global limiter, so probes are never limited, and a limiter whose store is down cannot take the health endpoints down with it. `RATE_LIMIT_SKIP_PATHS` is for anything else you want exempt, and is empty by default.

Nothing outside `server.ts` and `app.ts` imports this folder; ESLint enforces it (`rateLimiter` in [`eslint.config.js`](../../eslint.config.js)). Route files get `limit` from the container: a module lists it in `needs`, and the route function receives it (see [`http/README.md`](../http/README.md)). A limit that must also count rejected callers goes in the route's `pre`, which runs before the access check.

## Policies

| Name | Variables | Used by |
|------|-----------|---------|
| `global` | `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_S` | every application route |
| `auth` | `RATE_LIMIT_AUTH_MAX` per `RATE_LIMIT_AUTH_WINDOW_S`, blocked for `RATE_LIMIT_AUTH_BLOCK_S` after exceeding | credential endpoints, such as `POST /api/v1/user/register` |

```ts
rl.limit('auth')                                              // by name
rl.limit({ points: 5, durationS: 60 })                        // ad hoc
rl.limit({ policy: 'auth', key: keys.body('email'), refundOnSuccess: true })
```

`refundOnSuccess` gives the point back when the response is below 400, which suits login: only failed attempts count.

With `RATE_LIMIT_STORE=redis`, `{SERVICE_NAME}:rl-config` is a Redis hash read every `RATE_LIMIT_POLICY_REFRESH_S` seconds. Each field is a policy name and each value is JSON such as `{"points":50,"durationS":60}`, so a limit can change without a deploy. An invalid entry is ignored and logged; a removed one reverts to the default.

## What the client sees

On every decision the store actually made:

```
RateLimit-Policy: 100;w=60
RateLimit: limit=100, remaining=42, reset=17
```

This is the IETF `draft-ietf-httpapi-ratelimit-headers-07` format. `reset` is in seconds. A limited request gets `429 TOO_MANY_REQUESTS` and `Retry-After`.

## When the store fails

Redis being unreachable is a different thing from a client being over the limit, and is reported differently. `RATE_LIMIT_ON_STORE_ERROR` decides:

| Mode | Requests while Redis is down | `/health/ready` |
|------|------------------------------|-----------------|
| `local` (default) | Limited from per-instance memory | `200`, `degraded` |
| `allow` | Let through, unlimited | `200`, `degraded` |
| `deny` | `503 SERVICE_UNAVAILABLE`, never `429` | `503` |

When the store failed, no limit was checked, so no `RateLimit-*` headers are sent. The client is told nothing it could mistake for a quota.

Startup does not wait for Redis beyond `REDIS_CONNECT_TIMEOUT_MS`. If Redis is down at boot the app starts anyway under the mode above, and the client keeps reconnecting in the background.

Shutdown is a hook in [`server.ts`](../server.ts) (`hooks: [() => rateLimiter.close()]`): it stops the policy sync and closes the Redis client, whether or not it ever connected.

## Testing

The unit tests use the in-memory store. [`index.test.ts`](index.test.ts) starts a real `redis-server` on a free port, so it proves limits are shared across instances and that an unreachable Redis behaves as documented. Install `redis-server` to run it (CI does); set `REDIS_SERVER_BIN` if it is not on your `PATH`. Without it the file is skipped locally and fails in CI.

## The test
> Does it count, shape, or report request volume? → it belongs here.
> Does it decide what a user is allowed to do? → that's the service's job.
