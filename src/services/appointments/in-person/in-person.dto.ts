import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/** deviceInfo is audit metadata only: a flat-ish record of at most this many keys / bytes. */
export const DEVICE_INFO_MAX_KEYS = 20;
export const DEVICE_INFO_MAX_BYTES = 2048;

/** Pure rule: a plain object with <= DEVICE_INFO_MAX_KEYS keys and <= DEVICE_INFO_MAX_BYTES JSON. */
export function isBoundedDeviceInfo(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (Object.keys(value).length > DEVICE_INFO_MAX_KEYS) {
    return false;
  }
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= DEVICE_INFO_MAX_BYTES;
  } catch {
    return false;
  }
}

function IsBoundedDeviceInfo(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: 'isBoundedDeviceInfo',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message: `deviceInfo must be an object with at most ${DEVICE_INFO_MAX_KEYS} keys and ${DEVICE_INFO_MAX_BYTES} bytes`,
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown): boolean => isBoundedDeviceInfo(value),
      },
    });
  };
}

/**
 * Device position. `{ lat, lng }` is the API shape; `{ latitude, longitude }` (browser / expo-location
 * names) is accepted too. `accuracy` is the fix accuracy in metres (see desk-code-presence.util).
 */
export class InPersonCheckInCoordinatesDto {
  @ApiPropertyOptional({ minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, description: 'Alias of lat' })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, description: 'Alias of lng' })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Fix accuracy in metres' })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100_000)
  accuracy?: number;
}

/**
 * POST /in-person/check-in - the one check-in entry point.
 * PATIENT: `qrCode` (the scanned location poster text or the typed desk code), optional
 * `appointmentId` to pick one of several bookings, `coordinates` (REQUIRED for a typed desk code,
 * optional for a scanned poster). Reception / clinic admin: `appointmentId` only.
 */
export class InPersonCheckInDto {
  @ApiPropertyOptional({ description: 'Scanned location QR text (patients only)' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  qrCode?: string;

  @ApiPropertyOptional({ description: 'Appointment to check in (required for reception)' })
  @IsOptional()
  @IsUUID('4')
  appointmentId?: string;

  @ApiPropertyOptional({
    type: () => InPersonCheckInCoordinatesDto,
    description:
      'Patient device position { lat, lng, accuracy? }. Required for a typed desk code (400 LOCATION_REQUIRED, 403 TOO_FAR), optional for a scanned poster.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => InPersonCheckInCoordinatesDto)
  coordinates?: InPersonCheckInCoordinatesDto;

  @ApiPropertyOptional({
    description: `Device details for the audit trail (max ${DEVICE_INFO_MAX_KEYS} keys, ${DEVICE_INFO_MAX_BYTES} bytes)`,
  })
  @IsOptional()
  @IsObject()
  @IsBoundedDeviceInfo()
  deviceInfo?: Record<string, unknown>;
}

/**
 * POST /in-person/walk-in - reception registers a patient who walked in without a booking.
 * The patient must exist (new patients are created first with POST /patients). The location is
 * the receptionist's allotted one; clinic admin / location head name it (or the clinic has one).
 */
export class InPersonWalkInDto {
  @ApiProperty({ description: 'Patient.id (or the patient user id)' })
  @IsUUID('4')
  patientId!: string;

  @ApiPropertyOptional({ description: 'ClinicLocation id (ignored for RECEPTIONIST)' })
  @IsOptional()
  @IsUUID('4')
  locationId?: string;

  @ApiPropertyOptional({
    description:
      'Doctor.id (or the doctor User id) for clinics with more than one doctor; must practise in ' +
      'this clinic (404 otherwise). Omitted: the clinic single doctor is used (400 when several).',
  })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({
    description:
      'Ignored (kept for older clients): the visit length is the clinic in-person setting ' +
      '(appointmentSettings.inPersonDurationMinutes, default 3)',
    minimum: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  durationMinutes?: number;

  @ApiPropertyOptional({ description: 'Reason for the visit / desk note', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
