import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV ??= 'test';

const { resolveTelemetryConfig } = await import('./telemetry.config.ts');

const service = { name: 'svc', version: '1.2.3' };
const resolve = (env: Record<string, string> = {}) => resolveTelemetryConfig(env, service);

describe('resolveTelemetryConfig', () => {
  describe('when it turns on', () => {
    it('is off with no destination, so dev and tests send nothing', () => {
      assert.deepEqual(
        { ...resolve(), resourceAttributes: undefined, ignoredPathPrefixes: undefined },
        {
          traces: false,
          metrics: false,
          enabled: false,
          resourceAttributes: undefined,
          ignoredPathPrefixes: undefined,
        },
      );
    });

    it('turns both signals on for the shared OTLP endpoint', () => {
      const config = resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' });
      assert.equal(config.traces, true);
      assert.equal(config.metrics, true);
      assert.equal(config.enabled, true);
    });

    it('turns on only the signal whose own endpoint is set', () => {
      const config = resolve({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://c:4318/v1/traces' });
      assert.equal(config.traces, true);
      assert.equal(config.metrics, false, 'no metrics export to a default localhost endpoint');
    });

    it('turns a signal on for an explicitly chosen exporter', () => {
      assert.equal(resolve({ OTEL_TRACES_EXPORTER: 'console' }).traces, true);
    });

    it('turns a signal off with exporter "none", whatever the endpoint', () => {
      const config = resolve({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        OTEL_METRICS_EXPORTER: 'NONE',
      });
      assert.equal(config.traces, true);
      assert.equal(config.metrics, false);
    });

    it('turns everything off with OTEL_SDK_DISABLED=true', () => {
      const config = resolve({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        OTEL_SDK_DISABLED: 'TRUE',
      });
      assert.equal(config.enabled, false);
    });

    it('treats empty and blank values as unset, as compose passes them', () => {
      assert.equal(
        resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ', OTEL_TRACES_EXPORTER: '' }).enabled,
        false,
      );
    });
  });

  describe('resource attributes', () => {
    it("uses the app's name and version by default", () => {
      assert.deepEqual(resolve().resourceAttributes, {
        'service.name': 'svc',
        'service.version': '1.2.3',
      });
    });

    it('leaves the name to OTEL_SERVICE_NAME when it is set', () => {
      assert.deepEqual(resolve({ OTEL_SERVICE_NAME: 'from-otel' }).resourceAttributes, {
        'service.version': '1.2.3',
      });
    });

    it('leaves either one to OTEL_RESOURCE_ATTRIBUTES when it declares it', () => {
      const config = resolve({
        OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=prod, service.version=9.9.9',
      });
      assert.deepEqual(config.resourceAttributes, { 'service.name': 'svc' });
    });
  });
});
