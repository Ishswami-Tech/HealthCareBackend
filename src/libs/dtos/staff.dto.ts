import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsUUID, IsNotEmpty } from 'class-validator';

/**
 * Staff roles enumeration
 */
export enum StaffRole {
  RECEPTIONIST = 'RECEPTIONIST',
  CLINIC_ADMIN = 'CLINIC_ADMIN',
  NURSE = 'NURSE',
}

/**
 * Data Transfer Object for creating/updating a staff profile
 * @class CreateStaffDto
 * @description Contains fields for staff member creation/update
 * @example
 * ```typescript
 * const dto = new CreateStaffDto();
 * dto.userId = "user-uuid-123";
 * dto.role = StaffRole.RECEPTIONIST;
 * ```
 */
export class CreateStaffDto {
  @ApiProperty({
    example: 'user-uuid-123',
    description: 'User ID to associate with staff profile',
  })
  @IsString()
  @IsNotEmpty({ message: 'User ID is required' })
  userId!: string;

  @ApiProperty({
    example: 'RECEPTIONIST',
    description: 'Staff role',
    enum: StaffRole,
    enumName: 'StaffRole',
  })
  @IsEnum(StaffRole, { message: 'Role must be RECEPTIONIST, CLINIC_ADMIN, or NURSE' })
  @IsNotEmpty({ message: 'Role is required' })
  role!: StaffRole;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Associated clinic ID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  clinicId?: string;

  @ApiPropertyOptional({
    example: 'Front Desk',
    description: 'Department assignment',
  })
  @IsOptional()
  @IsString({ message: 'Department must be a string' })
  department?: string;

  @ApiPropertyOptional({
    example: 'EMP-001',
    description: 'Employee ID',
  })
  @IsOptional()
  @IsString({ message: 'Employee ID must be a string' })
  employeeId?: string;
}

/**
 * Data Transfer Object for staff query filters
 * @class StaffFilterDto
 */
export class StaffFilterDto {
  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Filter by clinic ID',
  })
  @IsOptional()
  @IsString()
  clinicId?: string;
}
