import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsPhoneNumber } from 'class-validator';

export class CreateClinicDto {
  @ApiProperty({
    description: 'The name of the clinic',
    example: 'City Health Clinic',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The address of the clinic',
    example: '123 Main Street, City, State, ZIP',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({
    description: 'The phone number of the clinic',
    example: '+1234567890',
  })
  @IsString()
  @IsNotEmpty()
  @IsPhoneNumber()
  phone: string;

  @ApiProperty({
    description: 'The email of the clinic',
    example: 'info@cityhealthclinic.com',
  })
  @IsString()
  @IsNotEmpty()
  email: string;
} 