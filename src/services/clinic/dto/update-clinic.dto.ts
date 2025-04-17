import { PartialType } from '@nestjs/swagger';
import { CreateClinicDto } from './create-clinic.dto';

/**
 * DTO for updating clinic information
 * Extends CreateClinicDto to inherit all properties as optional
 */
export class UpdateClinicDto extends PartialType(CreateClinicDto) {} 