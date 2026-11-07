import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableError } from '#errors';
import { cacheConverter } from './cache.converter.ts';
import { convertError } from './index.ts';

// Built here by name, as the converter matches it: `errors/` may not import `lib/cache`.
const loadTimeout = () => Object.assign(new Error('slow'), { name: 'CacheLoadTimeoutError' });

describe('cacheConverter', () => {
  it('answers a loader past its hardTimeoutMs with a 503', () => {
    const err = cacheConverter(loadTimeout());
    assert.ok(err instanceof ServiceUnavailableError);
    assert.equal(err.statusCode, 503);
    assert.equal(err.code, 'SERVICE_UNAVAILABLE');
  });

  it('leaves every other error alone', () => {
    assert.equal(cacheConverter(new Error('other')), null);
    assert.equal(cacheConverter('CacheLoadTimeoutError'), null);
  });

  it('is one of the converters the error handler runs', () => {
    assert.ok(convertError(loadTimeout()) instanceof ServiceUnavailableError);
  });
});
