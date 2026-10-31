let shuttingDown = false;

const lifecycleState = Object.freeze({
  isShuttingDown: () => shuttingDown,
  markShutdown: () => {
    shuttingDown = true;
  },
});

export default lifecycleState;
