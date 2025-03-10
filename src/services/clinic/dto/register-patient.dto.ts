import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class RegisterPatientDto {
  @ApiProperty({
    description: 'The app name of the clinic to register the patient to',
    example: 'cityhealthclinic',
  })
  @IsString()
  @IsNotEmpty()
  appName: string;
} 