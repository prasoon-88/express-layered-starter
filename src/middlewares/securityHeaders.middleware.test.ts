import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import { listen } from '#testing/http';
import { createSecurityHeadersMiddleware } from './securityHeaders.middleware.ts';

const VIEWS_DIR = join(import.meta.dirname, '../views');

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name)
    ?.slice(1) ?? [];

const viewFiles = () =>
  readdirSync(VIEWS_DIR, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ejs'))
    .map((file) => readFileSync(join(VIEWS_DIR, file), 'utf8'));

describe('createSecurityHeadersMiddleware', () => {
  let server: Server;
  let csp = '';

  before(async () => {
    const app = express();
    app.use(createSecurityHeadersMiddleware());
    app.get('/', (_req, res) => {
      res.send('ok');
    });

    let baseUrl: string;
    ({ server, baseUrl } = await listen(app));

    const response = await fetch(`${baseUrl}/`);
    csp = response.headers.get('content-security-policy') ?? '';
  });

  after(() => {
    server.close();
  });

  it('sends a Content-Security-Policy that still defaults to same-origin', () => {
    assert.deepEqual(directive(csp, 'default-src'), ["'self'"]);
    assert.deepEqual(directive(csp, 'object-src'), ["'none'"]);
  });

  it('allows every external script host the views load', () => {
    const scriptOrigins = new Set(
      viewFiles().flatMap((html) =>
        [...html.matchAll(/<script[^>]*\ssrc="(https:\/\/[^/"]+)/g)].map((match) => match[1]),
      ),
    );

    assert.ok(
      scriptOrigins.size > 0,
      'the views are expected to load at least one external script',
    );
    const allowed = directive(csp, 'script-src');
    for (const origin of scriptOrigins) {
      assert.ok(allowed.includes(origin ?? ''), `script-src is missing ${origin}`);
    }
  });

  it('allows the animation files the views fetch at runtime', () => {
    const animationOrigins = new Set(
      viewFiles().flatMap((html) =>
        [...html.matchAll(/<lottie-player[^>]*\ssrc="(https:\/\/[^/"]+)/g)].map(
          (match) => match[1],
        ),
      ),
    );

    assert.ok(animationOrigins.size > 0, 'the views are expected to load an animation');
    const allowed = directive(csp, 'connect-src');
    for (const origin of animationOrigins) {
      assert.ok(allowed.includes(origin ?? ''), `connect-src is missing ${origin}`);
    }
  });

  it('does not open script-src to every https origin', () => {
    const allowed = directive(csp, 'script-src');
    assert.equal(allowed.includes('https:'), false);
    assert.equal(allowed.includes('*'), false);
    assert.equal(allowed.includes("'unsafe-inline'"), false);
  });
});
