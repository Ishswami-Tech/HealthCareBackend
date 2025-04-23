import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaService } from '../database/prisma/prisma.service';
import { ClinicDatabaseService } from '../../services/clinic/clinic-database.service';

/**
 * Middleware to set the clinic context for database connections
 * This middleware extracts the clinic ID or app name from the request and sets it in the request object
 * for use by the PrismaService to connect to the correct database
 */
@Injectable()
export class ClinicContextMiddleware implements NestMiddleware {
  constructor(
    private prismaService: PrismaService,
    private clinicDatabaseService: ClinicDatabaseService
  ) {}

  use(req: FastifyRequest, res: FastifyReply, next: () => void) {
    // Extract clinic identifier from subdomain or header
    const clinicIdentifier = this.extractClinicIdentifier(req);
    
    // Attach clinic context to request
    if (clinicIdentifier) {
      (req as any).clinicContext = {
        identifier: clinicIdentifier
      };
    }
    
    next();
  }

  private extractClinicIdentifier(req: FastifyRequest): string | null {
    // Try to get from subdomain first
    const host = req.headers.host;
    if (host) {
      const subdomain = host.split('.')[0];
      if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
        return subdomain;
      }
    }

    // Fallback to header
    return (req.headers['x-clinic-identifier'] as string) || null;
  }
} 