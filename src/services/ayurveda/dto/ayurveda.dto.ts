/**
 * Ayurvedic Dosha Types
 * @enum DoshaType
 * @description The three fundamental energies in Ayurvedic physiology
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  TreatmentPlanDto,
  TreatmentPricingDto,
  TreatmentRequirementDto,
} from '@dtos/appointment.dto';
import { TreatmentType } from '@core/types/enums.types';

export enum DoshaType {
  VATA = 'VATA',
  PITTA = 'PITTA',
  KAPHA = 'KAPHA',
}

/**
 * Ayurvedic Prakriti Assessment Request DTO
 * @class CreatePrakritiAssessmentDto
 * @description Request body for submitting a new Prakriti assessment questionnaire
 */
export class CreatePrakritiAssessmentDto {
  /** The patient being assessed */
  patientId!: string;

  /** Questionnaire answers scored 0-3 */
  questionnaireAnswers!: Record<string, number>;

  /** Optional notes from the patient before assessment */
  patientNotes?: string;
}

/**
 * Prakriti Assessment Practitioner Notes DTO
 * @class UpdatePrakritiAssessmentDto
 * @description Allows practitioner to add notes and confirm assessment
 */
export class UpdatePrakritiAssessmentDto {
  /** Practitioner's clinical observations */
  practitionerNotes?: string;

  /** Whether the practitioner has confirmed this assessment */
  isConfirmed?: boolean;

  /** Recommended lifestyle modifications */
  recommendations?: string;
}

/**
 * Prakriti Assessment Response DTO
 * @interface PrakritiAssessmentResponse
 */
export class PrakritiAssessmentResponseDto {
  /** Unique identifier */
  id!: string;

  /** Patient ID */
  patientId!: string;

  /** Clinic ID */
  clinicId!: string;

  /** Dominant dosha type */
  primaryDosha!: DoshaType;

  /** Secondary dosha if applicable */
  secondaryDosha?: DoshaType | undefined;

  /** Vata score */
  vataScore!: number;

  /** Pitta score */
  pittaScore!: number;

  /** Kapha score */
  kaphaScore!: number;

  /** Questionnaire answers stored */
  questionnaireAnswers!: Record<string, number>;

  /** Patient-provided notes */
  patientNotes?: string | undefined;

  /** Practitioner clinical notes */
  practitionerNotes?: string | undefined;

  /** Whether practitioner confirmed */
  isConfirmed!: boolean;

  /** Recommendations */
  recommendations?: string | undefined;

  /** Assessment timestamp */
  assessedAt!: string;

  /** Created by user ID */
  createdBy?: string | undefined;
}

/**
 * Nadi Pariksha (Pulse Diagnosis) Request DTO
 * @class CreateNadiParikshaDto
 * @description Records pulse diagnosis findings
 */
export class CreateNadiParikshaDto {
  /** Patient ID */
  patientId!: string;

  /** Dominant dosha detected in pulse */
  dominantDosha!: DoshaType;

  /** Pulse rhythm quality description */
  pulseQuality!: string;

  /** Regularity assessment */
  regularity?: string;

  /** Strength assessment */
  strength?: string;

  /** Any abnormalities observed */
  abnormalities?: string;

  /** Practitioner's interpretation */
  interpretation!: string;

  /** Clinical observations */
  observations?: string;

  /** Assessment side (left/right/both) */
  side?: string;
}

/**
 * Nadi Pariksha Response DTO
 * @class NadiParikshaResponseDto
 */
export class NadiParikshaResponseDto {
  /** Unique identifier */
  id!: string;

  /** Patient ID */
  patientId!: string;

  /** Clinic ID */
  clinicId!: string;

  /** Dominant dosha detected */
  dominantDosha!: DoshaType;

  /** Pulse quality */
  pulseQuality!: string;

  /** Regularity */
  regularity?: string | undefined;

  /** Strength */
  strength?: string | undefined;

  /** Abnormalities */
  abnormalities?: string | undefined;

  /** Practitioner interpretation */
  interpretation!: string;

  /** Clinical observations */
  observations?: string | undefined;

  /** Assessment side */
  side?: string | undefined;

  /** Performed by user ID */
  performedBy!: string;

  /** Assessment timestamp */
  assessedAt!: string;
}

