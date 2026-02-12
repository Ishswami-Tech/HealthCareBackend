import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { RbacService } from '@core/rbac/rbac.service';
import { LoggingService } from '@infrastructure/logging';
import { HealthcareErrorsService } from '@core/errors';
import { ClinicLocationService } from '@services/clinic/services/clinic-location.service';
import { LocationCacheService } from '@infrastructure/cache/services/location-cache.service';
import { LogType, LogLevel } from '@core/types';
import { Role } from '@core/types/enums.types';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
import type { AuditInfo } from '@core/types/database.types';

/**
 * Location Management Service
 * Handles location changes for staff roles
 * Only clinic admin and super admin can change locations
 */
@Injectable()
export class LocationManagementService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly rbacService: RbacService,
    private readonly loggingService: LoggingService,
    private readonly errors: HealthcareErrorsService,
    @Inject(forwardRef(() => ClinicLocationService))
    private readonly clinicLocationService: ClinicLocationService,
    @Optional()
    @Inject(forwardRef(() => LocationCacheService))
    private readonly locationCacheService?: LocationCacheService
  ) {}

  /**
   * Change user's location (only clinic admin/super admin)
   */
  async changeUserLocation(
    userId: string,
    newLocationId: string,
    currentUserId: string,
    clinicId: string
  ): Promise<void> {
    // Check permission
    const permissionCheck = await this.rbacService.checkPermission({
      userId: currentUserId,
      clinicId,
      resource: 'users',
      action: 'change-location',
    });

    if (!permissionCheck.hasPermission) {
      throw new ForbiddenException('Only clinic admin or super admin can change locations');
    }

    // Get user's current role
    const user = await this.databaseService.findUserByIdSafe(userId);
    if (!user) {
      throw this.errors.userNotFound(userId, 'LocationManagementService.changeUserLocation');
    }

    // Validate user belongs to clinic
    if (user.primaryClinicId !== clinicId) {
      throw new ForbiddenException('User does not belong to clinic');
    }

    // Validate new location belongs to clinic using LocationCacheService (shared cache)
    let location = null;
    if (this.locationCacheService) {
      location = await this.locationCacheService.getLocation(newLocationId, false);
    }

    // If not in cache, fetch from ClinicLocationService
    if (!location) {
      location = await this.clinicLocationService.getClinicLocationById(newLocationId, false);
    }

    if (!location) {
      throw new BadRequestException(`Location with ID ${newLocationId} not found`);
    }
    // Type guard to ensure location has required properties
    const locationData = location as { id: string; clinicId: string; name: string };
    if (locationData.clinicId !== clinicId) {
      throw new BadRequestException('Location does not belong to clinic');
    }

    // Define staff roles that can have locations (including LOCATION_HEAD)
    const staffRoles = [
      Role.DOCTOR,
      Role.RECEPTIONIST,
      Role.CLINIC_ADMIN,
      Role.PHARMACIST,
      Role.THERAPIST,
      Role.LAB_TECHNICIAN,
      Role.FINANCE_BILLING,
      Role.SUPPORT_STAFF,
      Role.NURSE,
      Role.COUNSELOR,
      Role.LOCATION_HEAD,
    ];

    if (!staffRoles.includes(user.role as Role)) {
      throw new BadRequestException('Only staff roles can have locations changed');
    }

    // Get current location for logging
    const currentLocation = await this.getUserCurrentLocation(userId, user.role, clinicId);

    // Update location in role-specific table with audit info
    await this.updateRoleLocation(userId, user.role, newLocationId, clinicId, currentUserId);

    // Log location change
    await this.loggingService.log(
      LogType.AUDIT,
      LogLevel.INFO,
      'User location changed',
      'LocationManagementService',
      {
        userId,
        oldLocationId: currentLocation?.id || null,
        oldLocationName: currentLocation?.name || null,
        newLocationId: locationData.id,
        newLocationName: locationData.name,
        changedBy: currentUserId,
        clinicId,
        userRole: user.role,
      }
    );
  }

  /**
   * Get user's current location
   */
  private async getUserCurrentLocation(
    userId: string,
    role: string,
    clinicId: string
  ): Promise<{ id: string; name: string } | null> {
    try {
      switch (role as Role) {
        case Role.DOCTOR:
        case Role.ASSISTANT_DOCTOR: {
          const doctor = await this.databaseService.executeHealthcareRead<{
            doctorClinic: Array<{ locationId: string | null }>;
          } | null>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              doctor: {
                findFirst: (args: {
                  where: { userId: string };
                  include: {
                    doctorClinic: {
                      where: { clinicId: string };
                      select: { locationId: boolean };
                    };
                  };
                }) => Promise<{ doctorClinic: Array<{ locationId: string | null }> } | null>;
              };
            };
            const result = await typedClient.doctor.findFirst({
              where: { userId },
              include: {
                doctorClinic: {
                  where: { clinicId },
                  select: { locationId: true },
                },
              },
            });
            return result as { doctorClinic: Array<{ locationId: string | null }> } | null;
          });
          const locationId = doctor?.doctorClinic?.[0]?.locationId;
          if (!locationId) return null;
          return await this.getLocationDetails(locationId);
        }
        case Role.RECEPTIONIST: {
          const receptionist = await this.databaseService.executeHealthcareRead<{
            locationId: string | null;
          } | null>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            const result = await typedClient.receptionist.findFirst({
              where: { userId, clinicId } as PrismaDelegateArgs,
              select: { locationId: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
            return result as { locationId: string | null } | null;
          });
          if (!receptionist?.locationId) return null;
          return await this.getLocationDetails(receptionist.locationId);
        }
        // Add other roles as needed
        default:
          return null;
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get user current location: ${(error as Error).message}`,
        'LocationManagementService',
        { userId, role, error: (error as Error).stack }
      );
      return null;
    }
  }

  /**
   * Get location details using LocationCacheService (shared cache) or ClinicLocationService
   */
  private async getLocationDetails(
    locationId: string
  ): Promise<{ id: string; name: string } | null> {
    try {
      // Try LocationCacheService first (shared cache)
      let location = null;
      if (this.locationCacheService) {
        location = await this.locationCacheService.getLocation(locationId, false);
      }

      // If not in cache, fetch from ClinicLocationService
      if (!location) {
        location = await this.clinicLocationService.getClinicLocationById(locationId, false);
      }

      if (!location) {
        return null;
      }
      // Extract id and name from location response
      const locationData = location as { id: string; name: string };
      return {
        id: locationData.id,
        name: locationData.name,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to get location details: ${(error as Error).message}`,
        'LocationManagementService',
        { locationId, error: (error as Error).stack }
      );
      return null;
    }
  }

  /**
   * Update location in role-specific table using DatabaseService with audit logging
   */
  private async updateRoleLocation(
    userId: string,
    role: string,
    locationId: string,
    clinicId: string,
    changedBy: string
  ): Promise<void> {
    // Create audit info for all location updates
    const auditInfo: AuditInfo = {
      userId: changedBy,
      clinicId,
      resourceType: 'USER_LOCATION',
      operation: 'UPDATE',
      resourceId: userId,
      userRole: 'system',
      details: { role, locationId, changedBy },
    };
    switch (role as Role) {
      case Role.DOCTOR:
      case Role.ASSISTANT_DOCTOR: {
        // First get doctorId from userId using DatabaseService
        const doctor = await this.databaseService.executeHealthcareRead<{
          id: string;
        } | null>(async readClient => {
          const readTypedClient = readClient as unknown as PrismaTransactionClientWithDelegates;
          const result = await readTypedClient.doctor.findFirst({
            where: { userId } as PrismaDelegateArgs,
            select: { id: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return result as { id: string } | null;
        });
        if (!doctor) {
          throw new BadRequestException(`Doctor record not found for user ${userId}`);
        }
        // Update doctorClinic location using DatabaseService with audit info
        await this.databaseService.executeHealthcareWrite(
          async writeClient => {
            const writeTypedClient =
              writeClient as unknown as PrismaTransactionClientWithDelegates & {
                doctorClinic: {
                  updateMany: (args: {
                    where: { doctorId: string; clinicId: string };
                    data: { locationId: string };
                  }) => Promise<unknown>;
                };
              };
            await writeTypedClient.doctorClinic.updateMany({
              where: { doctorId: doctor.id, clinicId },
              data: { locationId },
            });
          },
          { ...auditInfo, resourceType: 'DOCTOR_CLINIC', resourceId: doctor.id }
        );
        break;
      }
      case Role.LOCATION_HEAD:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              locationHead: {
                updateMany: (args: {
                  where: { userId: string; clinicId: string };
                  data: { locationId: string };
                }) => Promise<unknown>;
              };
            };
            await typedClient.locationHead.updateMany({
              where: { userId, clinicId },
              data: { locationId },
            });
          },
          { ...auditInfo, resourceType: 'LOCATION_HEAD' }
        );
        break;
      case Role.RECEPTIONIST:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            await typedClient.receptionist.updateMany({
              where: { userId, clinicId } as PrismaDelegateArgs,
              data: { locationId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          { ...auditInfo, resourceType: 'RECEPTIONIST' }
        );
        break;
      case Role.CLINIC_ADMIN:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            await typedClient.clinicAdmin.updateMany({
              where: { userId, clinicId } as PrismaDelegateArgs,
              data: { locationId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          { ...auditInfo, resourceType: 'CLINIC_ADMIN' }
        );
        break;
      case Role.PHARMACIST:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            await typedClient.pharmacist.updateMany({
              where: { userId, clinicId } as PrismaDelegateArgs,
              data: { locationId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          { ...auditInfo, resourceType: 'PHARMACIST' }
        );
        break;
      case Role.THERAPIST:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            await typedClient.therapist.updateMany({
              where: { userId, clinicId } as PrismaDelegateArgs,
              data: { locationId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          { ...auditInfo, resourceType: 'THERAPIST' }
        );
        break;
      case Role.LAB_TECHNICIAN:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            await typedClient.labTechnician.updateMany({
              where: { userId, clinicId } as PrismaDelegateArgs,
              data: { locationId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          { ...auditInfo, resourceType: 'LAB_TECHNICIAN' }
        );
        break;
      case Role.FINANCE_BILLING:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            await typedClient.financeBilling.updateMany({
              where: { userId, clinicId } as PrismaDelegateArgs,
              data: { locationId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          { ...auditInfo, resourceType: 'FINANCE_BILLING' }
        );
        break;
      case Role.SUPPORT_STAFF:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            await typedClient.supportStaff.updateMany({
              where: { userId, clinicId } as PrismaDelegateArgs,
              data: { locationId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          { ...auditInfo, resourceType: 'SUPPORT_STAFF' }
        );
        break;
      case Role.NURSE:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            await typedClient.nurse.updateMany({
              where: { userId, clinicId } as PrismaDelegateArgs,
              data: { locationId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          { ...auditInfo, resourceType: 'NURSE' }
        );
        break;
      case Role.COUNSELOR:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            await typedClient.counselor.updateMany({
              where: { userId, clinicId } as PrismaDelegateArgs,
              data: { locationId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          { ...auditInfo, resourceType: 'COUNSELOR' }
        );
        break;
      default:
        throw new BadRequestException(`Location change not supported for role: ${role}`);
    }
  }
}
