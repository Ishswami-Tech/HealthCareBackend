import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../database/prisma/prisma.service';
import { ClinicContext } from '../middleware/clinic-context.middleware';

/**
 * Interceptor that ensures proper tenant context is set for row-level isolation
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantContextInterceptor.name);

  constructor(private prismaService: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const clinicContext: ClinicContext = request.clinicContext;

    // Ensure tenant context is set
    if (clinicContext?.isValid && clinicContext.clinicId) {
      try {
        // Set tenant context for row-level isolation
        this.prismaService.setCurrentTenantId(clinicContext.clinicId);
        this.logger.debug(`Using tenant isolation for clinic ${clinicContext.clinicId}`);
      } catch (error) {
        this.logger.error(`Failed to set tenant context: ${error.message}`);
      }
    } else {
      // For global routes, ensure tenant context is cleared
      this.prismaService.clearTenantId();
    }

    return next.handle().pipe(
      tap(() => {
        // Clear tenant context after request is processed
        this.prismaService.clearTenantId();
      })
    );
  }
} 