import ENV_CONSTANTS from '#constants/env.constant';

export const lifecycleConfig = Object.freeze({
  shutdownTimeoutMs: ENV_CONSTANTS.SHUTDOWN_TIMEOUT_MS,
  drainDelayMs: ENV_CONSTANTS.SHUTDOWN_DELAY_MS,
});
