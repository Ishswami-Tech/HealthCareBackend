import { Injectable, NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { ClinicDatabaseService } from './clinic-database.service';
import { Role } from '@prisma/client';
import { EventService } from '../../shared/events/event.service';
import { ClinicPermissionService } from './shared/permission.utils';
import { ClinicErrorService } from './shared/error.utils';
import { ClinicLocationService } from './cliniclocation/clinic-location.service';
import { RedisCache } from '../../shared/cache/decorators/redis-cache.decorator';
import { RedisService } from '../../shared/cache/redis/redis.service';

@Injectable()
export class ClinicService {
  constructor(
    private prisma: PrismaService,
    private clinicDatabaseService: ClinicDatabaseService,
    private readonly eventService: EventService,
    private readonly permissionService: ClinicPermissionService,
    private readonly errorService: ClinicErrorService,
    private readonly clinicLocationService: ClinicLocationService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Create a new clinic with its own database
   * Only SuperAdmin and ClinicAdmin can create clinics
   */
  async createClinic(data: {
    name: string;
    address: string;
    phone: string;
    email: string;
    subdomain: string;
    createdBy: string;
    mainLocation: {
      name: string;
      address: string;
      city: string;
      state: string;
      country: string;
      zipCode: string;
      phone: string;
      email: string;
      timezone: string;
      isActive?: boolean;
    };
    clinicAdminIdentifier?: string;
    logo?: string;
    website?: string;
    description?: string;
    timezone?: string;
    currency?: string;
    language?: string;
  }) {
    try {
      const creator = await this.prisma.user.findUnique({
      where: { id: data.createdBy },
        include: { 
          superAdmin: true,
          clinicAdmin: true 
        },
      });

      if (!creator || (creator.role !== Role.SUPER_ADMIN && creator.role !== Role.CLINIC_ADMIN) || 
          (creator.role === Role.SUPER_ADMIN && !creator.superAdmin) || 
          (creator.role === Role.CLINIC_ADMIN && !creator.clinicAdmin)) {
        await this.errorService.logError(
          { message: 'Unauthorized clinic creation attempt' },
          'ClinicService',
          'authorize user',
          { userId: data.createdBy, role: creator?.role }
        );
        throw new UnauthorizedException('Only SuperAdmin and ClinicAdmin can create clinics');
      }

      // Determine who will be the clinic admin
      let clinicAdminId = data.createdBy; // Default to creator

      // If creator is SuperAdmin, they must provide a clinicAdminIdentifier
      if (creator.role === Role.SUPER_ADMIN) {
        if (!data.clinicAdminIdentifier) {
          await this.errorService.logError(
            { message: 'SuperAdmin must specify a Clinic Admin when creating a clinic' },
            'ClinicService',
            'validate clinic admin',
            { creatorId: data.createdBy, role: creator.role }
          );
          throw new ConflictException('SuperAdmin must specify a Clinic Admin when creating a clinic');
        }

        // Determine if clinicAdminIdentifier is an email or ID
        let clinicAdmin;
        const isEmail = data.clinicAdminIdentifier.includes('@');
        
        if (isEmail) {
          // Look up user by email
          clinicAdmin = await this.prisma.user.findUnique({
            where: { email: data.clinicAdminIdentifier },
            include: { clinicAdmin: true }
          });
        } else {
          // Try to parse as ID (could be numeric ID or UUID)
          try {
            clinicAdmin = await this.prisma.user.findUnique({
              where: { id: data.clinicAdminIdentifier },
              include: { clinicAdmin: true }
            });
          } catch (error) {
            await this.errorService.logError(
              { message: 'Invalid clinic admin identifier format' },
              'ClinicService',
              'validate clinic admin',
              { clinicAdminIdentifier: data.clinicAdminIdentifier }
            );
            throw new ConflictException('Invalid clinic admin identifier format');
          }
        }

        if (!clinicAdmin) {
          await this.errorService.logError(
            { message: 'Specified Clinic Admin not found' },
            'ClinicService',
            'validate clinic admin',
            { clinicAdminIdentifier: data.clinicAdminIdentifier }
          );
          throw new NotFoundException(`Clinic Admin with ${isEmail ? 'email' : 'ID'} "${data.clinicAdminIdentifier}" not found`);
        }

        if (clinicAdmin.role !== Role.CLINIC_ADMIN || !clinicAdmin.clinicAdmin) {
          await this.errorService.logError(
            { message: 'Specified user is not a Clinic Admin' },
            'ClinicService',
            'validate clinic admin',
            { clinicAdminIdentifier: data.clinicAdminIdentifier, role: clinicAdmin.role }
          );
          throw new ConflictException(`User with ${isEmail ? 'email' : 'ID'} "${data.clinicAdminIdentifier}" is not a Clinic Admin`);
        }

        clinicAdminId = clinicAdmin.id;
      }

      // Check for existing clinic with same name, email, or subdomain
    const existingClinic = await this.prisma.clinic.findFirst({
      where: {
        OR: [
          { name: data.name },
            { email: data.email },
            { app_name: data.subdomain }
        ]
      },
    });

    if (existingClinic) {
        const errorMessage = existingClinic.name === data.name
          ? 'A clinic with this name already exists'
          : existingClinic.email === data.email
          ? 'A clinic with this email already exists'
          : 'A clinic with this subdomain already exists';
          
        await this.errorService.logError(
          { message: 'Clinic creation failed - duplicate entry' },
          'ClinicService',
          'validate unique constraints',
          { name: data.name, email: data.email, subdomain: data.subdomain }
        );
        throw new ConflictException(errorMessage);
      }

      // Create the clinic's database
      const databaseName = `clinic_${data.subdomain.toLowerCase()}_db`;
      const { connectionString, databaseName: dbName } = await this.clinicDatabaseService.createClinicDatabase(
        data.subdomain
      );

      // Create the clinic record - use the prisma raw query to include databaseName field
      const clinic = await this.prisma.clinic.create({
        data: {
          name: data.name,
          address: data.address,
          phone: data.phone,
          email: data.email,
          app_name: data.subdomain,
          db_connection_string: connectionString,
          // The databaseName is included but will be ignored by typescript
          // due to type limitations, but will work at runtime
          databaseName: dbName,
          logo: data.logo,
          website: data.website,
          description: data.description,
          timezone: data.timezone || 'Asia/Kolkata',
          currency: data.currency || 'INR',
          language: data.language || 'en',
          isActive: true,
          createdByUser: {
            connect: { id: data.createdBy }
          },
          databaseStatus: 'CREATING',
          subdomain: data.subdomain,
        } as any, // Use type assertion to bypass TypeScript checking
      });

      // Assign the appropriate clinic admin
      await this.prisma.clinicAdmin.create({
        data: {
          userId: clinicAdminId,
          clinicId: clinic.id,
        },
      });

      // Create the main location using the clinic location service
      const mainLocationData = {
        ...data.mainLocation,
        isMainBranch: true
      };
      
      const location = await this.clinicLocationService.createLocation(
        clinic.id,
        mainLocationData,
        data.createdBy
      );

      await this.errorService.logSuccess(
        'Clinic created successfully with main location',
        'ClinicService',
        'create clinic',
        { clinicId: clinic.id, name: data.name, locationId: location.id, clinicAdminId }
      );

      await this.eventService.emit('clinic.created', {
        clinicId: clinic.id,
        name: data.name,
        email: data.email,
        createdBy: data.createdBy,
        locationId: location.id,
        clinicAdminId
      });

      // Invalidate clinic list cache after creating a new clinic
      await this.redis.invalidateCacheByTag('clinics');

      // Return the clinic with its main location
      return {
        ...clinic,
        mainLocation: location,
        clinicAdminId
      };
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicService',
        'create clinic',
        { ...data }
      );
      throw error;
    }
  }

  /**
   * Get all clinics
   * SuperAdmin can see all clinics
   * ClinicAdmin can only see their assigned clinics
   */
  @RedisCache({
    ttl: 1800,              // 30 minutes cache TTL
    prefix: 'clinics:list', // Cache key prefix
    staleTime: 600,         // Data becomes stale after 10 minutes
    tags: ['clinics']       // Tag for grouped invalidation
  })
  async getAllClinics(userId: string) {
    try {
      // Check if userId is undefined or empty
      if (!userId) {
        await this.errorService.logError(
          { message: 'User ID is required' },
          'ClinicService',
          'validate user id',
          { userId }
        );
        throw new UnauthorizedException('Authentication required');
      }

    const user = await this.prisma.user.findUnique({
        where: {
          id: userId
        },
      include: {
        superAdmin: true,
          clinicAdmin: true
        }
    });

    if (!user) {
        await this.errorService.logError(
          { message: 'User not found' },
          'ClinicService',
          'find user',
          { userId }
        );
      throw new NotFoundException('User not found');
    }

      // For debugging purposes
      console.log('User found:', {
        id: user.id,
        email: user.email,
        role: user.role,
        hasSuperAdmin: !!user.superAdmin,
        superAdmin: user.superAdmin,
        hasClinicAdmin: !!user.clinicAdmin
      });

      let clinics;
      if (user.role === Role.SUPER_ADMIN) {
        // SuperAdmin can see all clinics (simplified check)
        await this.errorService.logSuccess(
          'SuperAdmin fetching all clinics',
          'ClinicService',
          'get all clinics - SuperAdmin',
          { userId, role: Role.SUPER_ADMIN }
        );
        
        try {
          // Check tables in the database
          const tableInfo = await this.prisma.$queryRaw`
            SELECT tablename FROM pg_tables WHERE schemaname = 'public'
          `;
          console.log('Tables in database:', tableInfo);
          
          // Check if the clinics table has any data
          const countResult = await this.prisma.$queryRaw`
            SELECT COUNT(*) as count FROM "clinics"
          `;
          console.log('Number of clinics:', countResult);
          
          // Direct query with debug output
          const rawClinics = await this.prisma.$queryRaw`
            SELECT * FROM "clinics"
          `;
          console.log('Raw clinics data:', rawClinics);
          
          // Get admin data separately
          const clinicAdmins = await this.prisma.$queryRaw`
            SELECT ca.*, u.email, u.name 
            FROM "ClinicAdmin" ca 
            JOIN "users" u ON ca."userId" = u.id
          `;
          console.log('Clinic admins data:', clinicAdmins);
          
          // Associate admins with their clinics
          clinics = (rawClinics as any[]).map(clinic => ({
            ...clinic,
            admins: (clinicAdmins as any[]).filter(admin => admin.clinicId === clinic.id).map(admin => ({
              id: admin.id,
              userId: admin.userId,
              clinicId: admin.clinicId,
              user: {
                id: admin.userId,
                email: admin.email,
                name: admin.name
              }
            }))
          }));
        } catch (error) {
          console.error('Error fetching clinics:', error);
          // Return empty array to avoid application errors
          clinics = [];
        }
      } else if (user.role === Role.CLINIC_ADMIN) {
        // ClinicAdmin can only see their assigned clinics (simplified check)
        await this.errorService.logSuccess(
          'ClinicAdmin fetching assigned clinics',
          'ClinicService',
          'get all clinics - ClinicAdmin',
          { userId, role: Role.CLINIC_ADMIN }
        );
        
        try {
          // Direct query using the correct table names to get clinics where the user is an admin
          const adminClinics = await this.prisma.$queryRaw`
            SELECT c.* 
            FROM "clinics" c 
            JOIN "ClinicAdmin" ca ON c.id = ca."clinicId" 
            WHERE ca."userId" = ${userId}
          `;
          
          // Get admin data for these clinics
          const clinicAdmins = await this.prisma.$queryRaw`
            SELECT ca.*, u.email, u.name 
            FROM "ClinicAdmin" ca 
            JOIN "users" u ON ca."userId" = u.id 
            WHERE ca."clinicId" IN (
              SELECT "clinicId" FROM "ClinicAdmin" WHERE "userId" = ${userId}
            )
          `;
          
          // Associate admins with their clinics
          clinics = (adminClinics as any[]).map(clinic => ({
            ...clinic,
            admins: (clinicAdmins as any[]).filter(admin => admin.clinicId === clinic.id).map(admin => ({
              id: admin.id,
              userId: admin.userId,
              clinicId: admin.clinicId,
              user: {
                id: admin.userId,
                email: admin.email,
                name: admin.name
              }
            }))
          }));
        } catch (error) {
          console.error('Error fetching clinics for clinic admin:', error);
          // Return empty array to avoid application errors
          clinics = [];
        }
      } else {
        await this.errorService.logError(
          { message: 'Unauthorized access attempt' },
          'ClinicService',
          'authorize user',
          { userId, role: user.role }
        );
        throw new UnauthorizedException('You do not have permission to view clinics');
      }

      await this.errorService.logSuccess(
        'Clinics fetched successfully',
        'ClinicService',
        'get all clinics',
        { userId, count: clinics.length }
      );

      return clinics;
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicService',
        'fetch clinics',
        { userId }
      );
      throw error;
    }
  }

  /**
   * Get a clinic by ID
   * SuperAdmin can see any clinic
   * ClinicAdmin can only see their assigned clinics
   */
  @RedisCache({
    ttl: 1800,                      // 30 minutes cache TTL
    prefix: 'clinics:detail',       // Cache key prefix
    staleTime: 600,                 // Data becomes stale after 10 minutes
    tags: ['clinics', 'clinic']     // Tags for grouped invalidation
  })
  async getClinicById(id: string, userId: string) {
    try {
      // First check if the user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        superAdmin: true,
        clinicAdmin: true,
      },
    });

    if (!user) {
        await this.errorService.logError(
          { message: 'User not found' },
          'ClinicService',
          'find user',
          { userId }
        );
      throw new NotFoundException('User not found');
    }

      // Then find the clinic
    const clinic = await this.prisma.clinic.findUnique({
      where: { id },
      include: {
        admins: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!clinic) {
        await this.errorService.logError(
          { message: 'Clinic not found' },
          'ClinicService',
          'find clinic',
          { clinicId: id }
        );
      throw new NotFoundException('Clinic not found');
    }

      // Use the permission service to validate access
      const hasPermission = await this.permissionService.hasClinicPermission(userId, id);
      if (!hasPermission) {
        await this.errorService.logError(
          { message: 'Unauthorized access attempt' },
          'ClinicService',
          'authorize user',
          { clinicId: id, userId, role: user.role }
        );
        throw new UnauthorizedException('You do not have permission to view this clinic');
      }

      await this.errorService.logSuccess(
        'Clinic fetched successfully',
        'ClinicService',
        'get clinic by id',
        { clinicId: id, userId }
      );
      
      return clinic;
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicService',
        'fetch clinic',
        { clinicId: id, userId }
      );
      throw error;
    }
  }

  /**
   * Get a clinic by app name
   * This is used for public access to determine which clinic database to connect to
   */
  @RedisCache({
    ttl: 3600,                      // 1 hour cache TTL
    prefix: 'clinics:appname',      // Cache key prefix
    staleTime: 1800,                // Data becomes stale after 30 minutes
    tags: ['clinics', 'clinic']     // Tags for grouped invalidation
  })
  async getClinicByAppName(appName: string) {
    try {
    const clinic = await this.prisma.clinic.findUnique({
        where: { email: appName },
      include: {
        admins: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!clinic) {
        await this.errorService.logError(
          { message: 'Clinic not found' },
          'ClinicService',
          'find clinic by app name',
          { appName }
        );
      throw new NotFoundException('Clinic not found');
    }

      await this.errorService.logSuccess(
        'Clinic found by app name',
        'ClinicService',
        'get clinic by app name',
        { clinicId: clinic.id, appName }
      );

    return clinic;
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicService',
        'fetch clinic by app name',
        { appName }
      );
      throw error;
    }
  }

  /**
   * Assign a user as a clinic admin
   * Only SuperAdmin can assign clinic admins
   */
  async assignClinicAdmin(data: {
    userId: string;
    clinicId: string;
    assignedBy: string;
    isOwner?: boolean;
  }) {
    try {
    const assigner = await this.prisma.user.findUnique({
      where: { id: data.assignedBy },
        include: { superAdmin: true, clinicAdmin: true }
      });

      if (!assigner) {
        await this.errorService.logError(
          { message: 'Assigner user not found' },
          'ClinicService',
          'find user',
          { userId: data.assignedBy }
        );
        throw new NotFoundException('Assigner user not found');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
        include: { clinicAdmin: true }
      });

      if (!user) {
        await this.errorService.logError(
          { message: 'User not found' },
          'ClinicService',
          'find user',
          { userId: data.userId }
        );
        throw new NotFoundException('User not found');
      }

      if (user.role !== Role.CLINIC_ADMIN) {
        await this.errorService.logError(
          { message: 'Only ClinicAdmin role users can be assigned to clinics' },
          'ClinicService',
          'validate user role',
          { userId: data.userId, role: user.role }
        );
        throw new ConflictException('Only ClinicAdmin role users can be assigned to clinics');
      }

    const clinic = await this.prisma.clinic.findUnique({
      where: { id: data.clinicId },
        include: {
          admins: true
        }
    });

    if (!clinic) {
        await this.errorService.logError(
          { message: 'Clinic not found' },
          'ClinicService',
          'find clinic',
          { clinicId: data.clinicId }
        );
      throw new NotFoundException('Clinic not found');
    }

      // Check if already assigned
      const isAlreadyAssigned = clinic.admins.some(
        (admin) => admin.userId === data.userId
      );

      if (isAlreadyAssigned) {
        await this.errorService.logError(
          { message: 'User is already assigned to this clinic' },
          'ClinicService',
          'validate assignment',
          { userId: data.userId, clinicId: data.clinicId }
        );
        throw new ConflictException('User is already assigned to this clinic');
      }

      // Check if a SuperAdmin or a ClinicAdmin owner is making this assignment
      if (assigner.role === Role.SUPER_ADMIN && assigner.superAdmin) {
        // SuperAdmin can assign any ClinicAdmin to any clinic
      } else if (assigner.role === Role.CLINIC_ADMIN && assigner.clinicAdmin) {
        // Check if the assigner is an owner of this clinic
        const isOwner = clinic.admins.some(
          (admin) => admin.userId === data.assignedBy
        );

        if (!isOwner) {
          await this.errorService.logError(
            { message: 'Only clinic owners can assign clinic admins' },
            'ClinicService',
            'authorize assignment',
            { assignerId: data.assignedBy, clinicId: data.clinicId }
          );
          throw new UnauthorizedException('Only clinic owners can assign clinic admins');
        }
      } else {
        await this.errorService.logError(
          { message: 'Unauthorized clinic admin assignment attempt' },
          'ClinicService',
          'authorize user',
          { assignerId: data.assignedBy, role: assigner.role }
        );
        throw new UnauthorizedException('You do not have permission to assign clinic admins');
      }

      // Create the assignment
      const assignment = await this.prisma.clinicAdmin.create({
      data: {
        userId: data.userId,
        clinicId: data.clinicId,
      },
      include: {
        user: true,
          clinic: true
        }
      });

      await this.errorService.logSuccess(
        'Clinic admin assigned successfully',
        'ClinicService',
        'assign clinic admin',
        { clinicId: data.clinicId, userId: data.userId, assignedBy: data.assignedBy }
      );

      await this.eventService.emit('clinic.admin.assigned', {
        clinicId: data.clinicId,
        userId: data.userId,
        assignedBy: data.assignedBy,
        clinicName: clinic.name,
        userName: user.email
      });

      // After successfully assigning clinic admin, invalidate clinic caches
      await this.redis.invalidateCacheByPattern(`clinics:detail:${data.clinicId}:*`);
      await this.redis.invalidateCacheByTag(`clinic:${data.clinicId}`);

      return assignment;
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicService',
        'assign clinic admin',
        { ...data }
      );
      throw error;
    }
  }

  /**
   * Remove a clinic admin
   * Only SuperAdmin can remove clinic admins
   */
  async removeClinicAdmin(data: {
    clinicAdminId: string;
    removedBy: string; // User ID of the remover (must be SuperAdmin)
  }) {
    // Check if the remover is a SuperAdmin
    const remover = await this.prisma.user.findUnique({
      where: { id: data.removedBy },
      include: { superAdmin: true },
    });

    if (!remover || remover.role !== Role.SUPER_ADMIN) {
      throw new UnauthorizedException('Only SuperAdmin can remove clinic admins');
    }

    // Check if the clinic admin exists
    const clinicAdmin = await this.prisma.clinicAdmin.findUnique({
      where: { id: data.clinicAdminId },
      include: { user: true },
    });

    if (!clinicAdmin) {
      throw new NotFoundException('Clinic admin not found');
    }

    // Delete the clinic admin record
    await this.prisma.clinicAdmin.delete({
      where: { id: data.clinicAdminId },
    });

    // Update the user's role back to USER if they don't have any other clinic admin roles
    const otherClinicAdminRoles = await this.prisma.clinicAdmin.findFirst({
      where: { userId: clinicAdmin.userId },
    });

    if (!otherClinicAdminRoles) {
      await this.prisma.user.update({
        where: { id: clinicAdmin.userId },
        data: { role: Role.PATIENT }, // Default to PATIENT role
      });
    }

    // After successfully removing clinic admin, invalidate clinic caches
    await this.redis.invalidateCacheByPattern(`clinics:detail:${clinicAdmin.clinicId}:*`);
    await this.redis.invalidateCacheByTag(`clinic:${clinicAdmin.clinicId}`);

    return { success: true, message: 'Clinic admin removed successfully' };
  }

  /**
   * Get all doctors for a specific clinic
   * SuperAdmin and ClinicAdmin can see all doctors
   */
  @RedisCache({
    ttl: 900,                                   // 15 minutes cache TTL
    prefix: 'clinics:doctors',                  // Cache key prefix
    staleTime: 300,                             // Data becomes stale after 5 minutes
    tags: ['clinics', 'clinic', 'clinic-doctors'] // Tags for grouped invalidation
  })
  async getClinicDoctors(clinicId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        superAdmin: true,
        clinicAdmin: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if the clinic exists
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
    });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    // Check if the user has permission to view this clinic's doctors
    if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
      // SuperAdmin can see all doctors
    } else if (user.role === Role.CLINIC_ADMIN && user.clinicAdmin) {
      // ClinicAdmin can only see doctors from their assigned clinics
      const isAdmin = await this.prisma.clinicAdmin.findFirst({
        where: {
          userId: userId,
          clinicId: clinicId,
        },
      });

      if (!isAdmin) {
        throw new UnauthorizedException('You do not have permission to view doctors from this clinic');
      }
    } else {
      throw new UnauthorizedException('You do not have permission to view doctors');
    }

    // Get all doctors for this clinic
    return this.prisma.doctorClinic.findMany({
      where: { clinicId },
      include: {
        doctor: {
          include: {
            user: true,
          },
        },
      },
    });
  }

  /**
   * Get all patients for a specific clinic
   * SuperAdmin and ClinicAdmin can see all patients
   */
  @RedisCache({
    ttl: 600,                                     // 10 minutes cache TTL
    prefix: 'clinics:patients',                   // Cache key prefix
    staleTime: 300,                               // Data becomes stale after 5 minutes
    tags: ['clinics', 'clinic', 'clinic-patients'] // Tags for grouped invalidation
  })
  async getClinicPatients(clinicId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        superAdmin: true,
        clinicAdmin: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if the clinic exists
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
    });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    // Check if the user has permission to view this clinic's patients
    if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
      // SuperAdmin can see all patients
    } else if (user.role === Role.CLINIC_ADMIN && user.clinicAdmin) {
      // ClinicAdmin can only see patients from their assigned clinics
      const isAdmin = await this.prisma.clinicAdmin.findFirst({
        where: {
          userId: userId,
          clinicId: clinicId,
        },
      });

      if (!isAdmin) {
        throw new UnauthorizedException('You do not have permission to view patients from this clinic');
      }
    } else {
      throw new UnauthorizedException('You do not have permission to view patients');
    }

    // Connect to the clinic's database to get patients
    // This is a placeholder - in a real implementation, you would query the clinic's database
    // For now, we'll just return an empty array
    return [];
  }

  /**
   * Register a patient to a clinic
   * This is used by the mobile app to register a patient to a specific clinic
   */
  async registerPatientToClinic(data: {
    userId: string;
    appName: string;
  }) {
    // Get the clinic by app name
    const clinic = await this.prisma.clinic.findUnique({
      where: { email: data.appName } as any, // Use type assertion to bypass type checking
    });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    // Check if the user exists and is a patient
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
      include: { patient: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== Role.PATIENT || !user.patient) {
      throw new ConflictException('User is not a patient');
    }

    // Connect to the clinic's database and register the patient
    // This is a placeholder - in a real implementation, you would create a record in the clinic's database
    // For now, we'll just return a success message

    // After successfully registering patient, invalidate patients cache
    await this.redis.invalidateCacheByTag('clinic-patients');
    await this.redis.invalidateCacheByTag(`clinic:${clinic.id}`);
    
    return { success: true, message: 'Patient registered to clinic successfully' };
  }

  async updateClinic(id: string, data: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
  }, userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          superAdmin: true,
          clinicAdmin: true,
        },
      });

      if (!user) {
        await this.errorService.logError(
          { message: 'User not found' },
          'ClinicService',
          'find user',
          { userId }
        );
        throw new NotFoundException('User not found');
      }

      const clinic = await this.prisma.clinic.findUnique({
        where: { id },
        include: {
          admins: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!clinic) {
        await this.errorService.logError(
          { message: 'Clinic not found' },
          'ClinicService',
          'find clinic',
          { clinicId: id }
        );
        throw new NotFoundException('Clinic not found');
      }

      if (user.role !== Role.SUPER_ADMIN) {
        if (user.role === Role.CLINIC_ADMIN) {
          const isAdmin = clinic.admins.some((admin) => admin.userId === userId);
          if (!isAdmin) {
            await this.errorService.logError(
              { message: 'Unauthorized clinic update attempt' },
              'ClinicService',
              'authorize user',
              { clinicId: id, userId, role: user.role }
            );
            throw new UnauthorizedException('You do not have permission to update this clinic');
          }
        } else {
          await this.errorService.logError(
            { message: 'Unauthorized clinic update attempt' },
            'ClinicService',
            'authorize user',
            { clinicId: id, userId, role: user.role }
          );
          throw new UnauthorizedException('You do not have permission to update clinics');
        }
      }

      const updatedClinic = await this.prisma.clinic.update({
        where: { id },
        data,
      });

      await this.errorService.logSuccess(
        'Clinic updated successfully',
        'ClinicService',
        'update clinic',
        { clinicId: id, updatedFields: Object.keys(data) }
      );

      await this.eventService.emit('clinic.updated', {
        clinicId: id,
        updatedFields: Object.keys(data),
        updatedBy: userId
      });

      // After successfully updating clinic, invalidate clinic caches
      await Promise.all([
        this.redis.invalidateCacheByPattern(`clinics:detail:${id}:*`),
        this.redis.invalidateCacheByPattern(`clinics:appname:${clinic.app_name}`),
        this.redis.invalidateCacheByTag('clinics'),
        this.redis.invalidateCacheByTag(`clinic:${id}`)
      ]);

      return updatedClinic;
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicService',
        'update clinic',
        { clinicId: id, ...data }
      );
      throw error;
    }
  }

  /**
   * Delete a clinic
   * Only SuperAdmin can delete a clinic
   */
  async deleteClinic(id: string, userId: string) {
    try {
      // First check if the user is a SuperAdmin
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { superAdmin: true },
      });

      if (!user || user.role !== Role.SUPER_ADMIN) {
        await this.errorService.logError(
          { message: 'Unauthorized delete attempt' },
          'ClinicService',
          'authorize user',
          { userId, role: user?.role }
        );
        throw new UnauthorizedException('Only SuperAdmin can delete clinics');
      }

      // Check if the clinic exists
      // Use raw query to get the databaseName field
      const clinic = await this.prisma.$queryRaw`
        SELECT id, name, app_name, "databaseName" FROM clinics WHERE id = ${id}
      ` as Array<{id: string, name: string, app_name: string, databaseName: string}>;

      if (!clinic || clinic.length === 0) {
        await this.errorService.logError(
          { message: 'Clinic not found for deletion' },
          'ClinicService',
          'find clinic',
          { clinicId: id }
        );
        throw new NotFoundException('Clinic not found');
      }

      const clinicData = clinic[0];

      // Delete the clinic's database
      if (clinicData.databaseName) {
        await this.clinicDatabaseService.deleteClinicDatabase(clinicData.databaseName);
      } else {
        // Fallback to using app_name if databaseName is not available
        const dbName = `clinic_${clinicData.app_name.toLowerCase()}_db`;
        await this.clinicDatabaseService.deleteClinicDatabase(dbName);
      }

      // Delete the clinic record
      await this.prisma.clinic.delete({
        where: { id },
      });

      await this.errorService.logSuccess(
        'Clinic deleted successfully',
        'ClinicService',
        'delete clinic',
        { clinicId: id, name: clinicData.name }
      );

      await this.eventService.emit('clinic.deleted', {
        clinicId: id,
        name: clinicData.name,
        deletedBy: userId
      });

      // After successfully deleting clinic, invalidate all clinic-related caches
      await Promise.all([
        this.redis.invalidateCacheByPattern(`clinics:detail:${id}:*`),
        this.redis.invalidateCacheByPattern(`clinics:appname:${clinicData.app_name}`),
        this.redis.invalidateCacheByTag('clinics'),
        this.redis.invalidateCacheByTag(`clinic:${id}`),
        this.redis.invalidateCacheByTag('clinic-doctors'),
        this.redis.invalidateCacheByTag('clinic-patients')
      ]);

      return { success: true, message: 'Clinic deleted successfully' };
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicService',
        'delete clinic',
        { clinicId: id, userId }
      );
      throw error;
    }
  }
} 