/**
 * Ayurvedic Diagnosis Request DTO
 * @class CreateAyurvedicDiagnosisDto
 * @description Creates a comprehensive diagnosis linking Prakriti, Nadi, and Samprapti
 */
export class CreateAyurvedicDiagnosisDto {
  /** Patient ID */
  patientId!: string;

  /** Related Prakriti assessment ID */
  prakritiAssessmentId!: string;

  /** Related Nadi Pariksha ID */
  nadiParikshaId!: string;

  /** Primary disease/condition in Ayurvedic terms */
  primaryDisease!: string;

  /** Secondary conditions */
  secondaryDiseases?: string[];

  /** Disease classification (Nija/Agantuja) */
  diseaseClassification?: string;

  /** Vyadhi type (Adhyatmika etc.) */
  vyadhiType?: string;

  /** Practitioner's clinical assessment */
  clinicalAssessment!: string;

  /** Agni (digestive fire) status */
  agniStatus?: string;

  /** Ama (toxins) presence */
  amaPresence?: string;

  /** Srotas (channels) affected */
  srotasAffected?: string;

  /** Overall assessment notes */
  notes?: string;

  /** Confidence level (low/medium/high) */
  confidenceLevel?: string;
}

/**
 * Ayurvedic Diagnosis Response DTO
 * @class AyurvedicDiagnosisResponseDto
 */
export class AyurvedicDiagnosisResponseDto {
  /** Unique identifier */
  id!: string;

  /** Patient ID */
  patientId!: string;

  /** Clinic ID */
  clinicId!: string;

  /** Related Prakriti assessment ID */
  prakritiAssessmentId!: string;

  /** Related Nadi Pariksha ID */
  nadiParikshaId!: string;

  /** Primary disease */
  primaryDisease!: string;

  /** Secondary diseases */
  secondaryDiseases?: string[] | undefined;

  /** Disease classification */
  diseaseClassification?: string | undefined;

  /** Vyadhi type */
  vyadhiType?: string | undefined;

  /** Clinical assessment */
  clinicalAssessment!: string;

  /** Agni status */
  agniStatus?: string | undefined;

  /** Ama presence */
  amaPresence?: string | undefined;

  /** Srotas affected */
  srotasAffected?: string | undefined;

  /** Notes */
  notes?: string | undefined;

  /** Confidence level */
  confidenceLevel?: string | undefined;

  /** Diagnosis status */
  status!: string;

  /** Created by user ID */
  createdBy?: string | undefined;

  /** Diagnosis timestamp */
  diagnosedAt!: string;
}

/**
 * Samprapti Stage Record DTO
 * @class CreateSampraptiStageDto
 * @description Records a stage in the disease pathogenesis (Samprapti) progression
 */
export class CreateSampraptiStageDto {
  /** Stage name in Sanskrit */
  stageName!: string;

  /** Stage sequence number */
  stageOrder!: number;

  /** Dosha involved */
  doshaInvolved!: DoshaType;

  /** Dhatu (tissue) affected */
  dhatuAffected?: string;

  /** Description of this stage */
  description!: string;

  /** Symptoms observed at this stage */
  symptoms!: string[];

  /** Clinical findings */
  clinicalFindings?: string;

  /** Whether this stage is currently active */
  isActive!: boolean;

  /** Stage completion timestamp */
  completedAt?: string;
}

/**
 * Samprapti Stage Response DTO
 * @class SampraptiStageResponseDto
 */
export class SampraptiStageResponseDto {
  id!: string;
  diagnosisId!: string;
  stageName!: string;
  stageOrder!: number;
  doshaInvolved!: DoshaType;
  dhatuAffected?: string | undefined;
  description!: string;
  symptoms!: string[];
  clinicalFindings?: string | undefined;
  isActive!: boolean;
  completedAt?: string | undefined;
  recordedBy!: string;
  createdAt!: string;
  updatedAt!: string;
}

/**
 * Dosha Imbalance Record DTO
 * @class CreateDoshaImbalanceDto
 * @description Records a dosha imbalance assessment
 */
export class CreateDoshaImbalanceDto {
  /** Patient ID */
  patientId!: string;

  /** Diagnosis ID this is linked to */
  diagnosisId?: string;

  /** Which dosha is imbalanced */
  doshaType!: DoshaType;

