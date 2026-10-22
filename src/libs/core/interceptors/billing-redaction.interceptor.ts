import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { isBillingBlindRole, stripBillingFields } from './billing-redaction.util';

interface RoleCarryingRequest {
  user?: { role?: unknown };
}

/**
 * Strips billing amounts from every response sent to a DOCTOR or ASSISTANT_DOCTOR.
 *
 * Registered with `app.useGlobalInterceptors` in main.ts so it is the OUTERMOST interceptor: it sees
 * the final payload even when the cache interceptor replays a stored response without running the
 * handler. Anonymous and other-role requests pass through untouched (no copy, no cost).
 */
@Injectable()
export class BillingRedactionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<RoleCarryingRequest>();
    if (!isBillingBlindRole(request?.user?.role)) {
      return next.handle();
    }
    return next.handle().pipe(map((payload: unknown) => stripBillingFields<unknown>(payload)));
  }
}
