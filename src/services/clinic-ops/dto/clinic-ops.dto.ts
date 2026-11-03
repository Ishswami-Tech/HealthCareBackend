/**
 * Clinic Ops DTOs (leave, holidays, check-in log, Rx drafts, direct dispense, billing ops, staff).
 * @module ClinicOps
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------------------------------------------------------------------------
// Leave & holidays
// ---------------------------------------------------------------------------

export const LEAVE_KINDS = ['LEAVE', 'HALF_DAY', 'BREAK'] as const;
export const HOLIDAY_KINDS = ['HOLIDAY', 'CLOSURE', 'DOCTOR_LEAVE'] as const;

export class CreateLeaveRequestDto {
  @ApiPropertyOptional({ enum: LEAVE_KINDS, default: 'LEAVE' })
  @IsOptional()
  @IsIn(LEAVE_KINDS as unknown as string[])
  kind?: (typeof LEAVE_KINDS)[number];

  @ApiProperty({ example: '2026-10-28', description: 'First day (YYYY-MM-DD)' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-10-29', description: 'Last day, inclusive (YYYY-MM-DD)' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ example: '13:00', description: 'HALF_DAY / BREAK start (HH:mm)' })
  @IsOptional()
  @Matches(HHMM, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @Matches(HHMM, { message: 'endTime must be HH:mm' })
  endTime?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: 'Colleague (user id) covering the shift' })
  @IsOptional()
  @IsUUID()
  coverUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class DecideLeaveRequestDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'Approve only: notify patients whose appointments fall in the leave window',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  notifyPatients?: boolean;
}

export class CreateClinicHolidayDto {
  @ApiProperty({ example: 'Diwali', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ enum: HOLIDAY_KINDS, default: 'HOLIDAY' })
  @IsOptional()
  @IsIn(HOLIDAY_KINDS as unknown as string[])
  kind?: (typeof HOLIDAY_KINDS)[number];

  @ApiProperty({ example: '2026-11-08' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-11-09' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ description: 'Omit for the whole clinic' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  notifyPatients?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  messageTemplate?: string;
}

export class UpdateClinicHolidayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ enum: HOLIDAY_KINDS })
  @IsOptional()
  @IsIn(HOLIDAY_KINDS as unknown as string[])
  kind?: (typeof HOLIDAY_KINDS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyPatients?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  messageTemplate?: string;
}

// ---------------------------------------------------------------------------
// Check-in log
// ---------------------------------------------------------------------------

export const CHECK_IN_RESOLUTIONS = ['MANUAL_CHECK_IN', 'CALLED', 'IGNORED'] as const;

export class ResolveCheckInAttemptDto {
  @ApiProperty({ enum: CHECK_IN_RESOLUTIONS })
  @IsIn(CHECK_IN_RESOLUTIONS as unknown as string[])
  resolution!: (typeof CHECK_IN_RESOLUTIONS)[number];

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

// ---------------------------------------------------------------------------
// Queue priority
// ---------------------------------------------------------------------------

export const QUEUE_PRIORITY_LABELS = ['NORMAL', 'SENIOR', 'PREGNANT', 'EMERGENCY'] as const;

export class SetQueuePriorityDto {
  @ApiProperty({ enum: QUEUE_PRIORITY_LABELS, description: 'NORMAL clears the priority' })
  @IsIn(QUEUE_PRIORITY_LABELS as unknown as string[])
  priority!: (typeof QUEUE_PRIORITY_LABELS)[number];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

// ---------------------------------------------------------------------------
// Rx drafts (assistant doctor -> doctor approval)
// ---------------------------------------------------------------------------

export class ReturnRxDraftDto {
  @ApiProperty({ description: 'What the assistant must change', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note!: string;
}

export class ResubmitRxDraftDto {
  @ApiPropertyOptional({ description: 'Note for the doctor about what changed', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// ---------------------------------------------------------------------------
// Direct dispense
// ---------------------------------------------------------------------------

export class DirectDispenseLineDto {
  @ApiProperty()
  @IsUUID()
  medicineId!: string;

  @ApiProperty({ minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity!: number;
}

export class CreateDirectDispenseDto {
  @ApiPropertyOptional({ description: 'Registered patient (Patient.id)' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: 'Required when patientId is omitted (walk-in)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  walkInName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  walkInPhone?: string;

  @ApiPropertyOptional({ description: 'Prescription this hand-over relates to (informational)' })
  @IsOptional()
  @IsUUID()
  prescriptionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @ApiProperty({ type: [DirectDispenseLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => DirectDispenseLineDto)
  items!: DirectDispenseLineDto[];
}

export class ReverseDirectDispenseDto {
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;
}

export const SETTLE_METHODS = ['CASH', 'UPI', 'CARD', 'WAIVED'] as const;

export class SettleDirectDispenseDto {
  @ApiProperty({ enum: SETTLE_METHODS, description: 'Recorded only - no payment is processed' })
  @IsIn(SETTLE_METHODS as unknown as string[])
  method!: (typeof SETTLE_METHODS)[number];
}

// ---------------------------------------------------------------------------
// Billing ops
// ---------------------------------------------------------------------------

export class SendInvoiceReminderDto {
  @ApiPropertyOptional({ enum: ['WHATSAPP', 'SMS'], default: 'WHATSAPP' })
  @IsOptional()
  @IsIn(['WHATSAPP', 'SMS'])
  channel?: 'WHATSAPP' | 'SMS';

  @ApiPropertyOptional({ enum: ['en', 'mr', 'hi'], default: 'en' })
  @IsOptional()
  @IsIn(['en', 'mr', 'hi'])
  language?: 'en' | 'mr' | 'hi';

  @ApiPropertyOptional({ description: 'Custom text; a localized default is used when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  message?: string;

  @ApiPropertyOptional({ description: 'ISO date-time; omit to send now' })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}

// ---------------------------------------------------------------------------
// Staff invites
// ---------------------------------------------------------------------------

export const INVITABLE_ROLES = [
  'RECEPTIONIST',
  'PHARMACIST',
  'NURSE',
  'ASSISTANT_DOCTOR',
  'THERAPIST',
  'CLINIC_ADMIN',
] as const;

export class CreateStaffInviteDto {
  @ApiProperty({ enum: INVITABLE_ROLES })
  @IsIn(INVITABLE_ROLES as unknown as string[])
  role!: (typeof INVITABLE_ROLES)[number];

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'phone must be 8-15 digits, optional leading +' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ type: [String], description: 'Clinic locations the invitee works at' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  locationIds?: string[];
}

// ---------------------------------------------------------------------------
// Location QR / hours
// ---------------------------------------------------------------------------

export class RegenerateLocationQrDto {
  @ApiPropertyOptional({ description: 'Why the poster is being replaced (audit)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

// ---------------------------------------------------------------------------
// Counter hand-over (pharmacy)
// ---------------------------------------------------------------------------

export class VerifyHandoverDto {
  @ApiProperty({
    description:
      '6-digit code shown by the patient, or the raw text of their QR (TBD-HO:<handoverId>:<code>)',
    example: '123456',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^(\d{6}|TBD-HO:[0-9a-fA-F-]{36}:\d{6})$/, {
    message: 'code must be the 6-digit code or the hand-over QR text',
  })
  code!: string;

  @ApiPropertyOptional({
    enum: ['QR', 'OTP'],
    default: 'OTP',
    description: 'How the code was entered',
  })
  @IsOptional()
  @IsIn(['QR', 'OTP'])
  method?: 'QR' | 'OTP';
}

/** Counter fallback when the patient has no app / phone: an explicit identity check + reason. */
export class VerifyHandoverWithoutCodeDto {
  @ApiProperty({
    enum: ['PHONE_LAST4', 'UHID'],
    description: 'How the desk confirmed who the patient is',
  })
  @IsIn(['PHONE_LAST4', 'UHID'])
  identityCheck!: 'PHONE_LAST4' | 'UHID';

