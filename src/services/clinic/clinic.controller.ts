import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
  Req,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  ValidationPipe,
  UsePipes,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Query,
  Logger,
} from "@nestjs/common";
import { ClinicService } from "./clinic.service";
import { JwtAuthGuard, RolesGuard, Roles } from "../../libs/core";
import { HealthcareErrorsService } from "../../libs/core/errors";
import { Role } from "../../libs/infrastructure/database/prisma/prisma.types";
import { RequireResourcePermission } from "../../libs/core/rbac/rbac.decorators";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiSecurity,
  ApiBody,
  ApiHeader,
  ApiConsumes,
  ApiProduces,
  ApiQuery,
} from "@nestjs/swagger";
import { CreateClinicDto } from "./dto/create-clinic.dto";
import { AssignClinicAdminDto } from "./dto/assign-clinic-admin.dto";
import { RegisterPatientDto } from "./dto/register-patient.dto";
import { UpdateClinicDto } from "./dto/update-clinic.dto";
import {
  ClinicResponseDto,
  ClinicListResponseDto,
  AppNameInlineDto,
} from "./dto/clinic-response.dto";
import { Public } from "../../libs/core";
import { AuthenticatedRequest } from "../../libs/core/types/clinic.types";
import { RbacGuard } from "../../libs/core/rbac/rbac.guard";
import { ClinicGuard } from "../../libs/core/guards/clinic.guard";
import { UseInterceptors } from "@nestjs/common";

@ApiTags("Clinics")
@ApiBearerAuth()
@ApiSecurity("session-id")
@ApiHeader({
  name: "X-Clinic-ID",
  description: "Clinic identifier (for clinic-specific endpoints)",
  required: false,
})
@Controller("clinics")
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    errorHttpStatusCode: HttpStatus.BAD_REQUEST,
  }),
)
export class ClinicController {
  private readonly logger = new Logger(ClinicController.name);

