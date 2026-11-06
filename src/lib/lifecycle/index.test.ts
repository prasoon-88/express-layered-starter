import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import pino from 'pino';

process.env.NODE_ENV ??= 'test';

const { registerProcessHandler } = await import('./index.ts');
const { lifecycleState } = await import('./state.ts');

const logger = pino({ level: 'silent' });

class FakeServer extends EventEmitter {
  closed = false;
  forced = false;

  close(callback: (err?: Error) => void) {
    this.closed = true;
    callback();
  }
  closeIdleConnections() {}
  closeAllConnections() {
    this.forced = true;
  }
}

const setup = (options: Partial<Parameters<typeof registerProcessHandler>[0]> = {}) => {
  const server = new FakeServer();
  const proc = new EventEmitter();
  const exits: number[] = [];
  const handler = registerProcessHandler({
    server: server as unknown as Server,
    proc,
    logger,
    timeoutMs: 5_000,
    drainDelayMs: 0,
    exit: (code) => exits.push(code),
    ...options,
  });
  return { server, proc, exits, handler };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('registerProcessHandler', () => {
  it('refuses a drain delay that is not shorter than the shutdown timeout', () => {
    assert.throws(() => setup({ timeoutMs: 1_000, drainDelayMs: 1_000 }), RangeError);
    assert.throws(() => setup({ timeoutMs: 1_000, drainDelayMs: 5_000 }), RangeError);
  });

  // The shutting-down flag is module state and can only be set once per process,
  // so everything that depends on a shutdown happens in this one test, in order.
  it('on SIGTERM closes the server, runs every hook in order even when one fails, and exits 1', async () => {
    const order: string[] = [];
    const { server, proc, exits } = setup({
      hooks: [
        () => {
          order.push('first');
        },
        () => {
          order.push('second');
          throw new Error('hook failed');
        },
        async () => {
          await Promise.resolve();
          order.push('third');
        },
      ],
    });

    assert.equal(lifecycleState.isShuttingDown(), false);

    proc.emit('SIGTERM', 'SIGTERM');
    await settle();

    assert.equal(server.closed, true);
    assert.deepEqual(order, ['first', 'second', 'third']);
    assert.equal(lifecycleState.isShuttingDown(), true);
    assert.deepEqual(exits, [1], 'a failing hook makes the exit code 1');

    // A second signal while stopping means "now": exit at once without starting another shutdown.
    proc.emit('SIGINT', 'SIGINT');
    assert.deepEqual(exits, [1, 1]);
  });
});
