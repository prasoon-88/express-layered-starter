import { concatenateStrings } from '#utils/concatenateStrings.util';
import { ContainerError } from './errors.ts';
import type { Factory, Get, Key, Registry } from './registry.ts';

type Entry = { factory: Factory<Key>; owner: string };

const isThenable = (value: unknown) =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function';

/**
 * One instance per key, built the first time it is asked for. Providers are synchronous: anything
 * that must connect first (Redis, a database pool) is opened before the container and registered
 * as a ready value. Request-scoped state does not belong here; it lives in `contexts/`.
 */
export const createContainer = () => {
  const entries = new Map<Key, Entry>();
  const instances = new Map<Key, unknown>();
  const resolving: Key[] = [];
  let sealed = false;

  const provide = <K extends Key>(key: K, factory: Factory<K>, owner = 'app') => {
    if (sealed)
      throw new ContainerError(
        `Cannot register "${key}": providers must be registered before anything is resolved`,
      );
    if (typeof factory !== 'function')
      throw new ContainerError(`Provider "${key}" must be a function`);

    const existing = entries.get(key);
    if (existing)
      throw new ContainerError(
        `Provider "${key}" is registered by both "${existing.owner}" and "${owner}"`,
      );

    entries.set(key, { factory: factory as Factory<Key>, owner });
  };

  const get: Get = <K extends Key>(key: K): Registry[K] => {
    sealed = true;
    if (instances.has(key)) return instances.get(key) as Registry[K];

    const entry = entries.get(key);
    if (!entry)
      throw new ContainerError(
        resolving.length
          ? `No provider for "${key}" (needed by ${concatenateStrings(resolving, ' -> ')})`
          : `No provider for "${key}"`,
      );
    if (resolving.includes(key))
      throw new ContainerError(
        `Circular dependency: ${concatenateStrings([...resolving, key], ' -> ')}`,
      );

    resolving.push(key);
    try {
      const value: unknown = entry.factory(get);
      if (value === undefined) throw new ContainerError(`Provider "${key}" returned undefined`);
      if (isThenable(value))
        throw new ContainerError(
          `Provider "${key}" returned a promise: create async resources before the container and register the result`,
        );
      instances.set(key, value);
      return value as Registry[K];
    } finally {
      resolving.pop();
    }
  };

  const has = (key: Key) => entries.has(key);

  return { provide, get, has };
};

export type Container = ReturnType<typeof createContainer>;
