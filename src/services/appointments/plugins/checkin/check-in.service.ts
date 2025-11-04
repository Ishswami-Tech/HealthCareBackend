import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database';
import { AppointmentType, AppointmentStatus } from '@core/types/enums.types';
import type { AppointmentBase, Doctor, PatientBase, Clinic } from '@core/types/database.types';
import type { ClinicLocation } from '@core/types/clinic.types';
import type {
  CheckInData,
  CheckInResult,
  AppointmentQueuePosition,
  CheckInAppointment,
  CheckedInAppointmentsResponse,
  LocationQueueResponse,
} from '@core/types/appointment.types';
type Appointment = AppointmentBase;
type Patient = PatientBase;

// Re-export types from centralized location for backward compatibility
export type {
  DeviceInfo,
  CheckInData,
  CheckInResult,
  AppointmentQueuePosition as QueuePosition,
  CheckInAppointment,
  CheckedInAppointmentsResponse,
  QueueStatsResponse,
  LocationQueueResponse,
} from '@core/types/appointment.types';
export type { ClinicLocation } from '@core/types/clinic.types';

/**
 * Appointment with relations for check-in service
 * Extends AppointmentBase with related entities
 */
export interface AppointmentWithRelations extends Appointment {
  doctor: Doctor;
  patient: Patient;
  clinic: Clinic;
  location: ClinicLocation;
}

