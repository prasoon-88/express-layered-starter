// Node closes an idle keep-alive socket at keepAliveTimeout + this buffer. Pinned explicitly in
// createHttpServer so the env rule in constants/env/schema.ts and the server cannot drift apart.
export const HTTP_KEEP_ALIVE_TIMEOUT_BUFFER_MS = 1000;
