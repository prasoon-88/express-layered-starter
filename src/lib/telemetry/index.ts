import type { IncomingMessage } from 'node:http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { startNodeSdk } from '@opentelemetry/sdk-node';
import { telemetryConfig } from '#config/telemetry.config';
import { HTTP_HEADERS } from '#constants/http/httpHeaders.constant';
import { isTelemetryStarted, markTelemetryStarted } from './state.ts';

// The only file that imports the OpenTelemetry SDK, and only the preload imports it. The rest
// of the app reads ./state.ts, or uses `@opentelemetry/api`, which does nothing until this ran.

const isIgnored = (req: IncomingMessage) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  return telemetryConfig.ignoredPathPrefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
};

/** Starts the SDK. Called by the preload (src/instrumentation.ts), before the app is imported. */
export const startTelemetry = () => {
  if (isTelemetryStarted() || !telemetryConfig.enabled) return;

  const sdk = startNodeSdk({
    resourceAttributes: telemetryConfig.resourceAttributes,
    // An empty list switches a signal off; leaving it out lets the OTEL_* variables configure it.
    ...(!telemetryConfig.traces && { spanProcessors: [] }),
    ...(!telemetryConfig.metrics && { metricReaders: [] }),
    // Logs stay on stdout. pino gets trace_id/span_id added instead (see below).
    logRecordProcessors: [],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: isIgnored,
        // Read when the span ends, from the response: set by the requestId middleware for an
        // incoming id and a generated one alike, so the id a client reports finds its trace.
        applyCustomAttributesOnSpan: (span, _request, response) => {
          const requestId =
            'getHeader' in response && response.getHeader(HTTP_HEADERS.X_REQUEST_ID);
          if (typeof requestId === 'string') span.setAttribute('app.request_id', requestId);
        },
      }),
      new ExpressInstrumentation({
        // One span per middleware and per nested router is ~15 per request, mostly named
        // `<anonymous>`. The handler span stays; time in middleware shows as the gap under the
        // HTTP span, and the Redis calls made there as its children.
        ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.ROUTER],
      }),
      new RedisInstrumentation({
        // The default records arguments: Lua script values (idempotency bodies, token data)
        // and keys (client IPs, token ids). The command name is all a trace needs.
        dbStatementSerializer: (command) => command,
        // Background commands (policy refresh, the connection check) would each be a trace.
        requireParentSpan: true,
      }),
      new PinoInstrumentation({ disableLogSending: true }),
      new RuntimeNodeInstrumentation(),
    ],
  });
  markTelemetryStarted(sdk);
};
