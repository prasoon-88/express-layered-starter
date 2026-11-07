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

Use a child logger per file so every line says where it came from. The name is the file name without `.ts` (`user.service`, `requestTimeout.middleware`), or the folder name for an `index.ts` (`health`, `lifecycle`):

```js
import { getLogger } from '#lib/logger/index'

const logger = getLogger('user.service')

logger.info({ userId }, 'user created')
logger.warn({ attempts }, 'repeated login failure')
logger.error({ err }, 'could not send welcome email')
```

Pass the object first, the message second — that's pino's signature, and it's what keeps fields queryable instead of buried in a string. Never build messages with template literals when the value could be a field.

The `logger` export is the root logger, which is what the middlewares use.

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

`route()` in [`route.ts`](http/route.ts) wraps a controller with [Zod](https://zod.dev/) validation. Give it schemas for any of `body`, `query`, `params` and `response`, then a handler, then options:

```js
import { z } from 'zod'
import { route } from '#lib/http/route'

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

`route()` never builds an error response itself. `lib/` may not import `errors/`, so it only calls `next(err)`. The [Zod converter](../errors/converter/zod.converter.ts) turns the input `ZodError` into a `BadRequestError`, and the [error handler](../middlewares/errorHandler.middleware.ts) sends it.

#### Behaviors worth knowing

- **All three inputs are checked**, and every failure comes back in one `400`. Each `path` starts with where it came from: `body.email`, `query.page`, `params.id`. A missing body is reported at `body`.
- **The handler gets the parsed values**, not the raw ones: coerced, defaults filled in, unknown keys stripped. `req.body`, `req.query` and `req.params` are left as they arrived, so read `input`, not `req`.
- **Query and path values are strings.** Use `z.coerce.number()`, not `z.number()`, for `?page=2`.
- **`z.object` drops unknown keys silently.** Use `z.strictObject` to reject them; each extra key is reported separately (`body.admin`, `Unrecognized field`).
- **Async rules work.** Parsing uses `safeParseAsync`, so `.refine(async …)` is fine. A refine or transform that *throws*, rather than returning `false`, is a bug and becomes a `500`.
- **A `ZodError` from inside the handler is a `500`, not a `400`.** Validating a database row or an upstream reply checks *your* data; if it fails, the client did nothing wrong. To reject a request for a business reason, throw a typed error (`BadRequestError`, `UnprocessableEntityError`) from the service.
- **`response` is an allowlist.** It describes `data`. The parsed value is what gets sent, so fields the schema doesn't name (`passwordHash`) are stripped before they leave.
- **The return value becomes `data` in the standard envelope**, `{ success, message, data, requestId }`, exactly what [`apiResponse`](../utils/apiResponse.util.ts) sends. Both build it with [`successEnvelope.ts`](http/successEnvelope.ts), so a client sees one success shape whichever way the handler responds. The `status` option picks the status code and the default message (`201` → `Created`, `202` → `Accepted`). `204` sends no body, and a handler that returns nothing gets `data: null`.
- **A `200` GET or HEAD gets an ETag that can actually match**, set by [`etag.ts`](http/etag.ts) and shared with `apiResponse`. Express hashes every body it sends, but the envelope's `requestId` is new on each request, so that hash never repeats and no response could ever be a `304`. Our tag is a weak validator over `{ status, message, data, meta }` only: `requestId` identifies the request, not the resource, and a weak ETag promises the two responses mean the same thing, not that they are byte-identical. It is set before `res.json()`, so Express keeps it instead of computing its own, and Express's own `If-None-Match` check then answers `304` with no body. Other methods and statuses get no tag from us, and neither does a response whose `Cache-Control` has `no-store`: a client that may not keep it has nothing to revalidate.
- **The handler can still respond itself**, for a redirect or `apiResponse.pagination(res, …)` (the handler receives `(input, req, res)`). `route()` sees the response is already sent and steps aside. **The `response` schema is then skipped**, so it no longer strips fields: shape the data before you send it.
- **Built for JSON routes.** On a non-`/api` route a `400` renders the `error` view, which shows the message but not `details`.
- **The schemas can be read back.** `getRouteContract(handler)` returns the frozen `{ body?, query?, params?, response?, status }` that a `route()` handler validates with, or `undefined` for any other function. The OpenAPI document is built from it, so what it documents is what is enforced.

`buildOpenApiDocument({ title, version, routes })` in [`openapi.ts`](http/openapi.ts) turns mounted routes and their contracts into an OpenAPI 3.1 document. It takes routes as a plain shape rather than the `http/` manifest type, since `lib/` may not import `http/`. It throws, naming the route, when a schema has no JSON Schema form (`z.date()`, `z.bigint()`, `z.custom()`, a transform in a `response`) or when `query` or `params` is not an object. What ends up in the document is described in the root [README](../../README.md#openapi).

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

`createRedisClient(url, logger, { connectTimeoutMs })` in [`redis/index.ts`](redis/index.ts) returns an [ioredis](https://github.com/redis/ioredis) client, the one Redis client in the app, and `closeRedisClient(client)` shuts it down.

- **Startup never hangs.** The client connects lazily and `connect()` is raced against `connectTimeoutMs`; past it, the function logs a warning and returns the client while `retryStrategy` keeps reconnecting in the background (every 100 ms more, up to 3 s). Whoever uses it must handle a client that is not ready yet. The rate limiter does: see [`rateLimiter/`](../rateLimiter/README.md#when-the-store-fails).
- **Commands fail fast while disconnected** (`enableOfflineQueue: false`). A request gets an error at once instead of waiting in a queue for a reconnect.
- **RESP2**, ioredis's protocol, so Redis older than 6 works too.
- **ioredis stays on 5.x.** BentoCache 1.6.1 declares `ioredis@^5` as a peer and recognises a connection it is given with `instanceof`. With another major it would not, and would silently open its own client to `127.0.0.1:6379`. The test `stores entries in the Redis it was given` in [`cache/index.test.ts`](cache/index.test.ts) fails if that happens; upgrade both together.
- **`execOrThrow(multi)`** runs a transaction and throws its first failed command. ioredis resolves `exec()` with an `[error, reply]` pair per command instead of rejecting, so without it a failed write in a `MULTI` would pass silently.
- **`defineScript(source)`** runs a Lua script by its SHA-1 (`EVALSHA`) and sends the source once with `EVAL` when the server answers `NOSCRIPT`: on first use, and after a restart or a failover.
- **`duplicateRedisClient(client, logger, { commandTimeoutMs, name, autoPipelining? })`** opens a second connection with the same settings plus a per-command timeout, for a feature whose slow commands must not queue behind, or ahead of, everyone else's. `autoPipelining` batches the commands sent in one tick into one write, for many small independent commands. The cache uses it, with auto-pipelining on. Its errors are logged with `connection: name`.
- **`closeRedisClient` handles every state.** A ready client quits after its in-flight commands finish. One that never connected, or is between reconnects, is dropped at once, so shutdown never waits on a connection that is not there. An ended one is left alone.

### `cache/`

A typed, schema-checked layer over [BentoCache](https://bentocache.dev), pinned to an exact version in `package.json`, with its own invalidation. `initCache(env, logger, redis?, { outbox? })` in [`cache/index.ts`](cache/index.ts) builds the store from `CACHE_STORE` and `CACHE_L1_ENABLED`, starts the outbox relay and, on Redis, the primary guard, and returns `{ cache, readinessChecks, close }`; [`server.ts`](../server.ts) calls it, and [`app.ts`](../app.ts) registers `cache` and `cacheOutbox` in the container. What it guarantees, and how to use it, is in the root [README](../../README.md#server-side-cache).

| File | Role |
|------|------|
| [`spec.ts`](cache/spec.ts) | `defineCacheSpec`: a name, a plain-JSON schema (hashed into every key), timing, tag builders and `clusterLockMs`. `encodeParts`: keys and tags as JSON arrays. Pure: no store, so any module may import a spec |
| [`client.ts`](cache/client.ts) | `createCache(…)`: `cache.entity(spec)` and `cache.invalidate`. Builds each key from the tags' versions, checks the schema on the way in and out, takes the key lock, counts `cache.lookups`. An entity works out its BentoCache timing once, when bound |
| [`versions.ts`](cache/versions.ts) | `TagVersions`: a token per tag, and `bump`. In memory, or on Redis with one script call that reads every token of a key and the epoch |
| [`primary.ts`](cache/primary.ts) | `PrimaryGuard`: ties the cache epoch to the `run_id` of the Redis server (read with `INFO`), keeps the cache unused until it has checked the server this connection talks to, and counts `cache.epoch.*` |
| [`lock.ts`](cache/lock.ts) | `KeyLock`: `SET NX PX` per key, released by a script only by its own token |
| [`outbox.ts`](cache/outbox.ts) | `CacheOutboxStore` (the port a database store implements: `claim`, `remove`, `backlog`), the memory outbox, and the relay that delivers it and reports `cache.outbox.*`. Every store must pass [`cacheOutboxContract`](../testing/cacheOutboxContract.ts): leases, limits, removal, backlog |
| [`errors.ts`](cache/errors.ts) | `CacheConfigError`: a spec, key, tag or option that can never work. `CacheLoadTimeoutError`: a loader past `hardTimeoutMs` |
| [`index.ts`](cache/index.ts) | `initCache` and the public exports |

- **Stores.** `memory`: one BentoCache memory layer of `CACHE_MEMORY_MAX_ENTRIES` entries, and the tag versions in a map of as many. `redis`: Redis through a connection of its own (`duplicateRedisClient`, with `CACHE_OP_TIMEOUT_MS` as its command timeout and auto-pipelining), shared by the values, the tag versions, the guard and the key lock; with `CACHE_L1_ENABLED`, a memory layer in front and BentoCache's Redis bus, on a publisher and a subscriber of its own. The bus connections queue commands while disconnected, unlike every other connection: BentoCache sends its `SUBSCRIBE` without awaiting it, so one that failed fast would be an unhandled rejection.
- **Where it departs from plain BentoCache, and why.**
  - *Versioned tags, not BentoCache's tags.* BentoCache marks an invalidation with the time it happened and an entry with the time it was written. Comparing the two needs every instance's clock to agree and no pause between a load's check and its write, and neither is guaranteed. A key built from the tags' tokens needs neither: invalidating moves the key. It also makes a hit two round trips however many tags it has, where BentoCache reads an entry's tags one after another, and keeps a memory layer right without the bus.
  - *Errors.* A loader's error comes back unchanged, not wrapped in `E_FACTORY_ERROR`; a load past `hardTimeoutMs` becomes `CacheLoadTimeoutError`, which the [cache converter](../errors/converter/cache.converter.ts) answers with a 503; any other failure on a read is logged, counted as `error`, and the loader runs.
  - *A lock across instances.* BentoCache's lock holds within one process. `clusterLockMs` adds one in Redis, taken inside the loader, so it costs nothing on a hit.
  - *No circuit breaker.* Commands already fail at once while disconnected, and a slow one is cut by its timeout; the breaker would instead skip writes silently.
- **Keys.** Values: `<SERVICE_NAME>:cache:<entity>:<schema hash>:<encoded key>:<tokens hash>`. Under `<SERVICE_NAME>:cache-v:`, the `epoch`, `tag:<tag>` for each token and `lock:<value key>`. Tags are `["user","one","u1"]`; an entity's `all` tag is `["user"]`, and every key includes it.
- **The scripts take their random values from the client.** Redis replicates a script by its effects since 5.0, but making none inside it keeps it valid under any replication mode.
- **`enabled: false` turns off reads and writes only.** The store is still built and invalidations still reach it. `CACHE_STORE=redis` with no client throws, enabled or not.
- **`close`** stops the relay after a last delivery, stops the guard, disconnects BentoCache and drops the cache's own connection. The shared client belongs to `server.ts`, which closes it last.

### `queue/`

A typed layer over [BullMQ](https://docs.bullmq.io) on Redis. What it guarantees, and how to use it, is in the root [README](../../README.md#background-jobs).

| File | Role |
|------|------|
| [`queue.ts`](queue/queue.ts) | `defineQueue`: a queue's name, its concurrency per process, and its rate limit across every process |
| [`schedule.ts`](queue/schedule.ts) | `defineSchedule`, and `syncJobSchedules`, which writes them at worker startup under a Redis lock, ordered by `SERVICE_VERSION` so an older deploy never undoes a newer one's |
| [`job.ts`](queue/job.ts) | `defineJob`: a job's name, queue, plain-JSON payload schema and policy (attempts, backoff, timeout, payload size). `checkPayloadSize`: the payload's JSON bytes, as BullMQ counts them. `retryDelay`: exponential backoff with full jitter, capped |
| [`producer.ts`](queue/producer.ts) | `jobs.enqueue`: checks the payload and the `jobId`, adds the job with its policy, rejects within 2 s when Redis does not take it |
| [`worker.ts`](queue/worker.ts) | `handleJob` and `startJobWorkers`: one BullMQ worker per queue, the payload checked again, the timeout, permanent errors, shutdown that puts running jobs back, the `jobs.*` metrics |
| [`redis.ts`](queue/redis.ts) | `checkQueueRedis`: the Redis version, `maxmemory-policy noeviction` and AOF, checked by the worker at startup |
| [`health.ts`](queue/health.ts) | The worker process's `/health/live` and `/health/ready` |
| [`admin.ts`](queue/admin.ts) | `listFailedJobs`, `retryFailedJobs`, `listSchedules`, `removeSchedule` and `runJobsAdmin`: the `pnpm jobs` command ([`src/jobsAdmin.ts`](../jobsAdmin.ts)) |
| [`errors.ts`](queue/errors.ts) | `JobConfigError`, `PermanentJobError`, `JobTimeoutError`, and `JobsUnavailableError` and `JobEnqueueError`, which the [queue converter](../errors/converter/queue.converter.ts) answers with a 503 |
| [`index.ts`](queue/index.ts) | `initJobs` (the API's producer), `connectWorkerRedis`, and the public exports |

- **Connections.** The API's producer opens one connection (to `QUEUE_REDIS_URL`, else `REDIS_URL`) that fails fast while disconnected, shared by every queue it adds to. A worker opens one with `maxRetriesPerRequest: null`, which BullMQ requires for its blocking reads, and BullMQ adds a blocking connection per queue.
- **Where it departs from plain BullMQ, and why.**
  - *Backoff.* BullMQ's exponential backoff has no cap, and its jitter only shaves the top; the jobs' own `policy` backoff is capped and spread over the whole range.
  - *Shutdown.* A second `close(true)` does not force anything in BullMQ 6: it returns the close already under way. Past `WORKER_SHUTDOWN_TIMEOUT_MS` the layer cancels the running jobs (`cancelAllJobs`) and each one is returned to the queue (`moveToWait`) without spending an attempt.
  - *Version check.* BullMQ checks the Redis version with `console.warn`. The queues are created with `skipVersionCheck`, and `checkQueueRedis` checks the same versions through the logger, with the eviction policy and AOF.
- **Waiting time.** BullMQ resets a job's `delay` once it passes and records nothing for when a job became waiting; the layer measures from `timestamp + opts.delay`, which it keeps.
- **Ids.** BullMQ refuses a custom `jobId` with a `:` or made only of digits; `enqueue` checks it first and says so.

### `telemetry/`

The OpenTelemetry SDK, started by the preload [`src/instrumentation.ts`](../instrumentation.ts) before the app is imported. What it records and how to configure it is in the root [README](../../README.md#observability).

- [`index.ts`](telemetry/index.ts): `startTelemetry()` builds the SDK from [`telemetryConfig`](../config/telemetry.config.ts) and the instrumentation list (HTTP, Express, Redis, pino, Node runtime). It is the only file that imports the SDK, and only the preload imports it, so a process with telemetry off loads none of it.
- [`state.ts`](telemetry/state.ts): `isTelemetryStarted()` and `shutdownTelemetry()`, which import no SDK. `server.ts` uses the first to warn when a destination is set but the preload was not, and runs the second as its last shutdown hook, so the spans of the drained requests are flushed.

Lint enforces the split: outside this folder and the preload, the only OpenTelemetry package a file may import is `@opentelemetry/api`, which records nothing until the SDK runs. Code that adds its own spans or metrics uses that.

- **Instrumentation must be loaded before what it patches.** A module imported before the SDK started is not traced, which is why this cannot be started from `server.ts`. An instrumentation added to the list also needs its package to be imported after the preload, which every app module is.
- **Each instrumentation's options are a choice about data.** The Redis serializer records the command name only, because arguments hold token ids and client IPs; replace it with care. The end-to-end test in [`index.test.ts`](telemetry/index.test.ts) fails if a password, refresh token or token id appears in what is exported.

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
