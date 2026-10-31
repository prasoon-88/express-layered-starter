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

Owns how the process starts failing and stopping. `registerProcessHandler` is called **once**, from [`server.js`](../server.js), right after `app.listen()`:

```js
import { registerProcessHandler } from '#lib/lifecycle/index.js'

const server = app.listen(PORT)

registerProcessHandler({
    server,
    hooks: [],        // cleanup run after the server drains, e.g. () => mongoose.disconnect()
})
```

It listens for five things and sends all of them through one shutdown path:

| Trigger | Log level | Exit code |
|---------|-----------|-----------|
| `SIGINT` / `SIGTERM` (you or the platform asking to stop) | `info` | `0` |
| `uncaughtException` | `fatal` | `1` |
| `unhandledRejection` | `fatal` | `1` |
| `server` `'error'` (e.g. `EADDRINUSE`) | `fatal` | `1` |

The shutdown path: arm the force-exit timer, stop accepting connections and let in-flight requests finish, run the `hooks` in order, then exit. A hook that throws is logged and turns the exit code into `1`, but the remaining hooks still run. A second signal while shutting down exits immediately.

`SHUTDOWN_TIMEOUT_MS` (default `8000`) is the force-exit deadline. Keep it **below your platform's kill deadline** — Docker's is 10 seconds. When it fires, active connections are cut and the process exits `1`.

Call it once. Registering twice installs every handler twice. And don't call it from `app.js` or tests: importing the app must not attach handlers to the test runner's process.

For tests, `proc` and `exit` can be injected, so a fake emitter and a spy replace `process` and `process.exit`.

> On Windows, `npm run dev` puts a `cmd` layer in front of Node that intercepts Ctrl+C ("Terminate batch job?"). To exercise the signal path, run `node --env-file=.env src/server.js` directly, or use WSL or Docker.

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
