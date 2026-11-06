import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateParam, joinPaths, pathProblem, shadows } from './paths.ts';

describe('pathProblem', () => {
  it('accepts the root, static segments and whole-segment params', () => {
    for (const path of ['/', '/users', '/users/:id', '/api/v1/user/register', '/a.b/c-d/e_f/~g'])
      assert.equal(pathProblem(path), undefined, path);
  });

  it('requires a string that starts with a slash', () => {
    assert.match(pathProblem('users') ?? '', /must start with "\/"/);
    assert.match(pathProblem('') ?? '', /must start with "\/"/);
    assert.match(pathProblem(undefined) ?? '', /must be a string/);
  });

  it('rejects a trailing slash, since Express would match it with or without', () => {
    assert.match(pathProblem('/users/') ?? '', /trailing "\/"/);
  });

  it('rejects an empty segment', () => {
    assert.match(pathProblem('/users//me') ?? '', /empty segment/);
  });

  it('rejects wildcards, optional groups and regex syntax', () => {
    for (const path of ['/files/*rest', '/users{/:id}', '/users/:id?', '/a+', '/(a)'])
      assert.match(pathProblem(path) ?? '', /not allowed/, path);
  });

  it('rejects a param that shares its segment with anything else', () => {
    assert.match(pathProblem('/flights/:from-:to') ?? '', /not allowed/);
    assert.match(pathProblem('/v:version') ?? '', /not allowed/);
  });

  it('rejects dot segments, which clients collapse before sending', () => {
    assert.match(pathProblem('/a/../b') ?? '', /not allowed/);
    assert.match(pathProblem('/./a') ?? '', /not allowed/);
  });
});

describe('joinPaths', () => {
  it('joins a prefix and a path into one canonical path', () => {
    assert.equal(joinPaths('/api', '/v1'), '/api/v1');
    assert.equal(joinPaths('/', '/health'), '/health');
    assert.equal(joinPaths('/api', '/'), '/api');
    assert.equal(joinPaths('/', '/'), '/');
    assert.equal(joinPaths('', '/'), '/');
  });
});

describe('duplicateParam', () => {
  it('finds a param name used twice in one path', () => {
    assert.equal(duplicateParam('/users/:id/posts/:id'), 'id');
  });

  it('allows distinct names', () => {
    assert.equal(duplicateParam('/users/:userId/posts/:postId'), undefined);
  });
});

describe('shadows', () => {
  it('is true when an earlier param route catches a later static one', () => {
    assert.equal(shadows('/users/:id', '/users/me'), true);
  });

  it('is false the other way round: the static route answers first, the param one still matches the rest', () => {
    assert.equal(shadows('/users/me', '/users/:id'), false);
  });

  it('is true for two param routes of the same shape', () => {
    assert.equal(shadows('/users/:id', '/users/:slug'), true);
  });

  it('is true for the same path in another case, since Express matches case-insensitively', () => {
    assert.equal(shadows('/Users', '/users'), true);
  });

  it('is false for paths of different lengths', () => {
    assert.equal(shadows('/users/:id', '/users/:id/posts'), false);
    assert.equal(shadows('/', '/users'), false);
  });

  it('is false when a static segment differs', () => {
    assert.equal(shadows('/users/:id/posts', '/users/:id/likes'), false);
  });
});
