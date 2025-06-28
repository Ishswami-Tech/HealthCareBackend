import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, IsBoolean, IsOptional, IsPhoneNumber, Length, IsObject, IsNumber } from 'class-validator';

export class CreateClinicLocationDto {
    @ApiProperty({
        description: 'Name of the clinic location',
        example: 'Main Street Clinic'
    })
    @IsString()
    @Length(2, 100)
    name: string;

    @ApiProperty({
        description: 'Street address of the clinic',
        example: '123 Main Street'
    })
    @IsString()
    @Length(5, 200)
    address: string;

    @ApiProperty({
        description: 'City where the clinic is located',
        example: 'New York'
    })
    @IsString()
    @Length(2, 100)
    city: string;

    @ApiProperty({
        description: 'State/Province where the clinic is located',
        example: 'NY'
    })
    @IsString()
    @Length(2, 100)
    state: string;

    @ApiProperty({
        description: 'Country where the clinic is located',
        example: 'USA'
    })
    @IsString()
    @Length(2, 100)
    country: string;

    @ApiProperty({
        description: 'ZIP/Postal code of the clinic',
        example: '10001'
    })
    @IsString()
    @Length(5, 20)
    zipCode: string;

    @ApiProperty({
        description: 'Contact phone number for the clinic',
        example: '+1-555-555-5555'
    })
    @IsPhoneNumber()
    phone: string;

    @ApiProperty({
        description: 'Contact email for the clinic',
        example: 'main@clinic.com'
    })
    @IsEmail()
    email: string;

    @ApiProperty({
        description: 'Timezone of the clinic location',
        example: 'America/New_York'
    })
    @IsString()
    @Length(3, 50)
    timezone: string;

    @ApiProperty({
        description: 'Whether the clinic location is active',
        example: true,
        default: true
    })
    @IsBoolean()
    @IsOptional()
    isActive?: boolean;

    @ApiProperty({
        description: 'Latitude coordinate of the clinic location',
        example: 40.7128,
        required: false
    })
    @IsOptional()
    @IsNumber()
    latitude?: number;

    @ApiProperty({
        description: 'Longitude coordinate of the clinic location',
        example: -74.0060,
        required: false
    })
    @IsOptional()
    @IsNumber()
    longitude?: number;

    @ApiProperty({
        example: {
            monday: { start: '09:00', end: '17:00' },
            tuesday: { start: '09:00', end: '17:00' },
            wednesday: { start: '09:00', end: '17:00' },
            thursday: { start: '09:00', end: '17:00' },
            friday: { start: '09:00', end: '17:00' },
            saturday: { start: '09:00', end: '13:00' },
            sunday: null
        },
        description: 'Working hours of the clinic location',
        required: false
    })
    @IsOptional()
    @IsObject()
    workingHours?: Record<string, { start: string; end: string } | null>;

    @ApiProperty({
        description: 'Location-specific settings as JSON object',
        example: { parking: true, wheelchair: true, wifi: true },
        required: false
    })
    @IsOptional()
    @IsObject()
    settings?: Record<string, any>;
} 