import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const REDACT_PATTERN = /accessToken|token|secret|password/i;

function redact(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) =>
      REDACT_PATTERN.test(k) ? [k, '[REDACTED]'] : [k, redact(v)],
    ),
  );
}

@Injectable()
export class LogRedactInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const { method, url } = req as { method: string; url: string };
    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(`${method} ${url} ${Date.now() - now}ms`);
        },
        error: (err: Error) => {
          this.logger.error(`${method} ${url} ${Date.now() - now}ms — ${err.message}`);
        },
      }),
    );
  }
}

export { redact };
