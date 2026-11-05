import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InternalServerError, UnprocessableEntityError } from '#errors';
import { Paginator } from './paginator.util.ts';

describe('Paginator.parse', () => {
  it('defaults to page 1 of 10 and computes the offset', () => {
    assert.deepEqual(Paginator.parse(), { page: 1, pageSize: 10, offset: 0 });
    assert.deepEqual(Paginator.parse({ page: '3', pageSize: '25' }), {
      page: 3,
      pageSize: 25,
      offset: 50,
    });
  });

  it('treats empty and null as unset', () => {
    assert.deepEqual(Paginator.parse({ page: '', pageSize: null }), {
      page: 1,
      pageSize: 10,
      offset: 0,
    });
  });

  it('rejects anything that is not an integer inside the limits, as a 422', () => {
    for (const query of [
      { page: '0' },
      { page: '1001' },
      { page: '1.5' },
      { page: 'abc' },
      { pageSize: '501' },
      { pageSize: '-1' },
    ]) {
      assert.throws(() => Paginator.parse(query), UnprocessableEntityError, JSON.stringify(query));
    }
  });

  it('accepts the limits themselves', () => {
    assert.equal(Paginator.parse({ page: 1000, pageSize: 500 }).offset, 999 * 500);
  });
});

describe('Paginator.buildPagination', () => {
  it('derives page count and neighbours from the total', () => {
    assert.deepEqual(Paginator.buildPagination({ total: 95, page: 2, pageSize: 10 }), {
      page: 2,
      pageSize: 10,
      total: 95,
      totalPages: 10,
      hasPrev: true,
      hasMore: true,
    });
  });

  it('has no next page on the last one, and none at all for an empty result', () => {
    assert.equal(Paginator.buildPagination({ total: 20, page: 2, pageSize: 10 }).hasMore, false);

    const empty = Paginator.buildPagination({ total: 0 });
    assert.deepEqual([empty.totalPages, empty.hasPrev, empty.hasMore], [0, false, false]);
  });

  it('accepts the totals a database driver returns (bigint, numeric string)', () => {
    assert.equal(Paginator.buildPagination({ total: 7n }).total, 7);
    assert.equal(Paginator.buildPagination({ total: '7' }).total, 7);
  });

  it('treats a bad total as a server bug (500), not a client error', () => {
    for (const total of [-1, 1.5, 'x', undefined, null]) {
      assert.throws(() => Paginator.buildPagination({ total }), InternalServerError);
    }
  });
});

describe('Paginator.paginate', () => {
  it('hands the repository pageSize and offset, and returns items with the paging meta', async () => {
    let received: unknown;

    const result = await Paginator.paginate({ page: '2', pageSize: '3' }, (args) => {
      received = args;
      return Promise.resolve({ items: ['d', 'e', 'f'], total: '8' });
    });

    assert.deepEqual(received, { pageSize: 3, offset: 3 });
    assert.deepEqual(result, {
      items: ['d', 'e', 'f'],
      paging: { total: 8, page: 2, pageSize: 3 },
    });
  });

  it('does not query the repository for an invalid page', async () => {
    let called = false;

    await assert.rejects(
      Paginator.paginate({ page: '0' }, () => {
        called = true;
        return Promise.resolve({ items: [], total: 0 });
      }),
      UnprocessableEntityError,
    );

    assert.equal(called, false);
  });

  it('rejects a repository that returns malformed data as a 500', async () => {
    await assert.rejects(
      Paginator.paginate({}, () => Promise.resolve({ items: 'nope', total: 1 } as never)),
      InternalServerError,
    );
  });
});
