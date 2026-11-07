export const HTTP_HEADERS = Object.freeze({
  // General
  CACHE_CONTROL: 'Cache-Control',
  CONNECTION: 'Connection',
  DATE: 'Date',
  VARY: 'Vary',
  VIA: 'Via',

  // Request
  ACCEPT: 'Accept',
  ACCEPT_ENCODING: 'Accept-Encoding',
  ACCEPT_LANGUAGE: 'Accept-Language',
  AUTHORIZATION: 'Authorization',
  COOKIE: 'Cookie',
  HOST: 'Host',
  ORIGIN: 'Origin',
  REFERER: 'Referer',
  USER_AGENT: 'User-Agent',
  X_FORWARDED_FOR: 'X-Forwarded-For',
  X_REQUESTED_WITH: 'X-Requested-With',
  IF_MODIFIED_SINCE: 'If-Modified-Since',
  IF_NONE_MATCH: 'If-None-Match',
  IDEMPOTENCY_KEY: 'Idempotency-Key',

  // Request / response body
  CONTENT_TYPE: 'Content-Type',
  CONTENT_LENGTH: 'Content-Length',
  CONTENT_ENCODING: 'Content-Encoding',
  CONTENT_DISPOSITION: 'Content-Disposition',

  // Response
  ETAG: 'ETag',
  EXPIRES: 'Expires',
  LAST_MODIFIED: 'Last-Modified',
  LOCATION: 'Location',
  RETRY_AFTER: 'Retry-After',
  SET_COOKIE: 'Set-Cookie',
  WWW_AUTHENTICATE: 'WWW-Authenticate',
  ALLOW: 'Allow',
  RATE_LIMIT_POLICY: 'RateLimit-Policy',
  RATE_LIMIT: 'RateLimit',
  IDEMPOTENT_REPLAYED: 'Idempotent-Replayed',

  // CORS
  ACCESS_CONTROL_ALLOW_ORIGIN: 'Access-Control-Allow-Origin',
  ACCESS_CONTROL_ALLOW_METHODS: 'Access-Control-Allow-Methods',
  ACCESS_CONTROL_ALLOW_HEADERS: 'Access-Control-Allow-Headers',
  ACCESS_CONTROL_ALLOW_CREDENTIALS: 'Access-Control-Allow-Credentials',
  ACCESS_CONTROL_EXPOSE_HEADERS: 'Access-Control-Expose-Headers',
  ACCESS_CONTROL_MAX_AGE: 'Access-Control-Max-Age',

  // Security
  STRICT_TRANSPORT_SECURITY: 'Strict-Transport-Security',
  CONTENT_SECURITY_POLICY: 'Content-Security-Policy',
  X_CONTENT_TYPE_OPTIONS: 'X-Content-Type-Options',
  X_FRAME_OPTIONS: 'X-Frame-Options',
  REFERRER_POLICY: 'Referrer-Policy',

  // Rate limiting (common conventions)
  X_RATE_LIMIT_LIMIT: 'X-RateLimit-Limit',
  X_RATE_LIMIT_REMAINING: 'X-RateLimit-Remaining',
  X_RATE_LIMIT_RESET: 'X-RateLimit-Reset',

  // Custom
  X_REQUEST_ID: 'X-Request-Id',
});

export const CONTENT_TYPES = Object.freeze({
  JSON: 'application/json',
  TEXT: 'text/plain',
  HTML: 'text/html',
  XML: 'application/xml',
  FORM_URLENCODED: 'application/x-www-form-urlencoded',
  MULTIPART_FORM_DATA: 'multipart/form-data',
  PDF: 'application/pdf',
  OCTET_STREAM: 'application/octet-stream',
});

/** `Cache-Control` directives. One that takes seconds is written `max-age=60`. */
export const CACHE_CONTROL = Object.freeze({
  NO_STORE: 'no-store',
  NO_CACHE: 'no-cache',
  PUBLIC: 'public',
  PRIVATE: 'private',
  MAX_AGE: 'max-age',
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate',
});

export const CORS_DEFAULT_HEADERS = [
  HTTP_HEADERS.CONTENT_TYPE,
  HTTP_HEADERS.AUTHORIZATION,
  HTTP_HEADERS.IDEMPOTENCY_KEY,
];

// Browsers hide non-standard response headers from page JS unless listed here.
export const CORS_DEFAULT_EXPOSED_HEADERS = [
  HTTP_HEADERS.X_REQUEST_ID,
  HTTP_HEADERS.IDEMPOTENT_REPLAYED,
];
