import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { ClinicIsolationService, ClinicContext } from '../../infrastructure/database/clinic-isolation.service';

export interface ExtendedClinicContext extends ClinicContext {
  identifier: string;
  isValid: boolean;
  accessMethod: 'header' | 'query' | 'path' | 'jwt' | 'subdomain';
}

/**
 * Middleware to set the clinic context for multi-clinic healthcare application
 * Extracts clinic ID from various sources and validates clinic access
 * Sets up row-level security context for database operations
 */
@Injectable()
export class ClinicContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ClinicContextMiddleware.name);

  constructor(private clinicIsolationService: ClinicIsolationService) {}

  async use(req: FastifyRequest, res: FastifyReply, next: () => void) {
    try {
      // Extract clinic identifiers from various sources
      const clinicIdentifiers = this.extractClinicIdentifiers(req);
      
      this.logger.debug(`Clinic context extraction for ${req.url}:`, {
        identifiers: clinicIdentifiers,
        method: req.method,
        userAgent: req.headers['user-agent']?.substring(0, 50)
      });
      
      let clinicContext: ExtendedClinicContext | null = null;

      // Try each identifier source until we find a valid clinic
      for (const { identifier, method } of clinicIdentifiers) {
        if (!identifier) continue;

        try {
          const result = await this.clinicIsolationService.getClinicContext(identifier);
          
          if (result.success && result.data) {
            // If we have a user, validate their access to this clinic
            const user = (req as any).user;
            if (user) {
              const userId = user.sub || user.id;
              if (userId) {
                const accessResult = await this.clinicIsolationService.validateClinicAccess(userId, identifier);
                if (!accessResult.success) {
                  this.logger.warn(`User ${userId} denied access to clinic ${identifier}: ${accessResult.error}`);
                  continue; // Try next identifier
                }
              }
            }

            clinicContext = {
              ...result.data,
              identifier,
              isValid: true,
              accessMethod: method
            };

            this.logger.debug(`Valid clinic context found via ${method}:`, {
              clinicId: result.data.clinicId,
              clinicName: result.data.clinicName,
              locationsCount: result.data.locations.length
            });
            break;
          }
        } catch (error) {
          this.logger.debug(`Error checking clinic identifier ${identifier}: ${error.message}`);
          continue;
        }
      }

      // If no valid clinic context found, create invalid context with first identifier
      if (!clinicContext && clinicIdentifiers.length > 0) {
        const firstIdentifier = clinicIdentifiers[0];
        clinicContext = {
          identifier: firstIdentifier.identifier || 'unknown',
          clinicId: '',
          clinicName: '',
          locations: [],
          isActive: false,
          features: [],
          settings: {},
          isValid: false,
          accessMethod: firstIdentifier.method
        };
      }

      // Set clinic context in request
      if (clinicContext) {
        (req as any).clinicContext = clinicContext;
        
        // Set database context for row-level security if valid
        if (clinicContext.isValid) {
          this.clinicIsolationService.setCurrentClinicContext(clinicContext.clinicId);
          
          // Add clinic info to request for easy access in controllers
          (req as any).clinic = {
            id: clinicContext.clinicId,
            name: clinicContext.clinicName,
            subdomain: clinicContext.subdomain,
            appName: clinicContext.appName,
            locations: clinicContext.locations,
            settings: clinicContext.settings
          };

          this.logger.debug(`Clinic context set for request:`, {
            url: req.url,
            clinicId: clinicContext.clinicId,
            accessMethod: clinicContext.accessMethod
          });
        } else {
          // Clear any existing database context
          this.clinicIsolationService.clearClinicContext();
        }
      }

      next();
    } catch (error) {
      this.logger.error(`Error in clinic context middleware: ${error.message}`, error.stack);
      // Don't block the request, just clear context
      this.clinicIsolationService.clearClinicContext();
      next();
    }
  }

  private extractClinicIdentifiers(req: FastifyRequest): Array<{ identifier: string; method: 'header' | 'query' | 'path' | 'jwt' | 'subdomain' }> {
    const identifiers: Array<{ identifier: string; method: 'header' | 'query' | 'path' | 'jwt' | 'subdomain' }> = [];

    // 1. Check headers (highest priority for API calls)
    const headerClinicId = req.headers['x-clinic-id'] as string || 
                          req.headers['clinic-id'] as string ||
                          req.headers['x-clinic-identifier'] as string;
    if (headerClinicId) {
      identifiers.push({ identifier: headerClinicId, method: 'header' });
    }

    // 2. Check query parameters
    const query = req.query as any;
    if (query?.clinicId) {
      identifiers.push({ identifier: query.clinicId, method: 'query' });
    }

    // 3. Check path parameters
    const params = req.params as any;
    if (params?.clinicId) {
      identifiers.push({ identifier: params.clinicId, method: 'path' });
    }

    // 4. Check JWT token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (payload.clinicId) {
          identifiers.push({ identifier: payload.clinicId, method: 'jwt' });
        }
      } catch (error) {
        // JWT parsing failed, continue
      }
    }

    // 5. Check subdomain (lowest priority)
    const subdomain = this.extractSubdomain(req);
    if (subdomain) {
      identifiers.push({ identifier: subdomain, method: 'subdomain' });
    }

    return identifiers;
  }

  private extractSubdomain(req: FastifyRequest): string | null {
    const host = req.headers.host;
    if (!host) return null;

    // Parse host to extract subdomain
    // Assuming format is subdomain.domain.com or subdomain.localhost
    const parts = host.split('.');
    
    if (parts.length >= 2) {
      const subdomain = parts[0];
      // Skip common prefixes that aren't clinic subdomains
      if (subdomain && !['www', 'api', 'localhost', 'admin', 'app'].includes(subdomain)) {
        return subdomain;
      }
    }
    return null;
  }
}

/**
 * Decorator to mark routes as requiring clinic context
 */
export const RequireClinic = () => {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    Reflect.defineMetadata('requireClinic', true, descriptor.value);
    return descriptor;
  };
};

/**
 * Decorator to mark routes as clinic-specific
 */
export const ClinicRoute = () => {
  return function (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) {
    if (propertyKey && descriptor) {
      // Method decorator
      Reflect.defineMetadata('isClinicRoute', true, descriptor.value);
    } else {
      // Class decorator
      Reflect.defineMetadata('isClinicRoute', true, target);
    }
    return descriptor || target;
  };
};