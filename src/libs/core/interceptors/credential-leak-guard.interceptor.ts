import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { stripLeakedCredentials } from './credential-leak-guard.util';

/**
 * Strips credential/secret-shaped fields (password hashes, OAuth ids, db_connection_string, API
 * keys, tokens, ...) from every HTTP response, regardless of role. A global backstop against the
 * recurring "raw Prisma `include` leaks the full row" bug class — see credential-leak-guard.util.ts.
 *
 * Registered with `app.useGlobalInterceptors` in main.ts, same as BillingRedactionInterceptor.
 */
@Injectable()
export class CredentialLeakGuardInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    return next.handle().pipe(map((payload: unknown) => stripLeakedCredentials(payload)));
  }
}
