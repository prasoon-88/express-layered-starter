import ENV_CONSTANTS from '#constants/env.constant.js';

export const lifecycleConfig = Object.freeze({
  shutdownTimeoutMs: ENV_CONSTANTS.SHUTDOWN_TIMEOUT_MS,
  drainDelayMs: ENV_CONSTANTS.SHUTDOWN_DELAY_MS,
});
