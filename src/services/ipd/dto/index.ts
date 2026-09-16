/**
 * IPD DTOs Barrel Export
 * @module IPD DTOs
 */

export {
  WardType,
  BedStatus,
  AdmissionStatus,
  NoteSeverity,
  MedicationRoute,
  DischargeType,
} from './ipd.enums';

export { CreateWardDto, UpdateWardDto, CreateBedDto, UpdateBedDto } from './ipd.request-dtos';

export { AdmitPatientDto, TransferBedDto, DischargePatientDto } from './ipd.admission-dtos';

export {
  CreateNursingNoteDto,
  RecordVitalsDto,
  AdministerMedicationDto,
  AccrueDailyChargesDto,
  BedBoardQueryDto,
  NursingNotesQueryDto,
} from './ipd.nursing-dtos';

export { WardResponseDto, BedResponseDto } from './ipd.ward-bed-dtos';

export { AdmissionResponseDto, BedAssignmentResponseDto } from './ipd.response-dtos';

export {
  NursingNoteResponseDto,
  VitalsResponseDto,
  BedsideMedicationResponseDto,
  DischargeSummaryResponseDto,
  BedChargeResponseDto,
} from './ipd.clinical-dtos';
