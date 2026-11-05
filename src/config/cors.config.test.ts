import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The config reads the environment once, when the module loads, so set it before importing.
process.env.NODE_ENV = 'test';
process.env.CORS_ENABLED = 'true';
process.env.CORS_ORIGINS = 'https://app.example.com, https://*.partner.io';

const { corsConfig } = await import('./cors.config.ts');

const decide = (origin: string | undefined) =>
  new Promise<boolean | undefined>((resolve, reject) => {
    corsConfig.origin(origin, (err, allow) => (err ? reject(err) : resolve(allow as boolean)));
  });

describe('corsConfig origin rules', () => {
  it('allows an exact origin from the list', async () => {
    assert.equal(await decide('https://app.example.com'), true);
  });

  it('allows a request with no Origin header (curl, server-to-server, probes)', async () => {
    assert.equal(await decide(undefined), true);
  });

  it('allows subdomains of a wildcard rule, at any depth', async () => {
    assert.equal(await decide('https://api.partner.io'), true);
    assert.equal(await decide('https://a.b.partner.io'), true);
  });

  it('refuses the bare domain of a wildcard rule, and look-alike domains', async () => {
    assert.equal(await decide('https://partner.io'), false);
    assert.equal(await decide('https://evilpartner.io'), false);
    assert.equal(await decide('https://partner.io.evil.com'), false);
  });

  it('refuses a different scheme or port for an exact origin, and unknown origins', async () => {
    assert.equal(await decide('http://app.example.com'), false);
    assert.equal(await decide('https://app.example.com:8443'), false);
    assert.equal(await decide('https://other.com'), false);
  });

  it('refuses a wildcard match on the wrong scheme', async () => {
    assert.equal(await decide('http://api.partner.io'), false);
  });
});
