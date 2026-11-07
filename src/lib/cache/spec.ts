import { createHash } from 'node:crypto';
import * as z from 'zod';
import { CacheConfigError } from './errors.ts';

/** What a key or a tag is built from. Objects are refused: their key order would split one key in two. */
export type KeyPart = string | number | boolean;

/**
 * An invalidation handle, made only by a spec's `tags` functions. `Entity` is the spec's name, so
 * an entity's `invalidate` accepts its own tags only, and `cache.invalidate` accepts any.
 */
export type CacheTag<Entity extends string = string> = string & {
  readonly [cacheTagBrand]: Entity;
};
declare const cacheTagBrand: unique symbol;

type TagBuilders = Record<string, (...args: never[]) => readonly KeyPart[]>;

/** The generated tag functions: one per declared builder, plus `all`. */
export type SpecTags<Name extends string, Tags extends TagBuilders> = {
  readonly [K in keyof Tags]: (...args: Parameters<Tags[K]>) => CacheTag<Name>;
} & {
  /** Every entry of this entity: each one carries it. */
  readonly all: () => CacheTag<Name>;
};

/** How long an entity's values live, and how long a caller waits for its loader. */
export type CacheTiming = {
  /** Seconds a value is fresh. */
  ttlS: number;
  /**
   * Seconds past `ttlS` a value may still be served: while it is refreshed in the background, or
   * when the loader fails. 0 (the default) never serves a value past its ttl. An invalidated
   * value counts as stale too, so leave this at 0 where a write must be read back at once.
   */
  staleS?: number;
  /** With `staleS`: how long to wait for the loader before serving the stale value. 0 = at once. */
  softTimeoutMs?: number;
  /** The longest a caller waits for the loader; past it the query rejects. */
  hardTimeoutMs?: number;
};

export type CacheSpec<
  Name extends string = string,
  Schema extends z.ZodType = z.ZodType,
  Tags extends TagBuilders = TagBuilders,
> = {
  /** The entity's namespace in keys, tags, metrics and logs. */
  readonly name: Name;
  readonly schema: Schema;
  /** A hash of the schema, part of every key: a deploy that changes the schema starts afresh. */
  readonly version: string;
  readonly timing: Readonly<CacheTiming>;
  readonly tags: SpecTags<Name, Tags>;
  /** With a Redis store: a miss is loaded by one instance at a time, the others waiting this long. */
  readonly clusterLockMs: number | undefined;
};

export type AnyCacheSpec = CacheSpec<string, z.ZodType, TagBuilders>;

/** What the entity's schema produces: what a query returns. */
export type SpecOutput<S extends AnyCacheSpec> = z.output<S['schema']>;

type SpecDefinition<Name extends string, Schema extends z.ZodType, Tags extends TagBuilders> = {
  /** Letters, digits, `_` and `-`, starting with a letter. Unique per kind of data. */
  name: Name;
  /**
   * What a cached value must match, on the way in and on the way out. Fields it does not list
   * never reach the store. It must describe plain JSON: no dates, bigints or transforms.
   */
  schema: Schema;
  /** What the entity can be invalidated by besides `all`. */
  tags?: Tags;
  /**
   * With a Redis store: a miss is loaded by one instance, which takes a lock per key; the others
   * wait up to this long for its value, then load it themselves. One more round trip per miss, so
   * set it for a key that is hot and slow to load, where many instances would miss it at once.
   */
  clusterLockMs?: number;
} & CacheTiming;

const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const VERSION_LENGTH = 12;

const isKeyPart = (part: unknown): part is KeyPart =>
  typeof part === 'string' ||
  typeof part === 'boolean' ||
  (typeof part === 'number' && Number.isFinite(part));

/** A JSON array of the parts: one string for every list of parts, never the same for two. */
export const encodeParts = (parts: readonly unknown[]): string => {
  if (parts.length === 0) throw new CacheConfigError('A cache key or tag needs at least one part');
  for (const part of parts)
    if (!isKeyPart(part))
      throw new CacheConfigError(
        `A cache key or tag part must be a string, a finite number or a boolean, got ${String(part)}`,
      );
  return JSON.stringify(parts);
};

const checkWhole = (name: string, field: string, value: number | undefined, min: number) => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < min))
    throw new CacheConfigError(
      `Cache "${name}": ${field} must be a whole number of at least ${min}, got ${value}`,
    );
};

export const checkTiming = (name: string, timing: Partial<CacheTiming>) => {
  checkWhole(name, 'ttlS', timing.ttlS, 1);
  checkWhole(name, 'staleS', timing.staleS, 0);
  checkWhole(name, 'softTimeoutMs', timing.softTimeoutMs, 0);
  checkWhole(name, 'hardTimeoutMs', timing.hardTimeoutMs, 1);
};

/**
 * A hash of the JSON Schema of what the schema outputs. Building it also proves the schema
 * describes plain JSON, which is what makes a hit return exactly what the miss returned.
 */
const schemaVersion = (name: string, schema: z.ZodType) => {
  let shape: unknown;
  try {
    shape = z.toJSONSchema(schema, { io: 'output' });
  } catch (cause) {
    throw new CacheConfigError(
      `Cache "${name}": the schema must describe plain JSON (no dates, bigints or transforms), since values are stored as JSON`,
      { cause },
    );
  }
  return createHash('sha256')
    .update(JSON.stringify(shape))
    .digest('base64url')
    .slice(0, VERSION_LENGTH);
};

/**
 * Describes one kind of cached data: its schema, its timing and its tags. Pure: it touches no
 * store, so any module can import a spec and use its tags. A cache binds it with `cache.entity`.
 */
export const defineCacheSpec = <
  const Name extends string,
  Schema extends z.ZodType,
  Tags extends TagBuilders = Record<never, never>,
>({
  name,
  schema,
  tags: builders = {} as Tags,
  clusterLockMs,
  ...timing
}: SpecDefinition<Name, Schema, Tags>): CacheSpec<Name, Schema, Tags> => {
  if (typeof name !== 'string' || !NAME.test(name))
    throw new CacheConfigError(
      `Cache name must be letters, digits, _ or -, starting with a letter: ${JSON.stringify(name)}`,
    );
  checkTiming(name, timing);
  checkWhole(name, 'clusterLockMs', clusterLockMs, 1);

  const tags: Record<string, (...args: never[]) => string> = {
    all: () => encodeParts([name]),
  };
  for (const [tagName, build] of Object.entries(builders)) {
    if (tagName === 'all')
      throw new CacheConfigError(`Cache "${name}": "all" is a tag every entity already has`);
    tags[tagName] = (...args) => encodeParts([name, tagName, ...build(...args)]);
  }

  return Object.freeze({
    name,
    schema,
    version: schemaVersion(name, schema),
    timing: Object.freeze({ ...timing }),
    tags: Object.freeze(tags) as unknown as SpecTags<Name, Tags>,
    clusterLockMs,
  });
};
