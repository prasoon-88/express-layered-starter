# config/

**Responsibility:** Centralize all app settings — tunable values that may differ per environment. Code reads settings from here, never from `process.env` directly.

## What goes here
- Server settings: `PORT`, `BASE_URL`, `NODE_ENV`
- Database config: connection URL, name, options
- Third-party service config: mail, storage, payment
- Settings derived from env values, such as the logger's `pretty` from `NODE_ENV` (each variable's default is declared once, in `constants/env/schema.ts`)

## What does NOT go here
- ❌ Fixed values that never change per environment (that's `constants/`)
- ❌ Business logic or functions that *do* things
- ❌ **Hardcoded secrets** — secrets live in `.env`; config only *reads* them

## The layering
```
.env                      actual values (gitignored)
  ↓ process.env.X
constants/env/            reads process.env once, validates it (Zod), applies defaults, coerces types
  ↓ ENV_CONSTANTS.X
config/                   shapes it into a settings object per concern   ← YOU ARE HERE
  ↓ someConfig.x
your code                 never touches process.env directly
```

Note the extra step: **`constants/env/` is the only place in the app that reads `process.env`.** Config files import from it rather than reaching for the environment themselves, so every variable has exactly one declared default and one place to look it up.

**The one exception is OpenTelemetry's `OTEL_*` variables.** They are a cross-language standard, and the SDK reads and validates them itself, so declaring them in the app's schema would give each one two parsers that could disagree. [`telemetry.config.ts`](telemetry.config.ts) reads them only to decide whether a destination is set, through `resolveTelemetryConfig(env, service)`, which takes the environment as an argument and is tested with plain objects.

## Example
```js
// config/mailer.config.ts
import { ENV_CONSTANTS } from '#constants/env/index'

export const mailerConfig = Object.freeze({
    host: ENV_CONSTANTS.SMTP_HOST,
    password: ENV_CONSTANTS.SMTP_PASSWORD,    // from .env, never hardcoded
    from: 'no-reply@example.com',
})
```

Module-level config like this suits settings read at import time, such as the logger's. A feature wired by a module reads the env through the container instead (`get('env')` in a provider): auth takes `JWT_SECRET` and the token lifetimes that way, so each test app can use its own values.

The convention here: one file per concern (`logger.config.ts`, `mailer.config.ts`), a named `Object.freeze`d export, `camelCase` keys. Frozen because a setting that can be reassigned at runtime is a bug waiting to happen.

See [`logger.config.ts`](logger.config.ts) for a working example — it derives `pretty` from the environment and holds the list of field names the logger redacts. [`lifecycle.config.ts`](lifecycle.config.ts) is the minimal case: two shutdown timings, nothing else.

## Rule of thumb
> Config = tunable settings (might differ dev vs prod). Can import from `constants/`, but `constants/` must never import from config. Never commit a secret here — read it from `.env`.
