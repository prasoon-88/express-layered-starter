# config/

**Responsibility:** Centralize all app settings — tunable values that may differ per environment. Code reads settings from here, never from `process.env` directly.

## What goes here
- Server settings: `PORT`, `BASE_URL`, `NODE_ENV`
- Database config: connection URL, name, options
- Auth config: JWT secret (from env), token expiry, salt rounds
- Third-party service config: mail, storage, payment
- Defaults for env vars (`process.env.PORT || 3000`)

## What does NOT go here
- ❌ Fixed values that never change per environment (that's `constants/`)
- ❌ Business logic or functions that *do* things
- ❌ **Hardcoded secrets** — secrets live in `.env`; config only *reads* them

## The layering
```
.env        → actual secret values (gitignored)
  ↓ process.env.X
config/     → reads env, adds defaults, organizes   ← YOU ARE HERE
  ↓ CONFIG.X.Y
your code   → never touches process.env directly
```

## Example
```js
// config/auth.config.js
const AUTH_CONFIG = {
    JWT_SECRET: process.env.JWT_SECRET,       // from .env, never hardcoded
    JWT_EXPIRES_IN: '7d',
    SALT_ROUNDS: 10,
}
export default AUTH_CONFIG

// config/index.js — one entry point for all config
import AUTH from './auth.config.js'
import DB from './db.config.js'
const CONFIG = { AUTH, DB }
export default CONFIG
```

## Rule of thumb
> Config = tunable settings (might differ dev vs prod). Can import from `constants/`, but `constants/` must never import from config. Never commit a secret here — read it from `.env`.
