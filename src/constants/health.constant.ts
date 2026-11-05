// Kubernetes' default readiness probe timeout is 1s. A dependency that has not answered by then
// is reported down, so a hung dependency cannot hang the probe past the platform's own timeout.
export const READINESS_CHECK_TIMEOUT_MS = 1000;
