import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GET_CACHE_POLICY,
  cacheHeaders,
  cachePolicyProblem,
  type CachePolicy,
} from './cachePolicy.ts';
import type { Access } from './registry.ts';

const open = { strategy: 'public', reason: 'x' } as const;
const signedIn = { strategy: 'authenticated' } as const;
const anyAccess: Access = signedIn;

describe('cacheHeaders', () => {
  it('lets shared caches keep a public route, with stale-while-revalidate when set', () => {
    assert.deepEqual(
      cacheHeaders(open, { mode: 'fresh', maxAgeS: 60, staleWhileRevalidateS: 30 }),
      {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=30',
      },
    );
    assert.deepEqual(cacheHeaders(open, { mode: 'fresh', maxAgeS: 60 }), {
      'Cache-Control': 'public, max-age=60',
    });
  });

  it('keeps a route that needs credentials private and varies it on Authorization', () => {
    assert.deepEqual(cacheHeaders(signedIn, { mode: 'revalidate' }), {
      'Cache-Control': 'private, no-cache',
      Vary: 'Authorization',
    });
    assert.deepEqual(
      cacheHeaders({ strategy: 'roles', roles: ['ADMIN'] }, { mode: 'fresh', maxAgeS: 5 }),
      {
        'Cache-Control': 'private, max-age=5',
        Vary: 'Authorization',
      },
    );
  });

  it('honours shared: false on a public route', () => {
    assert.deepEqual(cacheHeaders(open, { mode: 'revalidate', shared: false }), {
      'Cache-Control': 'private, no-cache',
    });
    assert.deepEqual(cacheHeaders(open, { mode: 'revalidate' }), {
      'Cache-Control': 'public, no-cache',
    });
  });

  it('gives no-store as is', () => {
    assert.deepEqual(cacheHeaders(open, { mode: 'no-store' }), { 'Cache-Control': 'no-store' });
    assert.deepEqual(cacheHeaders(signedIn, { mode: 'no-store' }), {
      'Cache-Control': 'no-store',
      Vary: 'Authorization',
    });
  });

  it('makes a route public only for shared: true, never for another truthy value', () => {
    const policy = { mode: 'fresh', maxAgeS: 60, shared: 1 } as unknown as CachePolicy;
    assert.deepEqual(cacheHeaders(signedIn, policy), {
      'Cache-Control': 'private, max-age=60',
      Vary: 'Authorization',
    });
    assert.deepEqual(cacheHeaders(open, policy), { 'Cache-Control': 'private, max-age=60' });
  });

  it('makes the default private and revalidated, even on a public route', () => {
    assert.deepEqual(cacheHeaders(open, DEFAULT_GET_CACHE_POLICY), {
      'Cache-Control': 'private, no-cache',
    });
  });
});

describe('cachePolicyProblem', () => {
  it('accepts a GET without a rule, which gets the default', () => {
    assert.equal(cachePolicyProblem('GET', anyAccess, undefined), undefined);
    assert.equal(cachePolicyProblem('POST', anyAccess, undefined), undefined);
  });

  it('accepts valid rules', () => {
    assert.equal(
      cachePolicyProblem('GET', open, { mode: 'fresh', maxAgeS: 60, shared: true }),
      undefined,
    );
    assert.equal(
      cachePolicyProblem('GET', signedIn, {
        mode: 'fresh',
        maxAgeS: 31536000,
        staleWhileRevalidateS: 0,
      }),
      undefined,
    );
    assert.equal(cachePolicyProblem('POST', anyAccess, { mode: 'no-store' }), undefined);
  });

  it('refuses shared caches on a route that needs credentials', () => {
    assert.match(
      cachePolicyProblem('GET', signedIn, { mode: 'fresh', maxAgeS: 60, shared: true }) ?? '',
      /shared caches/,
    );
    assert.match(
      cachePolicyProblem(
        'GET',
        { strategy: 'roles', roles: ['ADMIN'] },
        { mode: 'revalidate', shared: true },
      ) ?? '',
      /shared caches/,
    );
  });

  it('refuses a shared that is not a boolean', () => {
    for (const shared of [1, 'true', null])
      for (const access of [open, signedIn])
        assert.match(
          cachePolicyProblem('GET', access, {
            mode: 'revalidate',
            shared,
          } as unknown as CachePolicy) ?? '',
          /shared must be a boolean/,
          `${String(shared)} on ${access.strategy}`,
        );
  });

  it('allows only no-store on a route that is not a GET', () => {
    assert.match(
      cachePolicyProblem('POST', anyAccess, { mode: 'revalidate' }) ?? '',
      /only no-store/,
    );
    assert.match(
      cachePolicyProblem('DELETE', open, { mode: 'fresh', maxAgeS: 1 }) ?? '',
      /only no-store/,
    );
  });

  it('refuses a max-age outside 1 to 31536000 whole seconds', () => {
    for (const maxAgeS of [0, 1.5, 31536001])
      assert.match(
        cachePolicyProblem('GET', open, { mode: 'fresh', maxAgeS }) ?? '',
        /maxAgeS/,
        String(maxAgeS),
      );
  });

  it('refuses a stale-while-revalidate that is not a whole number of 0 or more', () => {
    for (const staleWhileRevalidateS of [-1, 0.5])
      assert.match(
        cachePolicyProblem('GET', open, { mode: 'fresh', maxAgeS: 60, staleWhileRevalidateS }) ??
          '',
        /staleWhileRevalidateS/,
        String(staleWhileRevalidateS),
      );
  });

  it('refuses an unknown mode', () => {
    assert.match(
      cachePolicyProblem('GET', open, { mode: 'forever' } as never) ?? '',
      /unknown cache mode "forever"/,
    );
    assert.match(cachePolicyProblem('GET', open, null as never) ?? '', /unknown cache mode/);
  });
});
