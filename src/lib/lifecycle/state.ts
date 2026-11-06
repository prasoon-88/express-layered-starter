let shuttingDown = false;

export const lifecycleState = Object.freeze({
  isShuttingDown: () => shuttingDown,
  markShutdown: () => {
    shuttingDown = true;
  },
});
