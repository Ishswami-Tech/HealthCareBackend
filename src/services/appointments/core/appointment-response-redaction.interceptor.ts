import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { redactAppointmentResponse } from './appointment-response-redaction.util';

interface RoleCarryingRequest {
  user?: { role?: unknown };
}

/**
 * Every answer of the appointment / in-person controllers goes out without credential keys
 * (password hash, reset tokens, social login ids ...) for every role, and without clinical keys
 * for the reception desk (see appointment-response-redaction.util.ts). Declared on the controller,
 * so it runs on the handler's result before the response is serialized.
 */
@Injectable()
export class AppointmentResponseRedactionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<RoleCarryingRequest>();
    const role = request?.user?.role;
    return next
      .handle()
      .pipe(map((payload: unknown) => redactAppointmentResponse<unknown>(payload, role)));
  }
}
