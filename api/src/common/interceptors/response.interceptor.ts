import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: unknown;
  timestamp: string;
}

/**
 * Wraps every successful response in the platform envelope:
 * { success, data, meta?, timestamp }
 * Services returning { data, meta } keep their meta (pagination etc.).
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<ApiEnvelope<T>> {
    return next.handle().pipe(
      map((payload) => {
        const timestamp = new Date().toISOString();
        if (payload && typeof payload === 'object' && 'data' in payload && 'meta' in payload) {
          return { success: true as const, data: payload.data, meta: payload.meta, timestamp };
        }
        return { success: true as const, data: payload, timestamp };
      }),
    );
  }
}
