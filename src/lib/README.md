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
