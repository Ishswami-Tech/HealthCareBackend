import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HealthRecordSummaryDto } from '@dtos/ehr.dto';

/**
 * Patient-facing dashboard summary response.
 *
 * Composed in `PatientsService.getDashboardSummary()` by fanning out
 * to existing services (Appointments, EHR, Pharmacy, Billing) in parallel
 * and merging the results. Designed to be served from a single 60-second
 * server-side cache so subsequent visits are sub-200ms.
 *
 * Sub-fields can be partially populated when a sub-call fails — the
 * frontend renders whatever is available and shows empty states for
 * the rest.
 */
export class PatientDashboardSummaryDto {
  @ApiProperty({
    description: 'When this summary was generated (ISO 8601)',
    example: '2026-06-24T06:30:00.000Z',
  })
  generatedAt!: string;

  @ApiPropertyOptional({
    description:
      'Sub-calls that failed during composition. Keys: appointments, ehr, prescriptions, invoices, payments.',
    example: { ehr: 'timeout' },
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  errors?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Non-terminal appointments (SCHEDULED / CONFIRMED / IN_PROGRESS). ' +
      'De-duplicated by id and sorted by start time.',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  appointments?: unknown[];

  @ApiPropertyOptional({
    description: 'Active prescriptions belonging to the patient.',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  prescriptions?: unknown[];

  @ApiPropertyOptional({
    description:
      'Comprehensive EHR summary — vitals, allergies, medications, medical history, etc.',
    type: () => HealthRecordSummaryDto,
  })
  comprehensive?: HealthRecordSummaryDto;

  @ApiPropertyOptional({
    description: 'User invoices (OPEN + OVERDUE + recent paid). Newest first.',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  invoices?: unknown[];

  @ApiPropertyOptional({
    description: 'User payments. Newest first.',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  payments?: unknown[];
}
