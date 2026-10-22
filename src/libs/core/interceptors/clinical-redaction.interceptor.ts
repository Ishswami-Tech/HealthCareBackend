import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { isClinicalBlindRole, stripClinicalFields } from './clinical-redaction.util';

interface RoleCarryingRequest {
  user?: { role?: unknown };
}

/**
 * Removes clinical keys from the response for a RECEPTIONIST (see clinical-redaction.util.ts).
 * Applied with `@UseInterceptors` on the patient read controllers; other roles pass untouched.
 * Declared on the controller it runs inside the cache interceptor's replay too, because the
 * cached payload passes back through it on the way out.
 */
@Injectable()
export class ReceptionClinicalRedactionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<RoleCarryingRequest>();
    if (!isClinicalBlindRole(request?.user?.role)) {
      return next.handle();
    }
    return next.handle().pipe(map((payload: unknown) => stripClinicalFields<unknown>(payload)));
  }
}
