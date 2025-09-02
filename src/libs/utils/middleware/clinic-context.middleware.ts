import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

export interface ClinicContext {
  identifier: string;
  clinicId?: string;
  subdomain?: string;
  appName?: string;
  isValid: boolean;
}

/**
 * Middleware to set the clinic context for database row-level tenant isolation
 * This middleware extracts the clinic ID from the request and sets it in the PrismaService
 * to automatically filter all database queries to only include data for this tenant
 */
@Injectable()
export class ClinicContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ClinicContextMiddleware.name);

  constructor(private prismaService: PrismaService) {}

  async use(req: FastifyRequest, res: FastifyReply, next: () => void) {
    try {
      // Extract clinic identifiers from request
      const headerIdentifier = req.headers['x-clinic-id'] as string || 
                              req.headers['x-clinic-identifier'] as string;
      const queryIdentifier = (req.query as any)?.clinicId;
      const pathIdentifier = (req.params as any)?.clinicId;
      const subdomain = this.extractSubdomain(req);
      
      // Also check JWT token for clinic context
      let jwtClinicId: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.substring(7);
          const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
          jwtClinicId = payload.clinicId;
        } catch (error) {
          // Continue if JWT parsing fails
        }
      }
      
      // Log all extracted identifiers for debugging
      this.logger.debug(`Clinic context extraction for ${req.url}:`, {
        headerIdentifier,
        queryIdentifier,
        pathIdentifier,
        jwtClinicId,
        subdomain,
        headers: {
          'x-clinic-id': req.headers['x-clinic-id'],
          'x-clinic-identifier': req.headers['x-clinic-identifier'],
          authorization: authHeader ? 'Bearer ***' : 'none'
        }
      });
      
      let clinicContext: ClinicContext = {
        identifier: headerIdentifier || queryIdentifier || pathIdentifier || jwtClinicId || subdomain,
        subdomain,
        isValid: false
      };

      // If we have some identifier, validate and populate the clinic context
      if (clinicContext.identifier) {
        try {
          // Clear any existing tenant context
          this.prismaService.clearTenantId();
          
          // Check in database to validate clinic
          const clinic = await this.findClinic(clinicContext.identifier);
          
          this.logger.debug(`Clinic search result for identifier "${clinicContext.identifier}":`, {
            found: !!clinic,
            clinicId: clinic?.id,
            clinicName: clinic?.name,
            isActive: clinic?.isActive
          });
          
          if (clinic) {
            clinicContext = {
              ...clinicContext,
              clinicId: clinic.id,
              subdomain: clinic.subdomain,
              appName: clinic.app_name,
              isValid: clinic.isActive
            };
            
            // Set tenant context for row-level isolation
            if (clinic.isActive) {
              this.prismaService.setCurrentTenantId(clinic.id);
              this.logger.debug(`Tenant context set for ${clinic.name} (${clinic.id})`);
            } else {
              this.logger.warn(`Attempted to access inactive clinic: ${clinic.name} (${clinic.id})`);
            }
          } else {
            this.logger.warn(`Clinic not found for identifier: ${clinicContext.identifier}`);
          }
        } catch (error) {
          this.logger.error(`Error validating clinic: ${error.message}`);
        }
      } else {
        this.logger.debug('No clinic identifier found in request');
      }
      
      // Attach clinic context to request - even if invalid, so we can check in guards
      (req as any).clinicContext = clinicContext;
      
      next();
    } catch (error) {
      this.logger.error(`Error in clinic middleware: ${error.message}`);
      next();
    }
  }

  private extractSubdomain(req: FastifyRequest): string | null {
    // Try to get from subdomain first
    const host = req.headers.host;
    if (host) {
      // Parse host to extract subdomain
      // Assuming format is subdomain.domain.com or subdomain.localhost
      const parts = host.split('.');
      
      if (parts.length >= 2) {
        const subdomain = parts[0];
        if (subdomain && !['www', 'api', 'localhost'].includes(subdomain)) {
          return subdomain;
        }
      }
    }
    return null;
  }

  private async findClinic(identifier: string) {
    try {
      // Search for clinic by id, subdomain, or app_name
      return await this.prismaService.clinic.findFirst({
        where: {
          OR: [
            { id: identifier },
            { subdomain: identifier },
            { app_name: identifier },
            { clinicId: identifier },
          ],
        },
      });
    } catch (error) {
      this.logger.error(`Failed to find clinic with identifier ${identifier}: ${error.message}`);
      return null;
    }
  }
} 