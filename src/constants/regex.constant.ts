const REGEX = {
  SAFE_ID: /^[a-zA-Z0-9_-]{1,128}$/,
  REDIS_URL: /^rediss?:\/\//,
  IDEMPOTENCY_KEY: /^[A-Za-z0-9_-]{8,255}$/,
};

export default REGEX;
