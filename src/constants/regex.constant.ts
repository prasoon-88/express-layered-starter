export const REGEX = Object.freeze({
  SAFE_ID: /^[a-zA-Z0-9_-]{1,128}$/,
  REDIS_URL: /^rediss?:\/\//,
  IDEMPOTENCY_KEY: /^[A-Za-z0-9_-]{8,255}$/,
  // RFC 6750 b64token after the scheme, which is case-insensitive. Exactly one space between them.
  BEARER: /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i,
  // `<id>.<secret>`: 16 and 32 random bytes, base64url without padding.
  REFRESH_TOKEN: /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/,
});
