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
.env                      actual values (gitignored)
  ↓ process.env.X
constants/env.constant.js reads process.env once, applies defaults, coerces types
  ↓ ENV_CONSTANTS.X
config/                   shapes it into a settings object per concern   ← YOU ARE HERE
  ↓ someConfig.x
your code                 never touches process.env directly
```

Note the extra step: **`env.constant.js` is the only file in the app that reads `process.env`.** Config files import from it rather than reaching for the environment themselves, so every variable has exactly one declared default and one place to look it up.

## Example
```js
// config/auth.config.js
import ENV_CONSTANTS from '#constants/env.constant.js'

export const authConfig = Object.freeze({
    jwtSecret: ENV_CONSTANTS.JWT_SECRET,      // from .env, never hardcoded
    jwtExpiresIn: '7d',
    saltRounds: 10,
})
```

The convention here: one file per concern (`logger.config.js`, `auth.config.js`), a named `Object.freeze`d export, `camelCase` keys. Frozen because a setting that can be reassigned at runtime is a bug waiting to happen.

See [`logger.config.js`](logger.config.js) for a working example — it derives `pretty` from the environment and holds the list of field names the logger redacts.

## Rule of thumb
> Config = tunable settings (might differ dev vs prod). Can import from `constants/`, but `constants/` must never import from config. Never commit a secret here — read it from `.env`.
