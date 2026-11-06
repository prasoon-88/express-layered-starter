// Settings are in seconds (`_S`), timers and stores take milliseconds (`_MS`). Convert with these,
// and round at the call site: down for a timestamp, up for a wait the client is told about.
export const MS_PER_SECOND = 1000;
export const NS_PER_MS = 1_000_000;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_DAY = 86_400;
