import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import type { AuthedRequest } from '../../common/auth';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<AuthedRequest>();
    const response = http.getResponse<Response>();
    const stop = this.metrics.httpDuration.startTimer();
    // `finish` fires for errors too (the exception filter has written the response by then).
    response.once('finish', () => {
      // The route *pattern* ("/resources/:id"), never the raw URL: ids would explode label cardinality.
      const route = (request.route as { path?: string } | undefined)?.path ?? 'unmatched';
      stop({ method: request.method, route, status: String(response.statusCode) });
    });
    return next.handle();
  }
}
