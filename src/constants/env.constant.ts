const list = (value: string | undefined, fallback: string): string[] =>
  (value ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const trustProxy = (value: string | undefined): boolean | number | string => {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0) return n;
  return value; // "loopback", a subnet, or a comma list — Express parses these
};

const ENV_CONSTANTS = {
  ENV: process.env.NODE_ENV || 'development',
  // Opt-in, not derived from ENV: an unset NODE_ENV must not send stack traces to clients.
  EXPOSE_ERROR_STACK: process.env.NODE_ENV === 'development',
  PORT: Number(process.env.PORT || '8000'),
  SERVICE_NAME: process.env.SERVICE_NAME || process.env.npm_package_name || 'app',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_PRETTY: process.env.LOG_PRETTY === 'true',
  LOG_IGNORE_PATHS: list(process.env.LOG_IGNORE_PATHS, '/health,/favicon.ico'),
  LOG_SLOW_MS: Number(process.env.LOG_SLOW_MS || 1000),
  SHUTDOWN_TIMEOUT_MS: Number(process.env.SHUTDOWN_TIMEOUT_MS || 8000),
  SHUTDOWN_DELAY_MS: Number(process.env.SHUTDOWN_DELAY_MS || 5000),
  TRUST_PROXY: trustProxy(process.env.TRUST_PROXY),
};

export default ENV_CONSTANTS;
