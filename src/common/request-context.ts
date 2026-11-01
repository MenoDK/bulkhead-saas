import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from './auth';

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Correlates one request across logs, error bodies and downstream services. */
export function requestId(req: AuthedRequest, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}

/** Client address for rate limiting. Honours `trust proxy` (set from TRUST_PROXY_HOPS), never raw X-Forwarded-For. */
export function clientIp(req: AuthedRequest): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
