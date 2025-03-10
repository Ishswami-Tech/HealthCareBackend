import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
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

  async use(req: Request, res: Response, next: NextFunction) {
    // Extract clinic identifier from request
    // Priority: 1. Header clinic-id, 2. Header app-name, 3. Query param, 4. Body
    const clinicId = 
      req.headers['x-clinic-id'] as string || 
      req.query.clinicId as string || 
      (req.body && req.body.clinicId);

    const appName = 
      req.headers['x-app-name'] as string || 
      req.query.appName as string || 
      (req.body && req.body.appName);

    try {
      if (clinicId) {
        // Set the clinic client in the request object using clinic ID
        req['clinicClient'] = await this.prismaService.getClinicClient(clinicId);
        req['clinicId'] = clinicId;
      } else if (appName) {
        // Get clinic by app name
        const clinic = await this.clinicDatabaseService.getClinicByAppName(appName);
        if (clinic) {
          req['clinicClient'] = await this.prismaService.getClinicClient(clinic.id);
          req['clinicId'] = clinic.id;
          req['appName'] = appName;
        }
      }
    } catch (error) {
      console.error(`Error connecting to clinic database: ${error.message}`);
      // Continue with the default database if there's an error
    }

    next();
  }
} 