import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createContainer } from './container.ts';
import { ContainerError } from './errors.ts';

declare module './registry.ts' {
  interface Registry {
    testClock: { now: () => number };
    testGreeter: { greet: () => string };
    testCycleA: string;
    testCycleB: string;
  }
}

const rejectsWith = (fn: () => unknown, message: RegExp) =>
  assert.throws(fn, (err: unknown) => err instanceof ContainerError && message.test(err.message));

describe('createContainer', () => {
  it('builds a provider once and hands every caller the same instance', () => {
    const container = createContainer();
    let built = 0;
    container.provide('testClock', () => {
      built += 1;
      return { now: () => 1 };
    });

    assert.equal(container.get('testClock'), container.get('testClock'));
    assert.equal(built, 1);
  });

  it('builds nothing until it is asked for', () => {
    const container = createContainer();
    let built = false;
    container.provide('testClock', () => {
      built = true;
      return { now: () => 1 };
    });

    assert.equal(built, false);
  });

  it('lets a provider ask for what it depends on', () => {
    const container = createContainer();
    container.provide('testClock', () => ({ now: () => 7 }));
    container.provide('testGreeter', (get) => ({ greet: () => `at ${get('testClock').now()}` }));

    assert.equal(container.get('testGreeter').greet(), 'at 7');
  });

  it('names the missing key', () => {
    rejectsWith(() => createContainer().get('testClock'), /No provider for "testClock"$/);
  });

  it('names the chain that needed a missing key', () => {
    const container = createContainer();
    container.provide('testGreeter', (get) => {
      const clock = get('testClock');
      return { greet: () => String(clock.now()) };
    });
    container.provide('testCycleA', (get) => get('testGreeter').greet());

    rejectsWith(
      () => container.get('testCycleA'),
      /No provider for "testClock" \(needed by testCycleA -> testGreeter\)/,
    );
  });

  it('names every key in a circular dependency', () => {
    const container = createContainer();
    container.provide('testCycleA', (get) => get('testCycleB'));
    container.provide('testCycleB', (get) => get('testCycleA'));

    rejectsWith(
      () => container.get('testCycleA'),
      /Circular dependency: testCycleA -> testCycleB -> testCycleA/,
    );
  });

  it('refuses a key that two owners register, naming both', () => {
    const container = createContainer();
    container.provide('testClock', () => ({ now: () => 1 }), 'billing');

    rejectsWith(
      () => container.provide('testClock', () => ({ now: () => 2 }), 'user'),
      /"testClock" is registered by both "billing" and "user"/,
    );
  });

  it('refuses new providers once anything has been resolved', () => {
    const container = createContainer();
    container.provide('testClock', () => ({ now: () => 1 }));
    container.get('testClock');

    rejectsWith(
      () => container.provide('testGreeter', () => ({ greet: () => 'late' })),
      /registered before anything is resolved/,
    );
  });

  it('refuses a provider that is not a function', () => {
    rejectsWith(
      () => createContainer().provide('testClock', { now: () => 1 } as never),
      /"testClock" must be a function/,
    );
  });

  it('refuses a provider that returns undefined', () => {
    const container = createContainer();
    container.provide('testClock', () => undefined as never);

    rejectsWith(() => container.get('testClock'), /"testClock" returned undefined/);
  });

  it('refuses a provider that returns a promise', () => {
    const container = createContainer();
    container.provide('testClock', () => Promise.resolve({ now: () => 1 }) as never);

    rejectsWith(() => container.get('testClock'), /"testClock" returned a promise/);
  });

  it('reports the same error again after a provider throws, not a false cycle', () => {
    const container = createContainer();
    container.provide('testClock', () => {
      throw new Error('clock is broken');
    });

    assert.throws(() => container.get('testClock'), /clock is broken/);
    assert.throws(() => container.get('testClock'), /clock is broken/);
  });

  it('tells whether a key has a provider', () => {
    const container = createContainer();
    container.provide('testClock', () => ({ now: () => 1 }));

    assert.equal(container.has('testClock'), true);
    assert.equal(container.has('testGreeter'), false);
  });
});
