// Core infrastructure
export * from './infrastructure';

// Utilities
export * from './utils/QR';

// DTOs - explicit export to avoid conflicts
export { HealthStatus as DTOHealthStatus } from './dtos/health.dto';
export * from './dtos/user.dto';
export * from './dtos/auth.dto';
export * from './dtos/common-response.dto';
// Export appointment DTOs with explicit naming to avoid QueueStatus conflict
export {
  AppointmentType,
  AppointmentStatus,
  AppointmentPriority,
  QueueStatus as AppointmentQueueStatus,
  NotificationType as AppointmentNotificationType,
  Language,
  CreateAppointmentDto,
  UpdateAppointmentDto,
  AppointmentResponseDto,
  AppointmentFilterDto,
  AppointmentListResponseDto,
  DoctorAvailabilityResponseDto,
  ScheduleFollowUpDto,
  FollowUpPlanResponseDto,
  UpdateFollowUpPlanDto,
  AppointmentChainResponseDto,
  CreateRecurringSeriesDto,
  UpdateRecurringSeriesDto,
  RecurringSeriesResponseDto,
  AppointmentSearchDto,
  BulkCreateAppointmentsDto,
  CancelAppointmentDto,
  RescheduleAppointmentDto,
  ScanLocationQRDto,
  ScanLocationQRResponseDto,
  LocationQRCodeResponseDto,
  ProcessCheckInDto,
  ReorderQueueDto,
  VerifyAppointmentQRDto,
  CompleteAppointmentDto,
  StartConsultationDto,
} from './dtos/appointment.dto';
export * from './dtos/clinic.dto';

// Security - commented out until implemented
// export * from './security';
