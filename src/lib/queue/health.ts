import { createServer, type Server } from 'node:http';
import { HTTP_STATUS } from '#constants/http/httpStatus.constant';

/**
 * The worker process's probes, on a port of its own: `/health/live` answers 200 while the process
 * runs, `/health/ready` 200 only while every worker runs on a live connection. Kubernetes, Docker
 * and the shutdown handler use it as they use the API's.
 */
export const createWorkerHealthServer = (ready: () => boolean): Server =>
  createServer((req, res) => {
    const respond = (status: number, body: string) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ status: body }));
    };
    if (req.method !== 'GET') return respond(HTTP_STATUS.METHOD_NOT_ALLOWED, 'method_not_allowed');
    if (req.url === '/health/live') return respond(HTTP_STATUS.OK, 'ok');
    if (req.url === '/health/ready')
      return ready()
        ? respond(HTTP_STATUS.OK, 'ok')
        : respond(HTTP_STATUS.SERVICE_UNAVAILABLE, 'unavailable');
    respond(HTTP_STATUS.NOT_FOUND, 'not_found');
  });
