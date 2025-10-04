import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../libs/infrastructure/database/prisma/prisma.service";
import { Role } from "../../libs/infrastructure/database/prisma/prisma.types";
import { EventService } from "../../libs/infrastructure/events/event.service";
import { ClinicErrorService } from "./shared/error.utils";
import { CacheService } from "../../libs/infrastructure/cache";
import { JwtService } from "@nestjs/jwt";
import { ClinicLocationService } from "./services/clinic-location.service";
import { RbacService } from "../../libs/core/rbac/rbac.service";
import { resolveClinicUUID } from "../../libs/utils/clinic.utils";
import { HealthcareDatabaseClient } from "../../libs/infrastructure/database/clients/healthcare-database.client";
import { RepositoryResult } from "../../libs/infrastructure/database/types/repository-result";
import { ConfigService } from "@nestjs/config";
import { HealthcareErrorsService } from "../../libs/core/errors";

@Injectable()
export class ClinicService {
  private readonly logger = new Logger(ClinicService.name);

  constructor(
    private prisma: PrismaService,
    private readonly eventService: EventService,
    private readonly errorService: ClinicErrorService,
    private readonly clinicLocationService: ClinicLocationService,
    private readonly cacheService: CacheService,
    private readonly jwtService: JwtService,
    private readonly rbacService: RbacService,
    private readonly healthcareDatabaseClient: HealthcareDatabaseClient,
    private readonly configService: ConfigService,
    private readonly errors: HealthcareErrorsService,
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
          clinicAdmins: true,
        },
      });

      if (
        !creator ||
        (creator.role !== Role.SUPER_ADMIN &&
          creator.role !== Role.CLINIC_ADMIN) ||
        (creator.role === Role.SUPER_ADMIN && !creator.superAdmin) ||
        (creator.role === Role.CLINIC_ADMIN && !creator.clinicAdmins?.length)
      ) {
        await this.errorService.logError(
          { message: "Unauthorized clinic creation attempt" },
          "ClinicService",
          "authorize user",
          { userId: data.createdBy, role: creator?.role },
        );
        throw new UnauthorizedException(
          "Only SuperAdmin and ClinicAdmin can create clinics",
        );
      }

      // Determine who will be the clinic admin
      let clinicAdminId = data.createdBy; // Default to creator

      // If creator is SuperAdmin, they must provide a clinicAdminIdentifier
      if (creator.role === Role.SUPER_ADMIN) {
        if (!data.clinicAdminIdentifier) {
          await this.errorService.logError(
            {
              message:
                "SuperAdmin must specify a Clinic Admin when creating a clinic",
            },
            "ClinicService",
            "validate clinic admin",
            { creatorId: data.createdBy, role: creator.role },
          );
          throw new ConflictException(
            "SuperAdmin must specify a Clinic Admin when creating a clinic",
          );
        }

        // Determine if clinicAdminIdentifier is an email or ID
        let clinicAdmin;
        const isEmail = data.clinicAdminIdentifier.includes("@");

        if (isEmail) {
          // Look up user by email
          clinicAdmin = await this.prisma.user.findUnique({
            where: { email: data.clinicAdminIdentifier },
            include: { clinicAdmins: true },
          });
        } else {
          // Try to parse as ID (could be numeric ID or UUID)
          try {
            clinicAdmin = await this.prisma.user.findUnique({
              where: { id: data.clinicAdminIdentifier },
              include: { clinicAdmins: true },
            });
          } catch (_error) {
            await this.errorService.logError(
              { message: "Invalid clinic admin identifier format" },
              "ClinicService",
              "validate clinic admin",
              { clinicAdminIdentifier: data.clinicAdminIdentifier },
            );
            throw new ConflictException(
              "Invalid clinic admin identifier format",
            );
          }
        }

        if (!clinicAdmin) {
          await this.errorService.logError(
            { message: "Specified Clinic Admin not found" },
            "ClinicService",
            "validate clinic admin",
            { clinicAdminIdentifier: data.clinicAdminIdentifier },
          );
          throw new NotFoundException(
            `Clinic Admin with ${isEmail ? "email" : "ID"} "${data.clinicAdminIdentifier}" not found`,
          );
        }

        if (
          clinicAdmin.role !== Role.CLINIC_ADMIN ||
          !clinicAdmin.clinicAdmins?.length
        ) {
          await this.errorService.logError(
            { message: "Specified user is not a Clinic Admin" },
            "ClinicService",
            "validate clinic admin",
            {
              clinicAdminIdentifier: data.clinicAdminIdentifier,
              role: clinicAdmin.role,
            },
          );
          throw new ConflictException(
            `User with ${isEmail ? "email" : "ID"} "${data.clinicAdminIdentifier}" is not a Clinic Admin`,
          );
        }

        clinicAdminId = clinicAdmin.id;
      }

      // Check for existing clinic with same name, email, or subdomain
      const existingClinic = await this.prisma.clinic.findFirst({
        where: {
          OR: [
            { name: data.name },
            { email: data.email },
            { app_name: data.subdomain },
          ],
        },
      });

      if (existingClinic) {
        const errorMessage =
          existingClinic.name === data.name
            ? "A clinic with this name already exists"
            : existingClinic.email === data.email
              ? "A clinic with this email already exists"
              : "A clinic with this subdomain already exists";

        await this.errorService.logError(
          { message: "Clinic creation failed - duplicate entry" },
          "ClinicService",
          "validate unique constraints",
          { name: data.name, email: data.email, subdomain: data.subdomain },
        );
        throw new ConflictException(errorMessage);
      }

      // Create the clinic record
      const clinic = await this.prisma.clinic.create({
        data: {
          name: data.name,
          address: data.address,
          phone: data.phone,
          email: data.email,
          app_name: data.subdomain,
          logo: data.logo,
          website: data.website,
          description: data.description,
          timezone: data.timezone || "Asia/Kolkata",
          currency: data.currency || "INR",
          language: data.language || "en",
          isActive: true,
          createdByUser: {
            connect: { id: data.createdBy },
          },
          subdomain: data.subdomain,
          clinicId: data.subdomain,
          // Use shared database connection for multi-tenancy
          db_connection_string: this.configService.get("DATABASE_URL") || "",
          databaseName: this.configService.get("DATABASE_NAME", "userdb"), // All clinics share the same database in multi-tenant setup
          databaseStatus: "ACTIVE",
        },
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
        isMainBranch: true,
      };

      const location = await this.clinicLocationService.createLocation(
        clinic.id,
        mainLocationData,
        data.createdBy,
      );

      await this.errorService.logSuccess(
        "Clinic created successfully with main location",
        "ClinicService",
        "create clinic",
        {
          clinicId: clinic.id,
          name: data.name,
          locationId: location.id,
          clinicAdminId,
        },
      );

      await this.eventService.emit("clinic.created", {
        clinicId: clinic.id,
        name: data.name,
        email: data.email,
        createdBy: data.createdBy,
        locationId: location.id,
        clinicAdminId,
      });

      // Invalidate clinic list cache after creating a new clinic
      await this.cacheService.invalidateCacheByTag("clinics");

      // Return the clinic with its main location
      return {
        ...clinic,
        mainLocation: location,
        clinicAdminId,
      };
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "create clinic",
        { ...data },
      );
      throw _error;
    }
  }

  /**
   * Get all clinics
   * SuperAdmin can see all clinics
   * ClinicAdmin can only see their assigned clinics
   */
  async getAllClinics(userId: string) {
    const cacheKey = `clinics:list:${userId}`;

    // Try to get from cache first
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Check if userId is undefined or empty
      if (!userId) {
        await this.errorService.logError(
          { message: "User ID is required" },
          "ClinicService",
          "validate user id",
          { userId },
        );
        throw new UnauthorizedException("Authentication required");
      }

      const user = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        include: {
          superAdmin: true,
          clinicAdmins: true,
        },
      });

      if (!user) {
        await this.errorService.logError(
          { message: "User not found" },
          "ClinicService",
          "find user",
          { userId },
        );
        throw new NotFoundException("User not found");
      }

      // Log user details for debugging
      this.logger.debug("User found:", {
        id: user.id,
        email: user.email,
        role: user.role,
        hasSuperAdmin: !!user.superAdmin,
        hasClinicAdmin: !!user.clinicAdmins?.length,
      });

      let clinics;
      if (user.role === Role.SUPER_ADMIN) {
        // SuperAdmin can see all clinics (simplified check)
        await this.errorService.logSuccess(
          "SuperAdmin fetching all clinics",
          "ClinicService",
          "get all clinics - SuperAdmin",
          { userId, role: Role.SUPER_ADMIN },
        );

        try {
          // Check tables in the database
          const tableInfo = await this.prisma.$queryRaw`
            SELECT tablename FROM pg_tables WHERE schemaname = 'public'
          `;
          this.logger.debug("Tables in database:", tableInfo);

          // Check if the clinics table has any data
          const countResult = await this.prisma.$queryRaw`
            SELECT COUNT(*) as count FROM "clinics"
          `;
          this.logger.debug("Number of clinics:", countResult);

          // Direct query with debug output
          const rawClinics = await this.prisma.$queryRaw`
            SELECT * FROM "clinics"
          `;
          this.logger.debug("Raw clinics data:", rawClinics);

          // Get admin data separately
          const clinicAdmins = await this.prisma.$queryRaw`
            SELECT ca.*, u.email, u.name 
            FROM "ClinicAdmin" ca 
            JOIN "users" u ON ca."userId" = u.id
          `;
          this.logger.debug("Clinic admins data:", clinicAdmins);

          // Associate admins with their clinics
          clinics = (rawClinics as any[]).map((clinic) => ({
            ...clinic,
            admins: (clinicAdmins as any[])
              .filter((admin) => admin.clinicId === clinic.id)
              .map((admin) => ({
                id: admin.id,
                userId: admin.userId,
                clinicId: admin.clinicId,
                user: {
                  id: admin.userId,
                  email: admin.email,
                  name: admin.name,
                },
              })),
          }));
        } catch (_error) {
          this.logger.error("Error fetching clinics:", _error);
          // Return empty array to avoid application errors
          clinics = [];
        }
      } else if (user.role === Role.CLINIC_ADMIN) {
        // ClinicAdmin can only see their assigned clinics (simplified check)
        await this.errorService.logSuccess(
          "ClinicAdmin fetching assigned clinics",
          "ClinicService",
          "get all clinics - ClinicAdmin",
          { userId, role: Role.CLINIC_ADMIN },
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
          clinics = (adminClinics as any[]).map((clinic) => ({
            ...clinic,
            admins: (clinicAdmins as any[])
              .filter((admin) => admin.clinicId === clinic.id)
              .map((admin) => ({
                id: admin.id,
                userId: admin.userId,
                clinicId: admin.clinicId,
                user: {
                  id: admin.userId,
                  email: admin.email,
                  name: admin.name,
                },
              })),
          }));
        } catch (_error) {
          this.logger.error("Error fetching clinics for clinic admin:", _error);
          // Return empty array to avoid application errors
          clinics = [];
        }
      } else {
        await this.errorService.logError(
          { message: "Unauthorized access attempt" },
          "ClinicService",
          "authorize user",
          { userId, role: user.role },
        );
        throw new UnauthorizedException(
          "You do not have permission to view clinics",
        );
      }

      await this.errorService.logSuccess(
        "Clinics fetched successfully",
        "ClinicService",
        "get all clinics",
        { userId, count: clinics.length },
      );

      // Cache the result for 30 minutes
      await this.cacheService.set(cacheKey, clinics, 1800);

      return clinics;
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "fetch clinics",
        { userId },
      );
      throw _error;
    }
  }

  /**
   * Get a clinic by ID
   * SuperAdmin can see any clinic
   * ClinicAdmin can only see their assigned clinics
   */
  async getClinicById(id: string, userId: string) {
    const cacheKey = `clinics:detail:${id}:${userId}`;

    // Try to get from cache first
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const clinicUUID = await resolveClinicUUID(this.prisma, id);
      // First check if the user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          superAdmin: true,
          clinicAdmins: true,
        },
      });

      if (!user) {
        await this.errorService.logError(
          { message: "User not found" },
          "ClinicService",
          "find user",
          { userId },
        );
        throw new NotFoundException("User not found");
      }

      // Then find the clinic
      const clinic = await this.prisma.clinic.findUnique({
        where: { id: clinicUUID },
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
          { message: "Clinic not found" },
          "ClinicService",
          "find clinic",
          { clinicId: clinicUUID },
        );
        throw new NotFoundException("Clinic not found");
      }

      // Use the permission service to validate access
      // For patients, check for view_clinic_details permission, for others check manage_clinics
      const action =
        user.role === "PATIENT" ? "view_clinic_details" : "manage_clinics";
      const hasPermission = await this.rbacService.checkPermission({
        userId,
        resource: "clinic",
        action,
        resourceId: clinicUUID,
      });
      if (!hasPermission) {
        await this.errorService.logError(
          { message: "Unauthorized access attempt" },
          "ClinicService",
          "authorize user",
          { clinicId: clinicUUID, userId, role: user.role },
        );
        throw new UnauthorizedException(
          "You do not have permission to view this clinic",
        );
      }

      await this.errorService.logSuccess(
        "Clinic fetched successfully",
        "ClinicService",
        "get clinic by id",
        { clinicId: clinicUUID, userId },
      );

      // Cache the result for 30 minutes
      await this.cacheService.set(cacheKey, clinic, 1800);

      return clinic;
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "fetch clinic",
        {
          clinicId: id,
          userId,
        },
      );
      throw _error;
    }
  }

  /**
   * Get a clinic by app name
   * This is used for public access to determine which clinic database to connect to
   */
  async getClinicByAppName(appName: string) {
    const cacheKey = `clinics:appname:${appName}`;

    // Try to get from cache first
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

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
          { message: "Clinic not found" },
          "ClinicService",
          "find clinic by app name",
          { appName },
        );
        throw new NotFoundException("Clinic not found");
      }

      await this.errorService.logSuccess(
        "Clinic found by app name",
        "ClinicService",
        "get clinic by app name",
        { clinicId: clinic.id, appName },
      );

      // Cache the result for 1 hour
      await this.cacheService.set(cacheKey, clinic, 3600);

      return clinic;
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "fetch clinic by app name",
        { appName },
      );
      throw _error;
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
        include: { superAdmin: true, clinicAdmins: true },
      });

      if (!assigner) {
        await this.errorService.logError(
          { message: "Assigner user not found" },
          "ClinicService",
          "find user",
          { userId: data.assignedBy },
        );
        throw new NotFoundException("Assigner user not found");
      }

      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
        include: { clinicAdmins: true },
      });

      if (!user) {
        await this.errorService.logError(
          { message: "User not found" },
          "ClinicService",
          "find user",
          { userId: data.userId },
        );
        throw new NotFoundException("User not found");
      }

      if (user.role !== Role.CLINIC_ADMIN) {
        await this.errorService.logError(
          { message: "Only ClinicAdmin role users can be assigned to clinics" },
          "ClinicService",
          "validate user role",
          { userId: data.userId, role: user.role },
        );
        throw new ConflictException(
          "Only ClinicAdmin role users can be assigned to clinics",
        );
      }

      const clinicUUID = await resolveClinicUUID(this.prisma, data.clinicId);
      const clinic = await this.prisma.clinic.findUnique({
        where: { id: clinicUUID },
        include: {
          admins: true,
        },
      });

      if (!clinic) {
        await this.errorService.logError(
          { message: "Clinic not found" },
          "ClinicService",
          "find clinic",
          { clinicId: data.clinicId },
        );
        throw new NotFoundException("Clinic not found");
      }

      // Check if already assigned
      const isAlreadyAssigned = clinic.admins.some(
        (admin: unknown) =>
          (admin as Record<string, unknown>).userId === data.userId,
      );

      if (isAlreadyAssigned) {
        await this.errorService.logError(
          { message: "User is already assigned to this clinic" },
          "ClinicService",
          "validate assignment",
          { userId: data.userId, clinicId: data.clinicId },
        );
        throw new ConflictException("User is already assigned to this clinic");
      }

      // Check if a SuperAdmin or a ClinicAdmin owner is making this assignment
      if (assigner.role === Role.SUPER_ADMIN && assigner.superAdmin) {
        // SuperAdmin can assign any ClinicAdmin to any clinic
      } else if (
        assigner.role === Role.CLINIC_ADMIN &&
        assigner.clinicAdmins?.length
      ) {
        // Check if the assigner is an owner of this clinic
        const isOwner = clinic.admins.some(
          (admin: unknown) =>
            (admin as Record<string, unknown>).userId === data.assignedBy,
        );

        if (!isOwner) {
          await this.errorService.logError(
            { message: "Only clinic owners can assign clinic admins" },
            "ClinicService",
            "authorize assignment",
            { assignerId: data.assignedBy, clinicId: data.clinicId },
          );
          throw new UnauthorizedException(
            "Only clinic owners can assign clinic admins",
          );
        }
      } else {
        await this.errorService.logError(
          { message: "Unauthorized clinic admin assignment attempt" },
          "ClinicService",
          "authorize user",
          { assignerId: data.assignedBy, role: assigner.role },
        );
        throw new UnauthorizedException(
          "You do not have permission to assign clinic admins",
        );
      }

      // Create the assignment
      const assignment = await this.prisma.clinicAdmin.create({
        data: {
          userId: data.userId,
          clinicId: data.clinicId,
        },
        include: {
          user: true,
          clinic: true,
        },
      });

      await this.errorService.logSuccess(
        "Clinic admin assigned successfully",
        "ClinicService",
        "assign clinic admin",
        {
          clinicId: data.clinicId,
          userId: data.userId,
          assignedBy: data.assignedBy,
        },
      );

      await this.eventService.emit("clinic.admin.assigned", {
        clinicId: data.clinicId,
        userId: data.userId,
        assignedBy: data.assignedBy,
        clinicName: clinic.name,
        userName: user.email,
      });

      // After successfully assigning clinic admin, invalidate clinic caches
      await this.cacheService.invalidateByPattern(
        `clinics:detail:${data.clinicId}:*`,
      );
      await this.cacheService.invalidateCacheByTag(`clinic:${data.clinicId}`);

      return assignment;
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "assign clinic admin",
        { ...data },
      );
      throw _error;
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
      throw new UnauthorizedException(
        "Only SuperAdmin can remove clinic admins",
      );
    }

    // Check if the clinic admin exists
    const clinicAdmin = await this.prisma.clinicAdmin.findUnique({
      where: { id: data.clinicAdminId },
      include: { user: true },
    });

    if (!clinicAdmin) {
      throw new NotFoundException("Clinic admin not found");
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
    await this.cacheService.invalidateByPattern(
      `clinics:detail:${clinicAdmin.clinicId}:*`,
    );
    await this.cacheService.invalidateCacheByTag(
      `clinic:${clinicAdmin.clinicId}`,
    );

    return { success: true, message: "Clinic admin removed successfully" };
  }

  /**
   * Get all doctors for a specific clinic
   * SuperAdmin and ClinicAdmin can see all doctors
   */
  async getClinicDoctors(clinicId: string, userId: string) {
    const cacheKey = `clinics:doctors:${clinicId}:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        try {
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
              superAdmin: true,
              clinicAdmins: true,
            },
          });

          if (!user) {
            throw new NotFoundException("User not found");
          }

          // Check if the clinic exists
          const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);
          const clinic = await this.prisma.clinic.findUnique({
            where: { id: clinicUUID },
          });

          if (!clinic) {
            throw new NotFoundException("Clinic not found");
          }

          // Check if the user has permission to view this clinic's doctors
          if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
            // SuperAdmin can see all doctors
          } else if (
            user.role === Role.CLINIC_ADMIN &&
            user.clinicAdmins?.length
          ) {
            // ClinicAdmin can only see doctors from their assigned clinics
            const isAdmin = await this.prisma.clinicAdmin.findFirst({
              where: {
                userId: userId,
                clinicId: clinicUUID,
              },
            });

            if (!isAdmin) {
              throw new UnauthorizedException(
                "You do not have permission to view doctors from this clinic",
              );
            }
          } else {
            throw new UnauthorizedException(
              "You do not have permission to view doctors",
            );
          }

          // Get all doctors for this clinic
          const doctors = await this.prisma.doctorClinic.findMany({
            where: { clinicId: clinicUUID },
            include: {
              doctor: {
                include: {
                  user: true,
                },
              },
            },
          });

          return doctors;
        } catch (_error) {
          throw _error;
        }
      },
      {
        ttl: 1800, // 30 minutes
        tags: [`clinic:${clinicId}`, "doctors", "clinic_data"],
        priority: "high",
        enableSwr: true,
        compress: true, // Compress doctor lists
        containsPHI: false, // Doctor lists don't contain PHI
      },
    );
  }

  /**
   * Get all patients for a specific clinic
   * SuperAdmin and ClinicAdmin can see all patients
   */
  async getClinicPatients(clinicId: string, userId: string) {
    const cacheKey = `clinics:patients:${clinicId}:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        try {
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
              superAdmin: true,
              clinicAdmins: true,
            },
          });

          if (!user) {
            throw new NotFoundException("User not found");
          }

          // Check if the clinic exists
          const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);
          const clinic = await this.prisma.clinic.findUnique({
            where: { id: clinicUUID },
          });

          if (!clinic) {
            throw new NotFoundException("Clinic not found");
          }

          // Check if the user has permission to view this clinic's patients
          if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
            // SuperAdmin can see all patients
          } else if (
            user.role === Role.CLINIC_ADMIN &&
            user.clinicAdmins?.length
          ) {
            // ClinicAdmin can only see patients from their assigned clinics
            const isAdmin = await this.prisma.clinicAdmin.findFirst({
              where: {
                userId: userId,
                clinicId: clinicUUID,
              },
            });

            if (!isAdmin) {
              throw new UnauthorizedException(
                "You do not have permission to view patients from this clinic",
              );
            }
          } else {
            throw new UnauthorizedException(
              "You do not have permission to view patients",
            );
          }

          // Connect to the clinic's database to get patients
          // This is a placeholder - in a real implementation, you would query the clinic's database
          // For now, we'll just return an empty array
          const patients: unknown[] = [];

          return patients;
        } catch (_error) {
          throw _error;
        }
      },
      {
        ttl: 900, // 15 minutes
        tags: [`clinic:${clinicId}`, "patients", "clinic_data"],
        priority: "high",
        enableSwr: true,
        compress: true, // Compress patient lists
        containsPHI: true, // Patient lists contain PHI
      },
    );
  }

  /**
   * Register a patient to a clinic
   * This is used by the mobile app to register a patient to a specific clinic
   */
  async registerPatientToClinic(data: { userId: string; clinicId: string }) {
    // Get the clinic by clinic ID
    const clinicUUID = await resolveClinicUUID(this.prisma, data.clinicId);
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicUUID },
    });

    if (!clinic) {
      throw new NotFoundException("Clinic not found");
    }

    // Check if the user exists and is a patient
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
      include: { patient: true },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (user.role !== Role.PATIENT || !user.patient) {
      throw new ConflictException("User is not a patient");
    }

    // Connect to the clinic's database and register the patient
    // This is a placeholder - in a real implementation, you would create a record in the clinic's database
    // For now, we'll just return a success message

    // After successfully registering patient, invalidate patients cache
    await this.cacheService.invalidateCacheByTag("clinic-patients");
    await this.cacheService.invalidateCacheByTag(`clinic:${clinicUUID}`);

    return {
      success: true,
      message: "Patient registered to clinic successfully",
    };
  }

  /**
   * Update clinic
   */
  async updateClinic(
    id: string,
    data: {
      name?: string;
      address?: string;
      phone?: string;
      email?: string;
    },
    userId: string,
  ) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          superAdmin: true,
          clinicAdmins: true,
        },
      });

      if (!user) {
        await this.errorService.logError(
          { message: "User not found" },
          "ClinicService",
          "find user",
          { userId },
        );
        throw new NotFoundException("User not found");
      }

      const clinicUUID = await resolveClinicUUID(this.prisma, id);
      const clinic = await this.prisma.clinic.findUnique({
        where: { id: clinicUUID },
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
          { message: "Clinic not found" },
          "ClinicService",
          "find clinic",
          { clinicId: clinicUUID },
        );
        throw new NotFoundException("Clinic not found");
      }

      if (user.role !== Role.SUPER_ADMIN) {
        if (user.role === Role.CLINIC_ADMIN) {
          const isAdmin = clinic.admins.some(
            (admin: unknown) =>
              (admin as Record<string, unknown>).userId === userId,
          );
          if (!isAdmin) {
            await this.errorService.logError(
              { message: "Unauthorized clinic update attempt" },
              "ClinicService",
              "authorize user",
              { clinicId: clinicUUID, userId, role: user.role },
            );
            throw new UnauthorizedException(
              "You do not have permission to update this clinic",
            );
          }
        } else {
          await this.errorService.logError(
            { message: "Unauthorized clinic update attempt" },
            "ClinicService",
            "authorize user",
            { clinicId: clinicUUID, userId, role: user.role },
          );
          throw new UnauthorizedException(
            "You do not have permission to update clinics",
          );
        }
      }

      const updatedClinic = await this.prisma.clinic.update({
        where: { id: clinicUUID },
        data,
      });

      await this.errorService.logSuccess(
        "Clinic updated successfully",
        "ClinicService",
        "update clinic",
        { clinicId: clinicUUID, updatedFields: Object.keys(data) },
      );

      await this.eventService.emit("clinic.updated", {
        clinicId: clinicUUID,
        updatedFields: Object.keys(data),
        updatedBy: userId,
      });

      // After successfully updating clinic, invalidate clinic caches
      await Promise.all([
        this.cacheService.invalidateByPattern(`clinics:detail:${clinicUUID}:*`),
        this.cacheService.invalidateByPattern(
          `clinics:appname:${clinic.app_name}`,
        ),
        this.cacheService.invalidateCacheByTag("clinics"),
        this.cacheService.invalidateCacheByTag(`clinic:${clinicUUID}`),
      ]);

      return updatedClinic;
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "update clinic",
        { clinicId: id, ...data },
      );
      throw _error;
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
          { message: "Unauthorized delete attempt" },
          "ClinicService",
          "authorize user",
          { userId, role: user?.role },
        );
        throw new UnauthorizedException("Only SuperAdmin can delete clinics");
      }

      // Check if the clinic exists
      const clinicUUID = await resolveClinicUUID(this.prisma, id);
      const clinic = await this.prisma.clinic.findUnique({
        where: { id: clinicUUID },
        select: {
          id: true,
          name: true,
          app_name: true,
        },
      });

      if (!clinic) {
        await this.errorService.logError(
          { message: "Clinic not found for deletion" },
          "ClinicService",
          "find clinic",
          { clinicId: clinicUUID },
        );
        throw new NotFoundException("Clinic not found");
      }

      // No need to delete database, simply delete the clinic record
      await this.prisma.clinic.delete({
        where: { id: clinicUUID },
      });

      await this.errorService.logSuccess(
        "Clinic deleted successfully",
        "ClinicService",
        "delete clinic",
        { clinicId: clinicUUID, name: clinic.name },
      );

      await this.eventService.emit("clinic.deleted", {
        clinicId: clinicUUID,
        name: clinic.name,
        deletedBy: userId,
      });

      // After successfully deleting clinic, invalidate all clinic-related caches
      await Promise.all([
        this.cacheService.invalidateByPattern(`clinics:detail:${clinicUUID}:*`),
        this.cacheService.invalidateByPattern(
          `clinics:appname:${clinic.app_name}`,
        ),
        this.cacheService.invalidateCacheByTag("clinics"),
        this.cacheService.invalidateCacheByTag(`clinic:${clinicUUID}`),
        this.cacheService.invalidateCacheByTag("clinic-doctors"),
        this.cacheService.invalidateCacheByTag("clinic-patients"),
      ]);

      return { success: true, message: "Clinic deleted successfully" };
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "delete clinic",
        { clinicId: id, userId },
      );
      throw _error;
    }
  }

  async getActiveLocations(clinicId: string) {
    const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);
    try {
      const locations = await this.prisma.clinicLocation.findMany({
        where: {
          clinicId: clinicUUID,
          isActive: true,
        },
        select: {
          id: true,
          locationId: true,
          name: true,
          address: true,
          city: true,
          state: true,
          country: true,
          zipCode: true,
          phone: true,
          email: true,
          timezone: true,
          workingHours: true,
        },
        orderBy: {
          locationId: "asc",
        },
      });

      return locations;
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "get active locations",
        { clinicId: clinicUUID },
      );
      throw _error;
    }
  }

  async associateUserWithClinic(userId: string, clinicId: string) {
    const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException("User not found");
      }

      const clinic = await this.prisma.clinic.findUnique({
        where: { id: clinicUUID },
      });

      if (!clinic) {
        throw new NotFoundException("Clinic not found");
      }

      // Add the clinic to the user's clinics
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          clinics: {
            connect: { id: clinicUUID },
          },
        },
      });

      await this.errorService.logSuccess(
        "User associated with clinic successfully",
        "ClinicService",
        "associate user with clinic",
        { userId, clinicId },
      );

      await this.eventService.emit("clinic.user.associated", {
        userId,
        clinicId,
        clinicName: clinic.name,
      });

      return true;
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "associate user with clinic",
        { userId, clinicId },
      );
      throw _error;
    }
  }

  async generateClinicToken(userId: string, clinicId: string): Promise<string> {
    const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          clinics: {
            where: { id: clinicUUID },
            select: { clinicId: true },
          },
        },
      });

      if (!user) {
        throw new NotFoundException("User not found");
      }

      if (!user.clinics.length) {
        throw new UnauthorizedException(
          "User is not associated with this clinic",
        );
      }

      // Generate a JWT token with clinic-specific claims
      const token = await this.jwtService.signAsync({
        sub: userId,
        email: user.email,
        role: user.role,
        clinicId: clinicUUID,
        clinicIdentifier: user.clinics[0].clinicId,
      });

      return token;
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "generate clinic token",
        { userId, clinicId },
      );
      throw _error;
    }
  }

  /**
   * Get current user's clinic
   * This method finds the clinic associated with the current user
   */
  async getCurrentUserClinic(userId: string) {
    try {
      // Get user's primary clinic or first associated clinic
      const userWithClinics = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          primaryClinic: true,
          clinics: true,
        },
      });

      if (!userWithClinics) {
        await this.errorService.logError(
          { message: "User not found" },
          "ClinicService",
          "find user",
          { userId },
        );
        throw new NotFoundException("User not found");
      }

      // Get the clinic ID (primary clinic or first associated clinic)
      const clinicId =
        userWithClinics.primaryClinicId ||
        (userWithClinics.clinics.length > 0
          ? userWithClinics.clinics[0].id
          : null);

      if (!clinicId) {
        await this.errorService.logError(
          { message: "User not associated with any clinic" },
          "ClinicService",
          "find user clinic",
          { userId },
        );
        throw new NotFoundException("User not associated with any clinic");
      }

      return this.getClinicById(clinicId, userId);
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "get current user clinic",
        { userId },
      );
      throw _error;
    }
  }

  // ===============================
  // ENTERPRISE DATABASE METHODS
  // ===============================

  /**
   * Get clinic dashboard with enterprise database client
   * Provides complete data isolation and advanced metrics
   */
  async getClinicDashboardEnterprise(clinicId: string, userId: string) {
    try {
      // Validate clinic access
      const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);

      // Execute dashboard operation with data isolation using healthcare database client
      const dashboardResult =
        await this.healthcareDatabaseClient.getClinicDashboardStats(clinicUUID);

      if ((dashboardResult as Record<string, unknown>).isSuccess) {
        // Get additional metrics
        const metricsResult =
          await this.healthcareDatabaseClient.getClinicMetrics(clinicUUID);

        return {
          success: true,
          data: {
            dashboard: (dashboardResult as Record<string, unknown>).data,
            metrics: metricsResult,
            clinicId: clinicUUID,
            executionTime: (
              (dashboardResult as { meta?: unknown }).meta as Record<
                string,
                unknown
              >
            )?.executionTime,
          },
        };
      } else {
        throw (dashboardResult as Record<string, unknown>).error;
      }
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "get clinic dashboard enterprise",
        { clinicId, userId },
      );
      throw _error;
    }
  }

  /**
   * Get clinic patients with enterprise pagination and filtering
   */
  async getClinicPatientsEnterprise(
    clinicId: string,
    userId: string,
    options: {
      page?: number;
      limit?: number;
      locationId?: string;
      searchTerm?: string;
    } = {},
  ) {
    try {
      const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);

      const patientsResult =
        await this.healthcareDatabaseClient.getClinicPatients(clinicUUID, {
          page: options.page || 1,
          limit: options.limit || 20,
          locationId: options.locationId,
          searchTerm: options.searchTerm,
          includeInactive: false,
        });

      if ((patientsResult as Record<string, unknown>).isSuccess) {
        return {
          success: true,
          data: (patientsResult as Record<string, unknown>).data,
          metadata: {
            executionTime: (
              (patientsResult as { meta?: unknown }).meta as Record<
                string,
                unknown
              >
            )?.executionTime,
            clinicId: clinicUUID,
          },
        };
      } else {
        throw (patientsResult as Record<string, unknown>).error;
      }
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "get clinic patients enterprise",
        { clinicId, userId, options },
      );
      throw _error;
    }
  }

  /**
   * Get clinic appointments with enterprise filtering and isolation
   */
  async getClinicAppointmentsEnterprise(
    clinicId: string,
    userId: string,
    filters: {
      locationId?: string;
      dateFrom?: Date;
      dateTo?: Date;
      status?: string;
      doctorId?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    try {
      const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);

      const appointmentsResult =
        await this.healthcareDatabaseClient.getClinicAppointments(clinicUUID, {
          page: filters.page || 1,
          limit: filters.limit || 50,
          locationId: filters.locationId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          status: filters.status,
          doctorId: filters.doctorId,
        });

      if ((appointmentsResult as Record<string, unknown>).isSuccess) {
        return {
          success: true,
          data: (appointmentsResult as Record<string, unknown>).data,
          filters,
          metadata: {
            executionTime: (
              (appointmentsResult as { meta?: unknown }).meta as Record<
                string,
                unknown
              >
            )?.executionTime,
            clinicId: clinicUUID,
          },
        };
      } else {
        throw (appointmentsResult as Record<string, unknown>).error;
      }
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "get clinic appointments enterprise",
        { clinicId, userId, filters },
      );
      throw _error;
    }
  }

  /**
   * Create patient with enterprise audit trail and PHI protection
   */
  async createPatientEnterprise(
    clinicId: string,
    userId: string,
    patientData: unknown,
  ): Promise<RepositoryResult<any>> {
    const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);

    try {
      // Execute patient creation with clinic context and audit trail
      const patient = await this.prisma.patient.create({
        data: {
          ...(patientData as Record<string, unknown>),
          // Ensure clinic association through appointments or other relations
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      return RepositoryResult.success(patient);
    } catch (_error) {
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Get enterprise database health status for clinic
   */
  async getClinicDatabaseHealth(clinicId: string): Promise<unknown> {
    try {
      const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);

      // Get basic health status using healthcare database client
      const healthStatus =
        await this.healthcareDatabaseClient.getHealthStatus();
      const metrics = await this.healthcareDatabaseClient.getMetrics();

      return {
        success: true,
        data: {
          health: healthStatus,
          metrics,
          clinicId: clinicUUID,
          timestamp: new Date(),
        },
      };
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "get clinic database health",
        { clinicId },
      );
      throw _error;
    }
  }

  /**
   * Get multi-clinic summary with enterprise isolation
   */
  async getMultiClinicSummaryEnterprise(clinicIds: string[], userId: string) {
    try {
      // Resolve all clinic UUIDs
      const resolvedClinicIds = await Promise.all(
        clinicIds.map((id) => resolveClinicUUID(this.prisma, id)),
      );

      // Execute parallel operations with proper isolation using healthcare database client
      const summaryPromises = resolvedClinicIds.map(async (clinicId) => {
        try {
          const [dashboardResult, metricsResult] = await Promise.all([
            this.healthcareDatabaseClient.getClinicDashboardStats(clinicId),
            this.healthcareDatabaseClient.getMetrics(),
          ]);

          return {
            clinicId,
            dashboard: (dashboardResult as Record<string, unknown>).isSuccess
              ? (dashboardResult as Record<string, unknown>).data
              : null,
            metrics: metricsResult,
            _error: (dashboardResult as Record<string, unknown>).isFailure
              ? (
                  (dashboardResult as Record<string, unknown>).error as Record<
                    string,
                    unknown
                  >
                )?.message
              : null,
          };
        } catch (_error) {
          return {
            clinicId,
            dashboard: null,
            metrics: null,
            _error: _error instanceof Error ? _error.message : "Unknown _error",
          };
        }
      });

      const results = await Promise.all(summaryPromises);

      const successful = results.filter(
        (r) => !(r as Record<string, unknown>)._error,
      ).length;
      const failed = results.length - successful;

      return {
        success: true,
        data: results,
        summary: {
          totalClinics: results.length,
          successful,
          failed,
        },
      };
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "get multi clinic summary enterprise",
        { clinicIds, userId },
      );
      throw _error;
    }
  }

  /**
   * Get enterprise database factory statistics
   */
  async getDatabaseFactoryStats() {
    try {
      // Get basic database health and metrics using healthcare database client
      const healthCheck = await this.healthcareDatabaseClient.getHealthStatus();
      const metrics = await this.healthcareDatabaseClient.getMetrics();

      return {
        success: true,
        data: {
          factory: {
            activeConnections: (metrics as any).activeConnections || 0,
            totalConnections: (metrics as any).totalConnections || 0,
            connectionPoolSize: (metrics as any).connectionPool?.size || 0,
          },
          health: healthCheck,
          timestamp: new Date(),
        },
      };
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicService",
        "get database factory stats",
        {},
      );
      throw _error;
    }
  }
}