  @ApiProperty({
    description: 'Last 4 digits of the phone on file, or the clinic UHID',
    example: '4321',
    maxLength: 40,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  identityValue!: string;

  @ApiProperty({
    description: 'Why the code could not be used (for example: no phone with the patient)',
    minLength: 3,
    maxLength: 200,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 200)
  reason!: string;
}

export class HandoverChecklistItemDto {
  @ApiProperty()
  @IsUUID()
  prescriptionItemId!: string;

  @ApiProperty()
  @IsBoolean()
  handedOver!: boolean;
}

export class ConfirmHandoverDto {
  @ApiProperty({ type: [HandoverChecklistItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => HandoverChecklistItemDto)
  itemChecklist!: HandoverChecklistItemDto[];

  @ApiProperty({ description: 'Name of the person who received the medicines', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  acknowledgedBy!: string;

  @ApiPropertyOptional({ description: 'Signature as a data: URL or base64 PNG (max ~200 KB)' })
  @IsOptional()
  @IsString()
  @MaxLength(300000)
  signature?: string;
}

// ---------------------------------------------------------------------------
// Pharmacy batch actions
// ---------------------------------------------------------------------------

export class BatchActionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(1000000)
  quantity!: number;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;

  @ApiPropertyOptional({ description: 'Return-to-supplier only: the supplier receiving the stock' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

// ---------------------------------------------------------------------------
// Lab booking
// ---------------------------------------------------------------------------

export const LAB_BOOKING_STATUSES = [
  'CONFIRMED',
  'SAMPLE_COLLECTED',
  'COMPLETED',
  'CANCELLED',
] as const;

export class CreateLabBookingDto {
  @ApiProperty({ example: 'FULL_BODY_BASIC', maxLength: 60 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  packageCode!: string;

  @ApiProperty({ example: 'Full body checkup', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  packageName!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Subset of the package tests to run (defaults to the whole package)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  tests?: string[];

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  addressLine!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4,10}$/, { message: 'zipCode must be 4-10 digits' })
  zipCode?: string;

  @ApiProperty({ example: '2026-10-24' })
  @IsDateString()
  slotDate!: string;

  @ApiProperty({ example: '07:00-09:00', description: 'Collection window HH:mm-HH:mm' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'slotWindow must look like 07:00-09:00',
  })
  slotWindow!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class UpdateLabBookingStatusDto {
  @ApiProperty({ enum: LAB_BOOKING_STATUSES })
  @IsIn(LAB_BOOKING_STATUSES as unknown as string[])
  status!: (typeof LAB_BOOKING_STATUSES)[number];
}

// ---------------------------------------------------------------------------
// Help chat
// ---------------------------------------------------------------------------

export const SUPPORT_QUICK_REPLIES = [
  'RESCHEDULE',
  'CHECK_IN_HELP',
  'REPORTS',
  'BILLING',
  'PRESCRIPTION',
  'TALK_TO_STAFF',
] as const;

export class SendSupportMessageDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  body!: string;

  @ApiPropertyOptional({
    enum: SUPPORT_QUICK_REPLIES,
    description: 'Set when a quick-reply chip was tapped',
  })
  @IsOptional()
  @IsIn(SUPPORT_QUICK_REPLIES as unknown as string[])
  quickReply?: (typeof SUPPORT_QUICK_REPLIES)[number];
}

export class StaffSupportReplyDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  body!: string;
}

// ---------------------------------------------------------------------------
// Investigations
// ---------------------------------------------------------------------------

export class InvestigationTestDto {
  @ApiProperty({ example: 'CBC', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: ['LAB', 'IMAGING'], default: 'LAB' })
  @IsOptional()
  @IsIn(['LAB', 'IMAGING'])
  kind?: 'LAB' | 'IMAGING';
}

export class CreateInvestigationOrderDto {
  @ApiProperty()
  @IsUUID()
  patientId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  visitId?: string;

  @ApiProperty({ type: [InvestigationTestDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => InvestigationTestDto)
  tests!: InvestigationTestDto[];

  @ApiPropertyOptional({ enum: ['ROUTINE', 'URGENT', 'STAT'], default: 'ROUTINE' })
  @IsOptional()
  @IsIn(['ROUTINE', 'URGENT', 'STAT'])
  urgency?: 'ROUTINE' | 'URGENT' | 'STAT';

  @ApiPropertyOptional({ description: 'Lab / imaging centre the patient is sent to' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  labDestination?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateInvestigationStatusDto {
  @ApiProperty({ enum: ['SAMPLE_COLLECTED', 'RESULT_READY', 'CANCELLED'] })
  @IsIn(['SAMPLE_COLLECTED', 'RESULT_READY', 'CANCELLED'])
  status!: 'SAMPLE_COLLECTED' | 'RESULT_READY' | 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Doctor / assistant favourites (per account)
// ---------------------------------------------------------------------------

export const FAVOURITE_KINDS = [
  'MEDICINE',
  'RX_TEMPLATE',
  'DIAGNOSIS',
  'INVESTIGATION',
  'PATIENT',
  'OTHER',
] as const;

export class UpsertFavouriteDto {
  @ApiProperty({ enum: FAVOURITE_KINDS })
  @IsIn(FAVOURITE_KINDS as unknown as string[])
  kind!: (typeof FAVOURITE_KINDS)[number];

  @ApiProperty({
    description: 'Stable key within the kind (medicine id, template id, diagnosis code ...)',
    maxLength: 120,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  itemKey!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional({
    description: 'Free-form JSON the screen needs back (dose, frequency, ...)',
  })
  @IsOptional()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export class BulkFavouritesDto {
  @ApiProperty({
    type: [UpsertFavouriteDto],
    description: 'One-off import of the device-local favourites',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => UpsertFavouriteDto)
  items!: UpsertFavouriteDto[];
}
