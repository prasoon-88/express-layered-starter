import type { Response } from 'express';
import { IDEMPOTENCY_REPLAY_HEADERS } from '#constants/idempotency.constant';
import { concatenateStrings } from '#utils/concatenateStrings.util';
import type { StoredResponse } from './types.ts';

const headerValue = (value: string | number | readonly string[]) =>
  Array.isArray(value) ? concatenateStrings(value.map(String), ', ') : String(value);

export const captureResponse = (
  res: Response,
  maxBytes: number,
  onDone: (captured: StoredResponse | undefined) => void,
) => {
  const send = res.send.bind(res);
  let body: Buffer | undefined;
  let settled = false;

  const finish = (captured: StoredResponse | undefined) => {
    if (settled) return;
    settled = true;
    onDone(captured);
  };

  res.send = ((chunk?: unknown) => {
    if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) body = Buffer.from(chunk);
    else if (chunk !== undefined && chunk !== null) body = Buffer.from(JSON.stringify(chunk));
    return send(chunk);
  }) as Response['send'];

  res.once('finish', () => {
    const payload = body ?? Buffer.alloc(0);
    if (payload.length > maxBytes) return finish(undefined);

    const headers: Record<string, string> = {};
    for (const name of IDEMPOTENCY_REPLAY_HEADERS) {
      const value = res.getHeader(name);
      if (value !== undefined) headers[name] = headerValue(value);
    }
    finish({ status: res.statusCode, headers, body: payload.toString('base64') });
  });

  res.once('close', () => {
    if (!res.writableFinished) finish(undefined);
  });
};