  constructor(
    private readonly clinicService: ClinicService,
    private readonly errors: HealthcareErrorsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission("clinics", "create")
  @ApiOperation({
    summary: "Create a new clinic",
    description:
      "Creates a new clinic with its own isolated database. Both Super Admins and Clinic Admins can create clinics. Super Admins must specify a clinicAdminIdentifier (email or ID), while Clinic Admins automatically become the admin of the clinic they create. Requires manage_clinics permission.",
  })
  @ApiConsumes("application/json")
  @ApiProduces("application/json")
  @ApiBody({
    type: CreateClinicDto,
    description: "Clinic creation data",
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "The clinic has been successfully created.",
    type: ClinicResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid clinic data or validation errors",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "Invalid token or missing session ID",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Insufficient permissions to create clinics",
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      "A clinic with the same name, email, or subdomain already exists, or the provided clinicAdminIdentifier is not a Clinic Admin.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Specified Clinic Admin not found.",
  })
  async createClinic(
    @Body() createClinicDto: CreateClinicDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(`Creating clinic by user ${userId}`, {
        clinicName: createClinicDto.name,
      });

      const result = await this.clinicService.createClinic({
        ...createClinicDto,
        createdBy: userId,
      });

      this.logger.log(`Clinic created successfully: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to create clinic: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission("clinics", "create")
  @ApiOperation({
    summary: "Get all clinics",
    description:
      "Retrieves all clinics based on user permissions. Super Admin can see all clinics, while Clinic Admin can only see their assigned clinics. Supports pagination.",
  })
  @ApiQuery({
    name: "page",
    required: false,
    description: "Page number for pagination",
    type: Number,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Number of items per page",
    type: Number,
  })
  @ApiQuery({
    name: "search",
    required: false,
    description: "Search clinics by name or email",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns an array of clinics.",
    type: ClinicListResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "Invalid token or missing session ID",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Insufficient permissions to view clinics",
  })
  async getAllClinics(
    @Req() req: AuthenticatedRequest,
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 10,
    @Query("search") search?: string,
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(`Getting clinics for user ${userId}`, {
        page,
        limit,
        search,
      });

      const result = await this.clinicService.getAllClinics(userId);

      this.logger.log(
        `Retrieved ${(result as any)?.length || 0} clinics for user ${userId}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get clinics: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  }

  @Get(":id")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.PATIENT)
  @RequireResourcePermission("clinics", "read", { requireOwnership: true })
  @ApiOperation({
    summary: "Get a clinic by ID",
    description:
      "Retrieves a specific clinic by ID based on user permissions. Super Admin can see any clinic, Clinic Admin can see their assigned clinics, and Patients can see their associated clinic.",
  })
  @ApiParam({
    name: "id",
    description: "The ID of the clinic to retrieve",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the clinic data.",
    type: ClinicResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid clinic ID format",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User does not have permission to view this clinic.",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "User is not associated with this clinic.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Clinic not found.",
  })
  async getClinicById(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(`Getting clinic ${id} for user ${userId}`);

      const result = await this.clinicService.getClinicById(id, userId);

      this.logger.log(`Retrieved clinic ${id} successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get clinic ${id}: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  }

  @Put(":id")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN)
  @RequireResourcePermission("clinics", "update", { requireOwnership: true })
  @ApiOperation({
    summary: "Update a clinic",
    description:
      "Updates a specific clinic by ID. Super Admin can update any clinic, while Clinic Admin can only update their assigned clinics.",
  })
  @ApiParam({
    name: "id",
    description: "The ID of the clinic to update",
    type: "string",
    format: "uuid",
  })
  @ApiConsumes("application/json")
  @ApiProduces("application/json")
  @ApiBody({
    type: UpdateClinicDto,
    description: "Clinic update data",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the updated clinic data.",
    type: ClinicResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid update data",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User does not have permission to update this clinic.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Clinic not found.",
  })
  async updateClinic(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() updateClinicDto: UpdateClinicDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(`Updating clinic ${id} by user ${userId}`);

      const result = await this.clinicService.updateClinic(
        id,
        updateClinicDto,
        userId,
      );

      this.logger.log(`Clinic ${id} updated successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to update clinic ${id}: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN)
  @RequireResourcePermission("clinics", "update", { requireOwnership: true })
  @ApiOperation({
    summary: "Delete a clinic",
    description:
      "Deletes a specific clinic by ID and its associated database. Only Super Admin can delete clinics.",
  })
  @ApiParam({
    name: "id",
    description: "The ID of the clinic to delete",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns a success message.",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "Only Super Admin can delete clinics.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Clinic not found.",
  })
  async deleteClinic(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(`Deleting clinic ${id} by user ${userId}`);

      const result = await this.clinicService.deleteClinic(id, userId);

      this.logger.log(`Clinic ${id} deleted successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to delete clinic ${id}: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  }

  @Post("admin")
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.SUPER_ADMIN)
  @RequireResourcePermission("clinics", "create")
  @ApiOperation({
    summary: "Assign a clinic admin",
    description:
      "Assigns a user as a clinic admin. Only Super Admin or the clinic owner can assign clinic admins.",
  })
  @ApiConsumes("application/json")
  @ApiProduces("application/json")
  @ApiBody({
    type: AssignClinicAdminDto,
    description: "Clinic admin assignment data",
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "The clinic admin has been successfully assigned.",
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid assignment data",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User does not have permission to assign clinic admins.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "User or clinic not found.",
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      "User is already assigned to this clinic or does not have the correct role.",
  })
  async assignClinicAdmin(
    @Body() data: AssignClinicAdminDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const assignedBy = req.user?.sub;

      if (!assignedBy) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(`Assigning clinic admin by user ${assignedBy}`, {
        userId: data.userId,
        clinicId: data.clinicId,
      });

      const result = await this.clinicService.assignClinicAdmin({
        ...data,
        assignedBy,
      });

      this.logger.log(`Clinic admin assigned successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to assign clinic admin: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @Get("app/:appName")
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({
    summary: "Get a clinic by app name",
    description:
      "Retrieves a specific clinic by app name (subdomain). This endpoint is public and used to determine which clinic database to connect to.",
  })
  @ApiParam({
    name: "appName",
    description: "The app name (subdomain) of the clinic to retrieve",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the clinic data.",
    type: ClinicResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Clinic not found.",
  })
  async getClinicByAppName(@Param("appName") appName: string) {
    try {
      if (!appName) {
        throw new BadRequestException("App name is required");
      }

      this.logger.log(`Getting clinic by app name: ${appName}`);

      const result = await this.clinicService.getClinicByAppName(appName);

      this.logger.log(`Retrieved clinic by app name ${appName} successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get clinic by app name ${appName}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @Get(":id/doctors")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  @RequireResourcePermission("clinics", "read", { requireOwnership: true })
  @ApiOperation({
    summary: "Get all doctors for a clinic",
    description:
      "Retrieves all doctors associated with a specific clinic. Super Admin and Clinic Admin can see all doctors.",
  })
  @ApiParam({
    name: "id",
    description: "The ID of the clinic",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns an array of doctors.",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description:
      "User does not have permission to view doctors from this clinic.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Clinic not found.",
  })
  async getClinicDoctors(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(`Getting doctors for clinic ${id} by user ${userId}`);

      const result = await this.clinicService.getClinicDoctors(id, userId);

      this.logger.log(
        `Retrieved ${(result as any)?.length || 0} doctors for clinic ${id}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get clinic doctors for clinic ${id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @Get(":id/patients")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR)
  @RequireResourcePermission("clinics", "read", { requireOwnership: true })
  @ApiOperation({
    summary: "Get all patients for a clinic",
    description:
      "Retrieves all patients associated with a specific clinic. Super Admin and Clinic Admin can see all patients.",
  })
  @ApiParam({
    name: "id",
    description: "The ID of the clinic",
    type: "string",
    format: "uuid",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns an array of patients.",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description:
      "User does not have permission to view patients from this clinic.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Clinic not found.",
  })
  async getClinicPatients(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(`Getting patients for clinic ${id} by user ${userId}`);

      const result = await this.clinicService.getClinicPatients(id, userId);

      this.logger.log(
        `Retrieved ${(result as any)?.length || 0} patients for clinic ${id}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get clinic patients for clinic ${id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Register a patient to a clinic",
    description:
      "Registers a patient user to a specific clinic by app name. Used by the mobile app.",
  })
  @ApiConsumes("application/json")
  @ApiProduces("application/json")
  @ApiBody({
    type: RegisterPatientDto,
    description: "Patient registration data",
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "The patient has been successfully registered to the clinic.",
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid registration data",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "User or clinic not found.",
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: "User is not a patient.",
  })
  async registerPatientToClinic(
    @Body() data: RegisterPatientDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(
        `Registering patient ${userId} to clinic by app name: ${data.appName}`,
      );

      // First get the clinic by app name to get the clinicId
      const clinic = await this.clinicService.getClinicByAppName(data.appName);

      const result = await this.clinicService.registerPatientToClinic({
        userId,
        clinicId: (clinic as any).clinicId,
      });

      this.logger.log(
        `Patient ${userId} registered to clinic ${(clinic as any).clinicId} successfully`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to register patient to clinic: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @Post("validate-app-name")
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({
    summary: "Validate app name",
    description:
      "Validates if an app name (subdomain) is available and returns clinic information.",
  })
  @ApiConsumes("application/json")
  @ApiProduces("application/json")
  @ApiBody({
    type: AppNameInlineDto,
    description: "App name validation data",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns clinic information if app name is valid.",
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid app name format",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "App name not found.",
  })
  async validateAppName(@Body() data: AppNameInlineDto) {
    try {
      if (!data.appName) {
        throw new BadRequestException("App name is required");
      }

      this.logger.log(`Validating app name: ${data.appName}`);

      const clinic = await this.clinicService.getClinicByAppName(data.appName);

      // Return only necessary information
      const result = {
        clinicId: (clinic as any).clinicId,
        name: (clinic as any).name,
        locations: await this.clinicService.getActiveLocations(
          (clinic as any).id,
        ),
        settings: (clinic as any).settings,
      };

      this.logger.log(`App name ${data.appName} validated successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to validate app name ${data.appName}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @Post("associate-user")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission("clinics", "read")
  @ApiOperation({
    summary: "Associate user with clinic by app name",
    description:
      "Associates the current user with a clinic by app name. Users can associate themselves with clinics they have access to.",
  })
  @ApiConsumes("application/json")
  @ApiProduces("application/json")
  @ApiBody({
    type: AppNameInlineDto,
    description: "Clinic association data",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "User successfully associated with clinic.",
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid association data",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User not authenticated",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Cannot associate with this clinic.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Clinic not found.",
  })
  async associateUser(
    @Body() data: AppNameInlineDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      if (!data.appName) {
        throw new BadRequestException("App name is required");
      }

      this.logger.log(
        `Associating user ${userId} with clinic by app name: ${data.appName}`,
      );

      const result = await this.clinicService.associateUserWithClinic(
        userId,
        data.appName,
      );

      this.logger.log(
        `User ${userId} associated with clinic ${data.appName} successfully`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to associate user with clinic: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  }

  @Get("my-clinic")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @RequireResourcePermission("clinics", "read")
  @ApiOperation({
    summary: "Get current user clinic",
    description:
      "Get clinic details for the currently authenticated user. Patients, doctors, and staff can access their associated clinic.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the user's clinic data.",
    type: ClinicResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "User does not have permission to view clinic.",
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "User is not associated with any clinic.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "User not associated with any clinic.",
  })
  async getMyClinic(@Req() req: AuthenticatedRequest) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      this.logger.log(`Getting clinic for user ${userId}`);

      const result = await this.clinicService.getCurrentUserClinic(userId);

      this.logger.log(`Retrieved clinic for user ${userId} successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get user clinic: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @Get("test/context")
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.PATIENT,
  )
  @ApiOperation({
    summary: "Test clinic context",
    description: "Test endpoint to debug clinic context and permissions",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the current clinic context and user info.",
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: "Unauthorized",
  })
  async testClinicContext(@Req() req: AuthenticatedRequest) {
    const clinicContext = req.clinicContext;
    const user = req.user;

    return {
      message: "Clinic context test",
      timestamp: new Date().toISOString(),
      user: {
        id: user?.sub,
        sub: user?.sub,
        role: user?.role,
        email: user?.email,
      },
      clinicContext: {
        identifier: clinicContext?.identifier,
        clinicId: clinicContext?.clinicId,
        subdomain: clinicContext?.subdomain,
        appName: clinicContext?.appName,
        isValid: clinicContext?.isValid,
      },
      headers: {
        "x-clinic-id": req.headers["x-clinic-id"],
        "x-clinic-identifier": req.headers["x-clinic-identifier"],
        authorization: req.headers.authorization ? "Bearer ***" : "none",
      },
    };
  }
}
