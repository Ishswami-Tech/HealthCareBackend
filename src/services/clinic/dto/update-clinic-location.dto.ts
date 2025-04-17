import { PartialType } from '@nestjs/swagger';
import { CreateClinicLocationDto } from './create-clinic-location.dto';

export class UpdateClinicLocationDto extends PartialType(CreateClinicLocationDto) {} 