  /** Imbalance type (vriddhi/kshaya/sama) */
  imbalanceType!: string;

  /** Severity (mild/moderate/severe) */
  severity!: string;

  /** Vitals affected */
  vitalsAffected?: string[];

  /** Symptoms */
  symptoms!: string[];

  /** Root causes identified */
  rootCauses?: string[];

  /** Practitioner notes */
  practitionerNotes?: string;

  /** Recommended interventions */
  interventions?: string[];

  /** Assessment date */
  assessedAt?: string;
}

/**
 * Dosha Imbalance Response DTO
 * @class DoshaImbalanceResponseDto
 */
export class DoshaImbalanceResponseDto {
  id!: string;
  patientId!: string;
  clinicId!: string;
  diagnosisId?: string | undefined;
  doshaType!: DoshaType;
  imbalanceType!: string;
  severity!: string;
  vitalsAffected?: string[] | undefined;
  symptoms!: string[];
  rootCauses?: string[] | undefined;
  practitionerNotes?: string | undefined;
  interventions?: string[] | undefined;
  assessedAt!: string;
  assessedBy!: string;
  createdAt!: string;
  updatedAt!: string;
}

/**
 * Ayurveda-specific treatment plan DTO.
 *
 * Wraps the shared treatment plan structure with patient/clinic context so
 * the Ayurveda module can express real treatment requirements without
 * hardcoding a specific consumable type.
 */
export class AyurvedicTreatmentPlanDto extends TreatmentPlanDto {
  @ApiPropertyOptional({
    example: 'patient-uuid-123',
    description: 'Patient linked to the treatment plan',
  })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Clinic linked to the treatment plan',
  })
  @IsOptional()
  @IsString()
  clinicId?: string;

  @ApiPropertyOptional({
    example: 'diagnosis-uuid-123',
    description: 'Related diagnosis for the treatment plan',
  })
  @IsOptional()
  @IsString()
  diagnosisId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether a room, bed, or therapy space is required',
  })
  @IsOptional()
  @IsBoolean()
  roomRequired?: boolean;
}

/**
 * Request DTO for previewing or preparing a treatment plan in Ayurveda.
 */
export class CreateAyurvedicTreatmentPlanDto {
  @ApiProperty({
    example: 'patient-uuid-123',
    description: 'Patient linked to the treatment plan',
  })
  @IsString()
  patientId!: string;

  @ApiProperty({
    example: 'clinic-uuid-123',
    description: 'Clinic linked to the treatment plan',
  })
  @IsString()
  clinicId!: string;

  @ApiPropertyOptional({
    example: 'diagnosis-uuid-123',
    description: 'Related diagnosis if the plan is anchored to one',
  })
  @IsOptional()
  @IsString()
  diagnosisId?: string;

  @ApiProperty({
    example: 'Panchakarma',
    description: 'Primary treatment type',
  })
  @IsEnum(TreatmentType, { message: 'Treatment type must be a valid treatment enum value' })
  treatmentType!: TreatmentType;

  @ApiPropertyOptional({
    example: 'Virechana',
    description: 'Specific sub-procedure selected by the doctor',
  })
  @IsOptional()
  @IsEnum(TreatmentType, { message: 'Sub-procedure must be a valid treatment enum value' })
  subProcedure?: TreatmentType;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether a room, bed, or therapy space is required',
  })
  @IsOptional()
  @IsBoolean()
  roomRequired?: boolean;

  @ApiPropertyOptional({
    example: ['Morning steam session', 'Medication after lunch'],
    description: 'Doctor notes and treatment instructions',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  instructions?: string[];

  @ApiPropertyOptional({
    example: [],
    description: 'Generic treatment requirements can be supplied from the UI or generated later',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TreatmentRequirementDto)
  requirements?: TreatmentRequirementDto[];

  @ApiPropertyOptional({
    type: () => TreatmentPricingDto,
    description: 'Optional pricing breakdown submitted by the caller',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TreatmentPricingDto)
  pricing?: TreatmentPricingDto;
}

/**
 * Ayurvedic Timeline Response DTO
 * @class AyurvedicTimelineResponseDto
 */
export class AyurvedicTimelineResponseDto {
  events!: Array<Record<string, unknown>>;
  doshaTrend!: Record<string, unknown>;
  summary!: Record<string, unknown>;
}
