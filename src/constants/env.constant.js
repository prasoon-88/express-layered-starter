const list = (value, fallback) => (value ?? fallback).split(',').map((s)=>s.trim()).filter(Boolean)

const ENV_CONSTANTS = {
    ENV: process.env.NODE_ENV || 'development',
    PORT: Number(process.env.PORT || '8000'),
    SERVICE_NAME: process.env.SERVICE_NAME || process.env.npm_package_name || 'app',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_PRETTY: process.env.LOG_PRETTY === 'true',
    LOG_IGNORE_PATHS: list(process.env.LOG_IGNORE_PATHS, "/health,/favicon.ico"),
    LOG_SLOW_MS: Number(process.env.LOG_SLOW_MS || 1000),
    SHUTDOWN_TIMEOUT_MS: Number(process.env.SHUTDOWN_TIMEOUT_MS || 8000)
}

export default ENV_CONSTANTS