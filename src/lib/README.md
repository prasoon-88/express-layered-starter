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
| Example | `logger/`, `mailer.js`, `s3.js` | `slugify()`, `paginator` |

## What's here

### `logger/`

A [pino](https://getpino.io/) instance configured from [`config/logger.config.js`](../config/logger.config.js):

- **Structured JSON** in production, pretty-printed in development (falls back to JSON if `pino-pretty` isn't installed, rather than crashing)
- **Automatic request IDs** via a `mixin` that reads [`contexts/requestContext.js`](../contexts/requestContext.js) — no `req` passed anywhere
- **Redaction** of passwords, tokens, cookies, and auth headers before they ever reach a log sink
- **Base fields** on every line: service, env, pid, hostname

Use a child logger per file so every line says where it came from:

```js
import { getLogger } from '#lib/logger/index.js'

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
| `index.js` | `registerProcessHandler` — the signal, crash and shutdown logic |
| `state.js` | `lifecycleState` — the shutdown flag, published so other code can read it |

Call `registerProcessHandler` **once**, from [`server.js`](../server.js), right after `app.listen()`:

```js
import { registerProcessHandler } from '#lib/lifecycle/index.js'

const server = app.listen(PORT)

registerProcessHandler({
    server,
    hooks: [],        // cleanup run after the server drains, e.g. () => mongoose.disconnect()
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

`lifecycleState.isShuttingDown()` is `true` from the moment shutdown starts. Anything that needs to answer "are we stopping?" reads it — the readiness endpoint ([`routes/health/`](../routes/health/)) returns `503` while it is `true`, which tells the load balancer to stop routing here. Only `lifecycle/index.js` calls `markShutdown()`.

The flag is process-wide, so a second `registerProcessHandler` call in the same process sees it as already set. Exercise each scenario in its own process until the module keeps its own local flag.

#### Where to call it

Call it once. Registering twice installs every handler twice. Don't call it from `app.js` or from tests: importing the app must not attach signal handlers to the test runner's process.

> On Windows, `npm run dev` puts a `cmd` layer in front of Node that intercepts Ctrl+C ("Terminate batch job?"). To exercise the signal path, run `node --env-file=.env src/server.js` directly, or use WSL or Docker. `SIGTERM` is not delivered normally on Windows, so test that path in Docker or WSL.

## Adding a client

Export something configured and ready to use. Read settings from `config/`, never from `process.env` directly:

```js
// lib/mailer.js
import nodemailer from 'nodemailer'
import { mailerConfig } from '#config/mailer.config.js'

const transport = nodemailer.createTransport(mailerConfig)

export const sendMail = ({ to, subject, html }) =>
    transport.sendMail({ from: mailerConfig.from, to, subject, html })
```

The service calls `sendMail(...)` and stays ignorant of nodemailer. Swapping providers touches one file.

## Rule of thumb

> If it needs credentials, a connection, or a third-party package to work, it's a lib. If it's a function you could copy into any project unchanged, it's a util.
