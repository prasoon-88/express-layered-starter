# lib/

**Responsibility:** Wrappers around external systems and third-party SDKs. One place where "how we talk to that thing" is decided, so the rest of the app imports *our* interface instead of theirs.

## What goes here

- Configured clients: logger, mailer, cache, storage, queue, HTTP clients
- Anything with setup, connections, or credentials
- A thin seam over a library you might one day replace

## What does NOT go here

- ❌ Pure helper functions with no external system — that's [`utils/`](../utils/)
- ❌ Database queries for your own data — that's [`repository/`](../repository/)
- ❌ Business rules about *when* to send the email — that's [`services/`](../services/)

## Lib vs utils

| | `lib/` | `utils/` |
|---|---|---|
| Wraps an external system? | ✅ Yes | ❌ No |
| Has setup / connections / credentials? | ✅ Yes | ❌ Pure functions |
| Example | `logger/`, `mailer.ts`, `s3.ts` | `slugify()`, `paginator` |

## What's here

### `logger/`

A [pino](https://getpino.io/) instance configured from [`config/logger.config.ts`](../config/logger.config.ts):

- **Structured JSON** in production, pretty-printed in development (falls back to JSON if `pino-pretty` isn't installed, rather than crashing)
- **Automatic request IDs** via a `mixin` that reads [`contexts/requestContext.ts`](../contexts/requestContext.ts) — no `req` passed anywhere
- **Redaction** of passwords, tokens, cookies, and auth headers before they ever reach a log sink
- **Base fields** on every line: service, env, pid, hostname

Use a child logger per file so every line says where it came from:

```js
import { getLogger } from '#lib/logger/index'

const logger = getLogger('user.service')

logger.info({ userId }, 'user created')
logger.warn({ attempts }, 'repeated login failure')
logger.error({ err }, 'could not send welcome email')
```

Pass the object first, the message second — that's pino's signature, and it's what keeps fields queryable instead of buried in a string. Never build messages with template literals when the value could be a field.

Importing the default export gives you the root logger, which is what the middlewares use.

### `lifecycle/`

Owns how the process stops, and how it fails. Two files:

| File | Role |
|------|------|
| `index.ts` | `registerProcessHandler` — the signal, crash and shutdown logic |
| `state.ts` | `lifecycleState` — the shutdown flag, published so other code can read it |

Call `registerProcessHandler` **once**, from [`server.ts`](../server.ts), right after `app.listen()`:

```js
import { registerProcessHandler } from '#lib/lifecycle/index'

const server = app.listen(PORT)

registerProcessHandler({
    server,
    hooks: [() => rateLimiter.close()],   // cleanup run after the server drains, e.g. () => mongoose.disconnect()
})
```

#### What it listens for

| Trigger | Kind | Log level | Drain delay? | Exit code |
|---------|------|-----------|:---:|:---:|
| `SIGINT` / `SIGTERM` | planned stop | `info` | ✅ | `0` |
| `uncaughtException` | crash | `fatal` | ❌ | `1` |
| `unhandledRejection` | crash | `fatal` | ❌ | `1` |
| server `'error'` (e.g. `EADDRINUSE`) | crash | `fatal` | ❌ | `1` |

Every trigger goes through one `shutdown()` path:

```
planned stop:  mark shutting down → wait drainDelayMs → server.close → hooks → exit 0
crash:         mark shutting down →                      server.close → hooks → exit 1
               └──────────── one force-exit timer covers all of it (timeoutMs) ────────────┘
```

#### Settings

| Option | Env var | Default | Meaning |
|--------|---------|---------|---------|
| `timeoutMs` | `SHUTDOWN_TIMEOUT_MS` | `8000` | Total budget. When it expires, active connections are cut and the process exits `1`. |
| `drainDelayMs` | `SHUTDOWN_DELAY_MS` | `5000` | After a **planned** stop begins, keep serving for this long so a load balancer notices and stops routing here. `0` disables it. |
| `hooks` | — | `[]` | Async cleanup functions, run in order after the server drains. |
| `server` | — | required | The `http.Server` returned by `app.listen()`. |
| `logger`, `proc`, `exit` | — | logger, `process`, `process.exit` | Injectable so a fake emitter and a spy can replace the real ones in tests. |

`drainDelayMs` **must be smaller than** `timeoutMs`. The delay spends part of the same budget the drain needs, so a delay equal to or larger than the timeout would force-exit before anything drains. `registerProcessHandler` checks this when it is called and throws a `RangeError` — the app refuses to start rather than shutting down badly later. A non-numeric value fails the same check. A missing `server` throws a `TypeError`.

Tuning:

| Where it runs | `SHUTDOWN_TIMEOUT_MS` | `SHUTDOWN_DELAY_MS` |
|---------------|-----------------------|---------------------|
| Local development | `8000` | `0` — otherwise a graceful Ctrl+C waits the full delay |
| Docker (`docker stop`) | below `10000`, Docker's default kill deadline | `0` unless something is probing the container |
| Kubernetes (30s default grace) | `25000` | `5000`, longer than the readiness probe interval |

#### Behaviors worth knowing

- **Idempotent.** A second `shutdown()` call does nothing, so errors during shutdown can't restart it.
- **The timer is armed first**, before the delay, so a hang anywhere still ends in an exit.
- **Hooks are isolated.** One that throws is logged and turns the exit code into `1`, but the remaining hooks still run.
- **A second signal exits immediately** with `1`: the "I mean it" Ctrl+C.
- **A crash that arrives mid-shutdown** is logged, and the final exit code becomes `1` even for a planned stop. Otherwise a failure would be reported to the platform as a clean exit.
- **If `shutdown()` itself throws**, it logs `fatal` and exits `1` instead of leaving a rejected promise behind.
- **Crashes skip the delay.** A process in an unknown state shouldn't keep serving for five seconds.

#### The shared flag

`lifecycleState.isShuttingDown()` is `true` from the moment shutdown starts. Anything that needs to answer "are we stopping?" reads it — the readiness endpoint ([`routes/health/`](../routes/health/)) returns `503` while it is `true`, which tells the load balancer to stop routing here. Only `lifecycle/index.ts` calls `markShutdown()`.

The flag is process-wide, so a second `registerProcessHandler` call in the same process sees it as already set. Exercise each scenario in its own process until the module keeps its own local flag.

#### Where to call it

Call it once. Registering twice installs every handler twice. Don't call it from `app.ts` or from tests: importing the app must not attach signal handlers to the test runner's process.

> On Windows, `pnpm dev` puts a `cmd` layer in front of Node that intercepts Ctrl+C ("Terminate batch job?"). To exercise the signal path, run `node --conditions=app-source --env-file=.env src/server.ts` directly, or use WSL or Docker. `SIGTERM` is not delivered normally on Windows, so test that path in Docker or WSL.

### `http/`

`route()` in [`route.lib.ts`](http/route.lib.ts) wraps a controller with [Zod](https://zod.dev/) validation. Give it schemas for any of `body`, `query`, `params` and `response`, then a handler, then options:

```js
import { z } from 'zod'
import { route } from '#lib/http/route.lib'

export const listUsers = route(
    {
        query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
        response: z.array(z.object({ id: z.string(), email: z.email() })),
    },
    ({ query }) => userService.listUsers(query.page),   // query.page is a number here
    { status: 200 },                                    // optional, defaults to 200
)
```

Use it in `controllers/`. `routes/` may not import `lib/`, so a route file only references the wrapped controller.

It runs in two phases, and the phase an error comes from decides its status:

| Phase | What fails | Response |
|-------|------------|----------|
| 1. Input | `body`, `query` or `params` doesn't match its schema | `400 BAD_REQUEST`, every failing field in `details` |
| 2. Handler | it throws a typed error (`NotFoundError`, …) | that error's status and code |
| 2. Handler | it throws anything else, rejects, or throws a `ZodError` | `500 INTERNAL_ERROR`, generic message |
| 2. Response | the return value doesn't match `response` | `500 INTERNAL_ERROR`; the mismatch is logged, never sent |

`route()` never builds an error response itself. `lib/` may not import `errors/`, so it only calls `next(err)`. The [Zod converter](../errors/converter/zod.converter.ts) turns the input `ZodError` into a `BadRequestError`, and the [error handler](../middlewares/error.middleware.ts) sends it.

#### Behaviors worth knowing

- **All three inputs are checked**, and every failure comes back in one `400`. Each `path` starts with where it came from: `body.email`, `query.page`, `params.id`. A missing body is reported at `body`.
- **The handler gets the parsed values**, not the raw ones: coerced, defaults filled in, unknown keys stripped. `req.body`, `req.query` and `req.params` are left as they arrived, so read `input`, not `req`.
- **Query and path values are strings.** Use `z.coerce.number()`, not `z.number()`, for `?page=2`.
- **`z.object` drops unknown keys silently.** Use `z.strictObject` to reject them; each extra key is reported separately (`body.admin`, `Unrecognized field`).
- **Async rules work.** Parsing uses `safeParseAsync`, so `.refine(async …)` is fine. A refine or transform that *throws*, rather than returning `false`, is a bug and becomes a `500`.
- **A `ZodError` from inside the handler is a `500`, not a `400`.** Validating a database row or an upstream reply checks *your* data; if it fails, the client did nothing wrong. To reject a request for a business reason, throw a typed error (`BadRequestError`, `UnprocessableEntityError`) from the service.
- **`response` is an allowlist.** It describes `data`. The parsed value is what gets sent, so fields the schema doesn't name (`passwordHash`) are stripped before they leave.
- **The return value becomes `data` in the standard envelope**, `{ success, message, data, requestId }`, exactly what [`apiResponse`](../utils/apiResponse.util.ts) sends. Both build it with [`successEnvelope.lib.ts`](http/successEnvelope.lib.ts), so a client sees one success shape whichever way the handler responds. The `status` option picks the status code and the default message (`201` → `Created`, `202` → `Accepted`). `204` sends no body, and a handler that returns nothing gets `data: null`.
- **The handler can still respond itself**, for a redirect or `apiResponse.pagination(res, …)` (the handler receives `(input, req, res)`). `route()` sees the response is already sent and steps aside. **The `response` schema is then skipped**, so it no longer strips fields: shape the data before you send it.
- **Built for JSON routes.** On a non-`/api` route a `400` renders the `error` view, which shows the message but not `details`.
- **The schemas can be read back.** `getRouteContract(handler)` returns the frozen `{ body?, query?, params?, response?, status }` that a `route()` handler validates with, or `undefined` for any other function. The OpenAPI document is built from it, so what it documents is what is enforced.

`buildOpenApiDocument({ title, version, routes })` in [`openapi.lib.ts`](http/openapi.lib.ts) turns mounted routes and their contracts into an OpenAPI 3.1 document. It takes routes as a plain shape rather than the `http/` manifest type, since `lib/` may not import `http/`. It throws, naming the route, when a schema has no JSON Schema form (`z.date()`, `z.bigint()`, `z.custom()`, a transform in a `response`) or when `query` or `params` is not an object. What ends up in the document is described in the root [README](../../README.md#openapi).

### `auth/`

`createAccessTokens({ secret, issuer, audience, ttlS, now? })` in [`auth/accessToken.ts`](auth/accessToken.ts) returns `{ sign, verify }`, the only code that touches `jsonwebtoken`. The auth module builds it from `JWT_SECRET`, `SERVICE_NAME` and `JWT_ACCESS_TTL_S`.

- **`sign({ sub, email, role })`** returns `{ token, expiresIn }`. `iat` comes from `now`, so tests move the clock instead of waiting.
- **`verify(token)`** pins HS256, the issuer and the audience, with 5 seconds of clock tolerance. It throws jsonwebtoken's own errors, which the [JWT converter](../errors/converter/jwt.converter.ts) turns into `401 TOKEN_EXPIRED` or `TOKEN_INVALID`.
- **It checks the signature, not the shape.** `lib/` may not import `schemas/`, so the [authenticate middleware](../middlewares/authenticate.middleware.ts) validates the claims with `authUserSchema`.
- **It refuses a weak setup at construction**: a secret under 32 characters, or a ttl that is not a positive whole number, throws a `RangeError`.

### `health/`

`runReadinessChecks()` in [`health/index.ts`](health/index.ts) is what `GET /health/ready` runs. A dependency describes itself as a `ReadinessCheck`:

```js
{ name: 'rate-limit-store', critical: false, run: () => redis.ping() }
```

Whoever creates a dependency builds its check and passes it to `createApp({ readinessChecks })` in [`server.ts`](../server.ts); `app.ts` never learns what the dependencies are. Redis is the first one, built in [`rateLimiter/readiness.ts`](../rateLimiter/readiness.ts).

- **All checks start at once** and each is capped at `READINESS_CHECK_TIMEOUT_MS` (1s, Kubernetes' default probe timeout). A check that rejects, throws, or never answers is `down`; a hung dependency cannot hang the probe.
- **`critical` decides the response.** A critical check that is `down` makes `/health/ready` answer `503 SERVICE_UNAVAILABLE`. A non-critical one leaves it at `200` with `status: "degraded"`. Mark a check critical only when the instance cannot do its job without that dependency.
- **The failure reason is logged, never returned.** The response names each dependency and whether it is `up` or `down`, nothing about why, so a probe cannot leak connection details.
- **Liveness never runs checks.** Restarting the process cannot fix a dead dependency.

### `redis/`

`createRedisClient(url, logger, { connectTimeoutMs })` in [`redis/index.ts`](redis/index.ts) returns a node-redis client, and `closeRedisClient(client)` shuts it down.

- **Startup never hangs.** node-redis keeps retrying a refused connection forever and its `connect()` promise never settles, so the function stops waiting after `connectTimeoutMs`, logs a warning, and returns the client while it keeps reconnecting in the background. Whoever uses it must handle a client that is not ready yet. The rate limiter does: see [`rateLimiter/`](../rateLimiter/README.md#when-the-store-fails).
- **Commands fail fast while disconnected** (`disableOfflineQueue`). A request gets an error at once instead of waiting in a queue for a reconnect.
- **RESP2, on purpose.** node-redis 6 defaults to RESP3, whose `HELLO` handshake Redis older than 6 rejects. Nothing here needs RESP3.
- **`closeRedisClient` handles both states.** A ready client is closed after its in-flight commands finish. One that never connected, or is between reconnects, has nothing to flush and is destroyed at once, so shutdown never waits on a connection that is not there.

## Adding a client

Export something configured and ready to use. Read settings from `config/`, never from `process.env` directly:

```js
// lib/mailer.ts
import nodemailer from 'nodemailer'
import { mailerConfig } from '#config/mailer.config'

const transport = nodemailer.createTransport(mailerConfig)

export const sendMail = ({ to, subject, html }) =>
    transport.sendMail({ from: mailerConfig.from, to, subject, html })
```

The service calls `sendMail(...)` and stays ignorant of nodemailer. Swapping providers touches one file.

## Rule of thumb

> If it needs credentials, a connection, or a third-party package to work, it's a lib. If it's a function you could copy into any project unchanged, it's a util.
