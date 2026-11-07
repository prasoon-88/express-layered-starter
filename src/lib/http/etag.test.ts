import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { setRepresentationEtag, weakEtag } from './etag.ts';

describe('weakEtag', () => {
  it('gives equal representations the same tag', () => {
    assert.equal(weakEtag({ a: 1 }), weakEtag({ a: 1 }));
  });

  it('gives different representations different tags', () => {
    assert.notEqual(weakEtag({ a: 1 }), weakEtag({ a: 2 }));
  });

  it('is a weak validator with a base64url value', () => {
    assert.match(weakEtag({ a: 1 }), /^W\/"[A-Za-z0-9_-]+"$/);
  });
});

describe('setRepresentationEtag', () => {
  const body = { status: 200, message: 'Success', data: { id: 1 } };

  const apply = (
    method: string,
    {
      status = 200,
      cacheControl,
      etag,
    }: { status?: number; cacheControl?: string; etag?: string } = {},
  ) => {
    const headers = new Map<string, string>();
    if (cacheControl) headers.set('Cache-Control', cacheControl);
    if (etag) headers.set('ETag', etag);
    const res = {
      get: (name: string) => headers.get(name),
      set: (name: string, value: string) => headers.set(name, value),
    };
    setRepresentationEtag({ method } as Request, res as unknown as Response, { ...body, status });
    return headers.get('ETag');
  };

  it('sets the tag of the body for a 200 GET', () => {
    assert.equal(apply('GET'), weakEtag(body));
  });

  it('sets it for HEAD, which answers like GET', () => {
    assert.equal(apply('HEAD'), weakEtag(body));
  });

  it('sets it when the response may be cached but must be revalidated', () => {
    assert.equal(apply('GET', { cacheControl: 'private, no-cache' }), weakEtag(body));
  });

  it('keeps an ETag the handler already set', () => {
    assert.equal(apply('GET', { etag: '"v42"' }), '"v42"');
  });

  it('sets nothing for a POST', () => {
    assert.equal(apply('POST'), undefined);
  });

  it('sets nothing for a status other than 200', () => {
    assert.equal(apply('GET', { status: 201 }), undefined);
  });

  it('sets nothing when the response may not be stored, since it can never be revalidated', () => {
    assert.equal(apply('GET', { cacheControl: 'no-store' }), undefined);
  });
});
