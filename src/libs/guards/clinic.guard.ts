import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { LoggingService } from '../../shared/logging/logging.service';
import { LogType, LogLevel } from '../../shared/logging/types/logging.types';

@Injectable()
export class ClinicGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private loggingService: LoggingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return false;
    }

    try {
      // Get user's clinic associations
      const userWithClinic = await this.prisma.user.findUnique({
        where: { id: user.id },
        include: {
          Clinic: true,
        },
      });

      if (!userWithClinic || !userWithClinic.Clinic || userWithClinic.Clinic.length === 0) {
        this.loggingService.log(
          LogType.AUTH,
          LogLevel.WARN,
          `User ${user.id} has no clinic associations`,
          'ClinicGuard',
          { userId: user.id }
        );
        throw new ForbiddenException('User is not associated with any clinic');
      }

      // Store clinic information in request for later use
      request.clinic = userWithClinic.Clinic[0];
      
      // If clinic ID is provided in request params/query, verify it matches user's clinic
      const requestClinicId = request.params.clinicId || request.query.clinicId;
      if (requestClinicId && requestClinicId !== request.clinic.id) {
        this.loggingService.log(
          LogType.AUTH,
          LogLevel.WARN,
          `User ${user.id} attempted to access different clinic`,
          'ClinicGuard',
          { userId: user.id, requestedClinicId: requestClinicId, userClinicId: request.clinic.id }
        );
        throw new ForbiddenException('Access to this clinic is not allowed');
      }

      return true;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Clinic guard error: ${error.message}`,
        'ClinicGuard',
        { userId: user.id, error: error.stack }
      );
      throw error;
    }
  }
} 