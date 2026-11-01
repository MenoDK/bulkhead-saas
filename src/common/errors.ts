import { HttpException } from '@nestjs/common';

/** An error the client is allowed to understand: stable machine code + human message. */
export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppException(400, code, message, details);
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Authentication required') =>
  new AppException(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'You are not allowed to do this') =>
  new AppException(403, code, message);
export const notFound = (what: string) => new AppException(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppException(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppException(422, code, message, details);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppException(429, 'RATE_LIMITED', 'Too many attempts. Try again later.', { retryAfterSeconds });
