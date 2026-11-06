import ENV_CONSTANTS from '#constants/env/index';

// These are OpenTelemetry's own variables (https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/).
// The SDK reads and validates them; the app's env schema does not repeat them. Only the
// decision "is a destination configured" is made here, so nothing is sent, and no export
// error is logged, until one is.

type Source = Readonly<Record<string, string | undefined>>;
type Service = { name: string; version: string };

export const resolveTelemetryConfig = (env: Source, service: Service) => {
  const value = (key: string) => env[key]?.trim() || undefined;
  const sdkDisabled = value('OTEL_SDK_DISABLED')?.toLowerCase() === 'true';

  // A signal is on when it has somewhere to go: an OTLP endpoint (shared or its own), or an
  // exporter chosen explicitly. `none` turns it off, as the spec defines.
  const signalOn = (signal: 'TRACES' | 'METRICS') => {
    const exporter = value(`OTEL_${signal}_EXPORTER`)?.toLowerCase();
    if (sdkDisabled || exporter === 'none') return false;
    return Boolean(
      value('OTEL_EXPORTER_OTLP_ENDPOINT') ??
      value(`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`) ??
      exporter,
    );
  };

  // The app's name and version, unless OpenTelemetry's variables set them. The SDK ranks
  // attributes passed in code above those variables, so they are only filled in when absent.
  const declared = (value('OTEL_RESOURCE_ATTRIBUTES') ?? '')
    .split(',')
    .map((pair) => pair.split('=')[0]?.trim());
  const resourceAttributes: Record<string, string> = {
    ...(!value('OTEL_SERVICE_NAME') &&
      !declared.includes('service.name') && { 'service.name': service.name }),
    ...(!declared.includes('service.version') && { 'service.version': service.version }),
  };

  const traces = signalOn('TRACES');
  const metrics = signalOn('METRICS');

  return Object.freeze({
    traces,
    metrics,
    enabled: traces || metrics,
    resourceAttributes: Object.freeze(resourceAttributes),
    // Probes arrive every few seconds and say nothing about users; tracing them only costs.
    ignoredPathPrefixes: Object.freeze(['/health']),
  });
};

export type TelemetryConfig = ReturnType<typeof resolveTelemetryConfig>;

export const telemetryConfig = resolveTelemetryConfig(process.env, {
  name: ENV_CONSTANTS.SERVICE_NAME,
  version: ENV_CONSTANTS.SERVICE_VERSION,
});