@Injectable()
export class CheckInService {
  private readonly CHECKIN_CACHE_TTL = 1800; // 30 minutes
  private readonly QUEUE_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly databaseService: DatabaseService
  ) {}

  async checkIn(appointmentId: string, userId: string): Promise<CheckInResult> {
    const startTime = Date.now();

    try {
      // Validate appointment exists and belongs to user
      const appointment = await this.validateAppointment(appointmentId, userId);

      // Check if already checked in
      const existingCheckIn = await this.getExistingCheckIn(appointmentId);
      if (existingCheckIn) {
        throw new BadRequestException('Appointment already checked in');
      }

      // Perform check-in
      const checkInData: CheckInData = {
        appointmentId,
        userId,
        checkInMethod: 'manual',
        timestamp: new Date().toISOString(),
        locationId: appointment.locationId,
      };

      const result = await this.performCheckIn(checkInData);

      // Add to queue if needed
      if (appointment.domain === 'healthcare') {
        const queuePosition = await this.addToQueue(
          appointmentId,
          appointment.doctorId,
          appointment.locationId,
          appointment.domain
        );
        result.queuePosition = queuePosition.position;
        result.estimatedWaitTime = queuePosition.estimatedWaitTime;
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Check-in successful',
        'CheckInService',
        { appointmentId, userId, responseTime: Date.now() - startTime }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to check in: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          appointmentId,
          userId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getCheckedInAppointments(clinicId: string): Promise<CheckedInAppointmentsResponse> {
    const startTime = Date.now();
    const cacheKey = `checkins:clinic:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as CheckedInAppointmentsResponse;
      }

      // Get checked-in appointments from database (placeholder implementation)
      const appointments = await this.fetchCheckedInAppointments(clinicId);

      const result: CheckedInAppointmentsResponse = {
        appointments: appointments as CheckInAppointment[],
        clinicId,
        total: appointments.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.CHECKIN_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Checked-in appointments retrieved successfully',
        'CheckInService',
        {
          clinicId,
          count: appointments.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get checked-in appointments: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async processCheckIn(appointmentId: string, clinicId: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Validate appointment exists and belongs to clinic
      const appointment = await this.validateAppointmentForClinic(appointmentId, clinicId);

      // Process the check-in
      const result = await this.performCheckIn({
        appointmentId,
        userId: appointment.patientId,
        checkInMethod: 'qr',
        timestamp: new Date().toISOString(),
        locationId: appointment.locationId,
      });

      // Update appointment status
      await this.updateAppointmentStatus(appointmentId, 'CHECKED_IN');

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Check-in processed successfully',
        'CheckInService',
        { appointmentId, clinicId, responseTime: Date.now() - startTime }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to process check-in: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          appointmentId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getPatientQueuePosition(appointmentId: string, clinicId: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `queue:position:${appointmentId}:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get queue position from database (placeholder implementation)
      const queuePosition = await this.fetchQueuePosition(appointmentId, clinicId);

      if (!queuePosition) {
        throw new NotFoundException('Patient not found in queue');
      }

      const result = {
        appointmentId,
        clinicId,
        ...queuePosition,
        retrievedAt: new Date().toISOString(),
      };

      // Cache for a shorter time (queue positions change frequently)
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Patient queue position retrieved successfully',
        'CheckInService',
        {
          appointmentId,
          clinicId,
          position: queuePosition.position,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient queue position: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          appointmentId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async startConsultation(appointmentId: string, clinicId: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Validate appointment is checked in
      const checkIn = await this.getExistingCheckIn(appointmentId);
      if (!checkIn) {
        throw new BadRequestException(
          'Appointment must be checked in before starting consultation'
        );
      }

      // Start consultation
      const result = await this.performConsultationStart(appointmentId, clinicId);

      // Remove from queue
      await this.removeFromQueue(appointmentId, clinicId);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Consultation started successfully',
        'CheckInService',
        { appointmentId, clinicId, responseTime: Date.now() - startTime }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          appointmentId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getDoctorActiveQueue(doctorId: string, clinicId: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `queue:doctor:${doctorId}:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get active queue from database (placeholder implementation)
      const queue = await this.fetchDoctorActiveQueue(doctorId, clinicId);

      const result = {
        doctorId,
        clinicId,
        queue,
        total: queue.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Doctor active queue retrieved successfully',
        'CheckInService',
        {
          doctorId,
          clinicId,
          queueLength: queue.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor active queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          doctorId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async reorderQueue(clinicId: string, appointmentOrder: string[]): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Validate all appointments exist and are checked in
      await this.validateAppointmentOrder(appointmentOrder, clinicId);

      // Reorder queue in database (placeholder implementation)
      await this.performQueueReorder(clinicId, appointmentOrder);

      // Invalidate cache
      await this.cacheService.invalidateByPattern(`queue:doctor:*:${clinicId}`);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Queue reordered successfully',
        'CheckInService',
        {
          clinicId,
          orderLength: appointmentOrder.length,
          responseTime: Date.now() - startTime,
        }
      );

      return { success: true, message: 'Queue reordered successfully' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to reorder queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          clinicId,
          appointmentOrder,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getLocationQueue(clinicId: string): Promise<LocationQueueResponse> {
    const startTime = Date.now();
    const cacheKey = `queue:location:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as LocationQueueResponse;
      }

      // Get location queue from database (placeholder implementation)
      const queue = await this.fetchLocationQueue(clinicId);

      const result: LocationQueueResponse = {
        locationId: clinicId, // Using clinicId as locationId for now
        queue: queue as AppointmentQueuePosition[],
        total: queue.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location queue retrieved successfully',
        'CheckInService',
        {
          clinicId,
          queueLength: queue.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // Helper methods (placeholder implementations that would integrate with actual database)
  private validateAppointment(appointmentId: string, userId: string): Promise<CheckInAppointment> {
    // This would integrate with the actual appointment service
    // For now, return mock data
    return Promise.resolve({
      id: appointmentId,
      patientId: userId,
      doctorId: 'doc-1',
      locationId: 'loc-1',
      type: AppointmentType.IN_PERSON,
      status: AppointmentStatus.CONFIRMED,
      domain: 'healthcare',
    });
  }

  private validateAppointmentForClinic(
    appointmentId: string,
    _clinicId: string
  ): Promise<CheckInAppointment> {
    // This would integrate with the actual appointment service
    // For now, return mock data
    return Promise.resolve({
      id: appointmentId,
      patientId: 'patient-1',
      doctorId: 'doc-1',
      locationId: 'loc-1',
      type: AppointmentType.IN_PERSON,
      status: AppointmentStatus.CONFIRMED,
      domain: 'healthcare',
    });
  }

  private getExistingCheckIn(_appointmentId: string): Promise<CheckInResult | null> {
    // This would check if appointment is already checked in
    // For now, return null (not checked in)
    return Promise.resolve(null);
  }

  private performCheckIn(checkInData: CheckInData): Promise<CheckInResult> {
    // This would integrate with the actual database
    // For now, return mock result
    return Promise.resolve({
      success: true,
      appointmentId: checkInData.appointmentId,
      message: 'Check-in successful',
      checkedInAt: checkInData.timestamp,
    });
  }

  private addToQueue(
    appointmentId: string,
    doctorId: string,
    locationId: string,
    _domain: string
  ): Promise<AppointmentQueuePosition> {
    // This would integrate with the actual queue service
    // For now, return mock queue position
    return Promise.resolve({
      position: 1,
      totalInQueue: 5,
      estimatedWaitTime: 15,
      doctorId,
      locationId,
    });
  }

  private async updateAppointmentStatus(appointmentId: string, status: string): Promise<void> {
    // This would integrate with the actual appointment service
    // For now, just log
    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Updated appointment ${appointmentId} status to ${status}`,
      'CheckInService'
    );
  }

  private performConsultationStart(_appointmentId: string, _clinicId: string): Promise<unknown> {
    // This would integrate with the actual consultation service
    // For now, return mock result
    return Promise.resolve({
      success: true,
      appointmentId: _appointmentId,
      consultationStartedAt: new Date().toISOString(),
      message: 'Consultation started',
    });
  }

  private async removeFromQueue(appointmentId: string, clinicId: string): Promise<void> {
    // This would integrate with the actual queue service
    // For now, just log
    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Removed appointment ${appointmentId} from queue for clinic ${clinicId}`,
      'CheckInService'
    );
  }

  private fetchCheckedInAppointments(_clinicId: string): Promise<unknown[]> {
    // This would integrate with the actual database
    // For now, return mock data
    return Promise.resolve([
      {
        id: 'app-1',
        patientName: 'John Doe',
        doctorName: 'Dr. Smith',
        checkInTime: new Date().toISOString(),
        status: 'CHECKED_IN',
      },
    ]);
  }

  private fetchQueuePosition(
    _appointmentId: string,
    _clinicId: string
  ): Promise<AppointmentQueuePosition | null> {
    // This would integrate with the actual queue service
    // For now, return mock data
    return Promise.resolve({
      position: 2,
      totalInQueue: 5,
      estimatedWaitTime: 20,
      doctorId: 'doc-1',
      locationId: 'loc-1',
    });
  }

  private fetchDoctorActiveQueue(_doctorId: string, _clinicId: string): Promise<unknown[]> {
    // This would integrate with the actual queue service
    // For now, return mock data
    return Promise.resolve([
      {
        appointmentId: 'app-1',
        patientName: 'John Doe',
        position: 1,
        estimatedWaitTime: 10,
      },
    ]);
  }

  private async validateAppointmentOrder(
    appointmentOrder: string[],
    clinicId: string
  ): Promise<void> {
    // This would validate that all appointments exist and are checked in
    // For now, just log
    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Validating appointment order: ${appointmentOrder.join(', ')} for clinic ${clinicId}`,
      'CheckInService'
    );
  }

  private async performQueueReorder(clinicId: string, appointmentOrder: string[]): Promise<void> {
    // This would integrate with the actual queue service
    // For now, just log
    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Reordering queue for clinic ${clinicId}: ${appointmentOrder.join(', ')}`,
      'CheckInService'
    );
  }

  private fetchLocationQueue(_clinicId: string): Promise<unknown[]> {
    // This would integrate with the actual queue service
    // For now, return mock data
    return Promise.resolve([
      {
        appointmentId: 'app-1',
        patientName: 'John Doe',
        doctorName: 'Dr. Smith',
        position: 1,
        estimatedWaitTime: 10,
      },
    ]);
  }

  // =============================================
  // AYURVEDIC-SPECIFIC CHECK-IN METHODS
  // =============================================

  /**
   * Process Ayurvedic therapy check-in with location validation
   */
  async processAyurvedicCheckIn(
    appointmentId: string,
    clinicId: string,
    checkInData: CheckInData
  ): Promise<CheckInResult> {
    const startTime = Date.now();

    try {
      // Validate appointment exists and belongs to clinic
      const appointment = await this.validateAppointmentForClinic(appointmentId, clinicId);

      // Check if it's an Ayurvedic appointment type
      const ayurvedicTypes: string[] = [
        'VIDDHAKARMA',
        'AGNIKARMA',
        'PANCHAKARMA',
        'NADI_PARIKSHA',
        'DOSHA_ANALYSIS',
        'SHIRODHARA',
        'VIRECHANA',
        'ABHYANGA',
        'SWEDANA',
        'BASTI',
        'NASYA',
        'RAKTAMOKSHANA',
      ];

      if (!ayurvedicTypes.includes(appointment.type)) {
        throw new BadRequestException('This is not an Ayurvedic appointment');
      }

      // Validate location if coordinates provided
      if (checkInData.coordinates) {
        const isValidLocation = await this.validateAyurvedicLocation(
          checkInData.coordinates,
          checkInData.locationId,
          clinicId
        );

        if (!isValidLocation) {
          throw new BadRequestException(
            'Patient is not within the required radius of the therapy location'
          );
        }
      }

      // Process the check-in
      const result = await this.performCheckIn(checkInData);

      // Add to therapy-specific queue if needed
      if (appointment.domain === 'healthcare') {
        const queuePosition = await this.addToTherapyQueue(
          appointmentId,
          appointment.doctorId,
          appointment.locationId,
          appointment.type
        );
        result.queuePosition = queuePosition.position;
        result.estimatedWaitTime = queuePosition.estimatedWaitTime;
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Ayurvedic check-in successful',
        'CheckInService',
        {
          appointmentId,
          clinicId,
          therapyType: appointment.type,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to process Ayurvedic check-in: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          appointmentId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Get therapy-specific queue for Ayurvedic appointments
   */
  async getTherapyQueue(therapyType: string, clinicId: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `therapy-queue:${therapyType}:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get therapy queue from database (placeholder implementation)
      const queue = await this.fetchTherapyQueue(therapyType, clinicId);

      const result = {
        therapyType,
        clinicId,
        queue,
        total: queue.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Therapy queue retrieved successfully',
        'CheckInService',
        {
          therapyType,
          clinicId,
          queueLength: queue.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get therapy queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          therapyType,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Validate Ayurvedic therapy location
   */
  private validateAyurvedicLocation(
    _patientCoords: { lat: number; lng: number },
    _locationId: string,
    _clinicId: string
  ): Promise<boolean> {
    // This would integrate with the actual location service
    // For now, return mock validation
    return Promise.resolve(true);
  }

  /**
   * Add to therapy-specific queue
   */
  private addToTherapyQueue(
    appointmentId: string,
    doctorId: string,
    locationId: string,
    _therapyType: string
  ): Promise<AppointmentQueuePosition> {
    // This would integrate with the actual therapy queue service
    // For now, return mock queue position
    return Promise.resolve({
      position: 1,
      totalInQueue: 3,
      estimatedWaitTime: 20,
      doctorId,
      locationId,
    });
  }

  /**
   * Fetch therapy-specific queue
   */
  private fetchTherapyQueue(therapyType: string, _clinicId: string): Promise<unknown[]> {
    // This would integrate with the actual therapy queue service
    // For now, return mock data
    return Promise.resolve([
      {
        appointmentId: 'app-1',
        patientName: 'John Doe',
        therapyType,
        position: 1,
        estimatedWaitTime: 15,
      },
    ]);
  }

  /**
   * Verify check-in
   */
  verifyCheckIn(
    checkInId: string,
    verifiedBy: string
  ): Promise<{
    success: boolean;
    checkInId: string;
    verifiedBy: string;
    verifiedAt: string;
    message: string;
  }> {
    const startTime = Date.now();

    try {
      // This would implement check-in verification logic
      // For now, return a placeholder response
      const result = {
        success: true,
        checkInId,
        verifiedBy,
        verifiedAt: new Date().toISOString(),
        message: 'Check-in verified successfully',
      };

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Check-in verified successfully',
        'CheckInService',
        {
          checkInId,
          verifiedBy,
          responseTime: Date.now() - startTime,
        }
      );

      return Promise.resolve(result);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to verify check-in: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          checkInId,
          verifiedBy,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Get health status of the service
   */
  async getHealthStatus(): Promise<{ status: string; message?: string }> {
    try {
      // Check if we can connect to cache service
      await this.cacheService.get('health-check');

      return {
        status: 'healthy',
        message: 'CheckInService is operational',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `CheckInService health check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
