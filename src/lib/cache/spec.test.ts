import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as z from 'zod';
import { CacheConfigError } from './errors.ts';
import { defineCacheSpec, encodeParts } from './spec.ts';

const schema = z.object({ id: z.string() });

describe('defineCacheSpec', () => {
  it('describes an entity, frozen', () => {
    const spec = defineCacheSpec({ name: 'user', schema, ttlS: 60, staleS: 30 });
    assert.equal(spec.name, 'user');
    assert.equal(spec.schema, schema);
    assert.deepEqual(spec.timing, { ttlS: 60, staleS: 30 });
    assert.ok(Object.isFrozen(spec));
    assert.ok(Object.isFrozen(spec.tags));
  });

  it('refuses a name that is not letters, digits, _ or -', () => {
    for (const name of ['', '1user', 'user/x', 'a b', 'user:1', '#x'])
      assert.throws(() => defineCacheSpec({ name, schema, ttlS: 1 }), CacheConfigError, name);
    defineCacheSpec({ name: 'user_profile-v2', schema, ttlS: 1 });
  });

  it('refuses fractions, negatives and zero where it means nothing', () => {
    const bad = [
      { ttlS: 0 },
      { ttlS: 1.5 },
      { ttlS: 1, staleS: -1 },
      { ttlS: 1, softTimeoutMs: -1 },
      { ttlS: 1, hardTimeoutMs: 0 },
    ];
    for (const timing of bad)
      assert.throws(
        () => defineCacheSpec({ name: 'x', schema, ...timing }),
        CacheConfigError,
        JSON.stringify(timing),
      );
    defineCacheSpec({ name: 'x', schema, ttlS: 1, staleS: 0, softTimeoutMs: 0 });
  });

  it('takes clusterLockMs as a whole number of milliseconds, off when not set', () => {
    assert.equal(defineCacheSpec({ name: 'x', schema, ttlS: 1 }).clusterLockMs, undefined);
    assert.equal(
      defineCacheSpec({ name: 'x', schema, ttlS: 1, clusterLockMs: 500 }).clusterLockMs,
      500,
    );
    for (const clusterLockMs of [0, 1.5])
      assert.throws(
        () => defineCacheSpec({ name: 'x', schema, ttlS: 1, clusterLockMs }),
        CacheConfigError,
      );
  });

  describe('version', () => {
    it('is a hash of the schema: the same for the same shape, new for a new one', () => {
      const version = (shape: z.ZodType) =>
        defineCacheSpec({ name: 'a', schema: shape, ttlS: 1 }).version;
      assert.equal(version(z.object({ id: z.string() })), version(z.object({ id: z.string() })));
      assert.notEqual(version(z.object({ id: z.string() })), version(z.object({ id: z.number() })));
    });

    it('refuses a schema that is not plain JSON, since a hit would differ from the miss', () => {
      for (const shape of [z.date(), z.bigint(), z.string().transform((s) => s.length)])
        assert.throws(() => defineCacheSpec({ name: 'x', schema: shape, ttlS: 1 }), /plain JSON/);
    });
  });

  describe('tags', () => {
    const user = defineCacheSpec({
      name: 'user',
      schema,
      ttlS: 60,
      tags: {
        one: (id: string) => [id],
        byTenant: (tenant: string, active: boolean) => [tenant, active],
        lists: () => [],
      },
    });

    it('builds them from the entity, the tag name and the arguments', () => {
      assert.equal(user.tags.all(), '["user"]');
      assert.equal(user.tags.one('u1'), '["user","one","u1"]');
      assert.equal(user.tags.byTenant('t1', true), '["user","byTenant","t1",true]');
      assert.equal(user.tags.lists(), '["user","lists"]');
    });

    it('never gives two tags, or two entities, one string', () => {
      const users = defineCacheSpec({
        name: 'users',
        schema,
        ttlS: 1,
        tags: { one: (id: string) => [id] },
      });
      const all = new Set([
        user.tags.all(),
        user.tags.one('u1'),
        user.tags.one('1'),
        user.tags.lists(),
        users.tags.all(),
        users.tags.one('u1'),
      ]);
      assert.equal(all.size, 6);
    });

    it('refuses a tag named all', () => {
      assert.throws(
        () => defineCacheSpec({ name: 'x', schema, ttlS: 1, tags: { all: () => [] } }),
        CacheConfigError,
      );
    });
  });
});

describe('encodeParts', () => {
  it('is a JSON array, so different parts never share a string', () => {
    assert.equal(encodeParts(['byId', 1, true]), '["byId",1,true]');
    assert.notEqual(encodeParts(['a:b']), encodeParts(['a', 'b']));
    assert.notEqual(encodeParts(['1']), encodeParts([1]));
  });

  it('refuses no parts, and a part that is not a string, finite number or boolean', () => {
    const bad = { none: [], object: [{}], null: [null], undefined: [undefined], NaN: [Number.NaN] };
    for (const [what, parts] of Object.entries({ ...bad, Infinity: [Infinity] }))
      assert.throws(() => encodeParts(parts), CacheConfigError, what);
  });
});
