import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  UseGuards,
  Request,
  NotFoundException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiSecurity,
  ApiBody,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../libs/core/guards/jwt-auth.guard";
import { RolesGuard } from "../../../libs/core/guards/roles.guard";
import { Roles } from "../../../libs/core/decorators/roles.decorator";
import { Role } from "../../../libs/infrastructure/database/prisma/prisma.types";
import { ClinicLocationService } from "../services/clinic-location.service";
import { CreateClinicLocationDto } from "../dto/create-clinic-location.dto";
import { UpdateClinicLocationDto } from "../dto/update-clinic-location.dto";

@ApiTags("Clinic Locations")
@ApiBearerAuth()
@ApiSecurity("session-id")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("clinics/:clinicId/locations")
export class ClinicLocationController {
  constructor(private readonly locationService: ClinicLocationService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: "Create a new clinic location" })
  @ApiBody({ type: CreateClinicLocationDto })
  @ApiResponse({
    status: 201,
    description: "The location has been successfully created.",
  })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiParam({ name: "clinicId", description: "ID of the clinic" })
  async create(
    @Param("clinicId") clinicId: string,
    @Body() createLocationDto: CreateClinicLocationDto,
    @Request() req: { user: { id: string } },
  ): Promise<{
    id: string;
    locationId: string;
    name: string;
    address: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
    phone: string;
    email: string;
    timezone: string;
    workingHours: string;
    isActive: boolean;
    clinicId: string;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const user = req as { user: { id: string } };
    return await this.locationService.createClinicLocation(
      {
        ...createLocationDto,
        clinicId,
        locationId: `LOC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        workingHours:
          typeof createLocationDto.workingHours === "string"
            ? createLocationDto.workingHours
            : createLocationDto.workingHours
              ? JSON.stringify(createLocationDto.workingHours)
              : "9:00 AM - 5:00 PM",
      },
      user.user.id,
    );
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @ApiOperation({ summary: "Get all locations for a clinic" })
  @ApiResponse({
    status: 200,
    description: "Return all locations for the specified clinic.",
  })
  @ApiParam({ name: "clinicId", description: "ID of the clinic" })
  async findAll(
    @Param("clinicId") clinicId: string,
    @Request() _req: { user: { id: string } },
  ): Promise<
    Array<{
      id: string;
      locationId: string;
      name: string;
      address: string;
      city: string;
      state: string;
      country: string;
      zipCode: string;
      phone: string;
      email: string;
      timezone: string;
      workingHours: string;
      isActive: boolean;
      clinicId: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    return await this.locationService.getLocations(clinicId, false);
  }

  @Get(":id")
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @ApiOperation({ summary: "Get a specific clinic location" })
  @ApiResponse({ status: 200, description: "Return the specified location." })
  @ApiResponse({ status: 404, description: "Location not found." })
  @ApiParam({ name: "clinicId", description: "ID of the clinic" })
  @ApiParam({ name: "id", description: "ID of the location" })
  async findOne(
    @Param("id") id: string,
    @Param("clinicId") _clinicId: string,
    @Request() _req: { user: { id: string } },
  ): Promise<{
    id: string;
    locationId: string;
    name: string;
    address: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
    phone: string;
    email: string;
    timezone: string;
    workingHours: string;
    isActive: boolean;
    clinicId: string;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const location = await this.locationService.getClinicLocationById(
      id,
      false,
    );
    if (!location) {
      throw new NotFoundException(`Location with ID ${id} not found`);
    }
    return location;
  }

  @Put(":id")
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: "Update a clinic location" })
  @ApiBody({ type: UpdateClinicLocationDto })
  @ApiResponse({
    status: 200,
    description: "The location has been successfully updated.",
  })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Location not found." })
  @ApiParam({ name: "clinicId", description: "ID of the clinic" })
  @ApiParam({ name: "id", description: "ID of the location" })
  async update(
    @Param("id") id: string,
    @Param("clinicId") clinicId: string,
    @Body() updateLocationDto: UpdateClinicLocationDto,
    @Request() req: { user: { id: string } },
  ): Promise<{
    id: string;
    locationId: string;
    name: string;
    address: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
    phone: string;
    email: string;
    timezone: string;
    workingHours: string;
    isActive: boolean;
    clinicId: string;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const user = req as { user: { id: string } };
    // Handle workingHours conversion properly
    const updateData = { ...updateLocationDto };
    if (updateLocationDto.workingHours) {
      if (typeof updateLocationDto.workingHours === "string") {
        updateData.workingHours = JSON.parse(updateLocationDto.workingHours);
      } else if (typeof updateLocationDto.workingHours === "object") {
        updateData.workingHours = updateLocationDto.workingHours;
      }
    }

    return await this.locationService.updateLocation(
      id,
      updateData as any,
      user.user.id,
    );
  }

  @Delete(":id")
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: "Delete a clinic location" })
  @ApiResponse({
    status: 200,
    description: "The location has been successfully deleted.",
  })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Location not found." })
  @ApiParam({ name: "clinicId", description: "ID of the clinic" })
  @ApiParam({ name: "id", description: "ID of the location" })
  async remove(
    @Param("id") id: string,
    @Param("clinicId") clinicId: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.locationService.deleteLocation(id, req.user.id);
  }
}
