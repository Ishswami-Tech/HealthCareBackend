import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { CacheService } from "../../../../libs/infrastructure/cache";
import { LoggingService } from "../../../../libs/infrastructure/logging/logging.service";
import { LogType, LogLevel } from "../../../../libs/infrastructure/logging";

export interface CheckInData {
  appointmentId: string;
  userId: string;
  biometricData?: {
    fingerprint?: string;
    faceId?: string;
    voicePrint?: string;
  };
  checkInMethod: "qr" | "biometric" | "manual";
  timestamp: string;
  locationId: string;
}

export interface CheckInResult {
  success: boolean;
  appointmentId: string;
  queuePosition?: number;
  estimatedWaitTime?: number;
  message: string;
  checkedInAt: string;
}

export interface QueuePosition {
  position: number;
  totalInQueue: number;
  estimatedWaitTime: number;
  doctorId: string;
  locationId: string;
}

@Injectable()
export class CheckInService {
  private readonly logger = new Logger(CheckInService.name);
  private readonly CHECKIN_CACHE_TTL = 1800; // 30 minutes
  private readonly QUEUE_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {}

  async checkIn(appointmentId: string, userId: string): Promise<any> {
    const startTime = Date.now();

    try {
      // Validate appointment exists and belongs to user
      const appointment = await this.validateAppointment(appointmentId, userId);

      // Check if already checked in
      const existingCheckIn = await this.getExistingCheckIn(appointmentId);
      if (existingCheckIn) {
        throw new BadRequestException("Appointment already checked in");
      }

      // Perform check-in
      const checkInData: CheckInData = {
        appointmentId,
        userId,
        checkInMethod: "manual",
        timestamp: new Date().toISOString(),
        locationId: appointment.locationId,
      };

      const result = await this.performCheckIn(checkInData);

      // Add to queue if needed
      if (appointment.domain === "healthcare") {
        const queuePosition = await this.addToQueue(
          appointmentId,
          appointment.doctorId,
          appointment.locationId,
          appointment.domain,
        );
        result.queuePosition = queuePosition.position;
        result.estimatedWaitTime = queuePosition.estimatedWaitTime;
      }

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Check-in successful",
        "CheckInService",
        { appointmentId, userId, responseTime: Date.now() - startTime },
      );

      return result;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to check in: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInService",
        {
          appointmentId,
          userId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async getCheckedInAppointments(clinicId: string): Promise<any> {
    const startTime = Date.now();
    const cacheKey = `checkins:clinic:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get checked-in appointments from database (placeholder implementation)
      const appointments = await this.fetchCheckedInAppointments(clinicId);

      const result = {
        appointments,
        clinicId,
        total: appointments.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(result),
        this.CHECKIN_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Checked-in appointments retrieved successfully",
        "CheckInService",
        {
          clinicId,
          count: appointments.length,
          responseTime: Date.now() - startTime,
        },
      );

      return result;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get checked-in appointments: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInService",
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async processCheckIn(appointmentId: string, clinicId: string): Promise<any> {
    const startTime = Date.now();

    try {
      // Validate appointment exists and belongs to clinic
      const appointment = await this.validateAppointmentForClinic(
        appointmentId,
        clinicId,
      );

      // Process the check-in
      const result = await this.performCheckIn({
        appointmentId,
        userId: appointment.patientId,
        checkInMethod: "qr",
        timestamp: new Date().toISOString(),
        locationId: appointment.locationId,
      });

      // Update appointment status
      await this.updateAppointmentStatus(appointmentId, "CHECKED_IN");

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Check-in processed successfully",
        "CheckInService",
        { appointmentId, clinicId, responseTime: Date.now() - startTime },
      );

      return result;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to process check-in: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInService",
        {
          appointmentId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async getPatientQueuePosition(
    appointmentId: string,
    clinicId: string,
  ): Promise<any> {
    const startTime = Date.now();
    const cacheKey = `queue:position:${appointmentId}:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get queue position from database (placeholder implementation)
      const queuePosition = await this.fetchQueuePosition(
        appointmentId,
        clinicId,
      );

      if (!queuePosition) {
        throw new NotFoundException("Patient not found in queue");
      }

      const result = {
        appointmentId,
        clinicId,
        ...queuePosition,
        retrievedAt: new Date().toISOString(),
      };

      // Cache for a shorter time (queue positions change frequently)
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(result),
        this.QUEUE_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Patient queue position retrieved successfully",
        "CheckInService",
        {
          appointmentId,
          clinicId,
          position: queuePosition.position,
          responseTime: Date.now() - startTime,
        },
      );

      return result;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient queue position: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInService",
        {
          appointmentId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async startConsultation(
    appointmentId: string,
    clinicId: string,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      // Validate appointment is checked in
      const checkIn = await this.getExistingCheckIn(appointmentId);
      if (!checkIn) {
        throw new BadRequestException(
          "Appointment must be checked in before starting consultation",
        );
      }

      // Start consultation
      const result = await this.performConsultationStart(
        appointmentId,
        clinicId,
      );

      // Remove from queue
      await this.removeFromQueue(appointmentId, clinicId);

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Consultation started successfully",
        "CheckInService",
        { appointmentId, clinicId, responseTime: Date.now() - startTime },
      );

      return result;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInService",
        {
          appointmentId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async getDoctorActiveQueue(doctorId: string, clinicId: string): Promise<any> {
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
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(result),
        this.QUEUE_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Doctor active queue retrieved successfully",
        "CheckInService",
        {
          doctorId,
          clinicId,
          queueLength: queue.length,
          responseTime: Date.now() - startTime,
        },
      );

      return result;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor active queue: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInService",
        {
          doctorId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async reorderQueue(
    clinicId: string,
    appointmentOrder: string[],
  ): Promise<any> {
    const startTime = Date.now();

    try {
      // Validate all appointments exist and are checked in
      await this.validateAppointmentOrder(appointmentOrder, clinicId);

      // Reorder queue in database (placeholder implementation)
      await this.performQueueReorder(clinicId, appointmentOrder);

      // Invalidate cache
      await this.cacheService.invalidateByPattern(`queue:doctor:*:${clinicId}`);

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Queue reordered successfully",
        "CheckInService",
        {
          clinicId,
          orderLength: appointmentOrder.length,
          responseTime: Date.now() - startTime,
        },
      );

      return { success: true, message: "Queue reordered successfully" };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to reorder queue: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInService",
        {
          clinicId,
          appointmentOrder,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async getLocationQueue(clinicId: string): Promise<any> {
    const startTime = Date.now();
    const cacheKey = `queue:location:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get location queue from database (placeholder implementation)
      const queue = await this.fetchLocationQueue(clinicId);

      const result = {
        clinicId,
        queue,
        total: queue.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(result),
        this.QUEUE_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Location queue retrieved successfully",
        "CheckInService",
        {
          clinicId,
          queueLength: queue.length,
          responseTime: Date.now() - startTime,
        },
      );

      return result;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location queue: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInService",
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  // Helper methods (placeholder implementations that would integrate with actual database)
  private async validateAppointment(
    appointmentId: string,
    userId: string,
  ): Promise<any> {
    // This would integrate with the actual appointment service
    // For now, return mock data
    return {
      id: appointmentId,
      patientId: userId,
      doctorId: "doc-1",
      locationId: "loc-1",
      domain: "healthcare",
      status: "CONFIRMED",
    };
  }

  private async validateAppointmentForClinic(
    appointmentId: string,
    clinicId: string,
  ): Promise<any> {
    // This would integrate with the actual appointment service
    // For now, return mock data
    return {
      id: appointmentId,
      patientId: "patient-1",
      doctorId: "doc-1",
      locationId: "loc-1",
      domain: "healthcare",
      status: "CONFIRMED",
    };
  }

  private async getExistingCheckIn(appointmentId: string): Promise<any> {
    // This would check if appointment is already checked in
    // For now, return null (not checked in)
    return null;
  }

  private async performCheckIn(
    checkInData: CheckInData,
  ): Promise<CheckInResult> {
    // This would integrate with the actual database
    // For now, return mock result
    return {
      success: true,
      appointmentId: checkInData.appointmentId,
      message: "Check-in successful",
      checkedInAt: checkInData.timestamp,
    };
  }

  private async addToQueue(
    appointmentId: string,
    doctorId: string,
    locationId: string,
    domain: string,
  ): Promise<QueuePosition> {
    // This would integrate with the actual queue service
    // For now, return mock queue position
    return {
      position: 1,
      totalInQueue: 5,
      estimatedWaitTime: 15,
      doctorId,
      locationId,
    };
  }

  private async updateAppointmentStatus(
    appointmentId: string,
    status: string,
  ): Promise<void> {
    // This would integrate with the actual appointment service
    // For now, just log
    this.logger.log(`Updated appointment ${appointmentId} status to ${status}`);
  }

  private async performConsultationStart(
    appointmentId: string,
    clinicId: string,
  ): Promise<any> {
    // This would integrate with the actual consultation service
    // For now, return mock result
    return {
      success: true,
      appointmentId,
      consultationStartedAt: new Date().toISOString(),
      message: "Consultation started",
    };
  }

  private async removeFromQueue(
    appointmentId: string,
    clinicId: string,
  ): Promise<void> {
    // This would integrate with the actual queue service
    // For now, just log
    this.logger.log(
      `Removed appointment ${appointmentId} from queue for clinic ${clinicId}`,
    );
  }

  private async fetchCheckedInAppointments(clinicId: string): Promise<any[]> {
    // This would integrate with the actual database
    // For now, return mock data
    return [
      {
        id: "app-1",
        patientName: "John Doe",
        doctorName: "Dr. Smith",
        checkInTime: new Date().toISOString(),
        status: "CHECKED_IN",
      },
    ];
  }

  private async fetchQueuePosition(
    appointmentId: string,
    clinicId: string,
  ): Promise<QueuePosition | null> {
    // This would integrate with the actual queue service
    // For now, return mock data
    return {
      position: 2,
      totalInQueue: 5,
      estimatedWaitTime: 20,
      doctorId: "doc-1",
      locationId: "loc-1",
    };
  }

  private async fetchDoctorActiveQueue(
    doctorId: string,
    clinicId: string,
  ): Promise<any[]> {
    // This would integrate with the actual queue service
    // For now, return mock data
    return [
      {
        appointmentId: "app-1",
        patientName: "John Doe",
        position: 1,
        estimatedWaitTime: 10,
      },
    ];
  }

  private async validateAppointmentOrder(
    appointmentOrder: string[],
    clinicId: string,
  ): Promise<void> {
    // This would validate that all appointments exist and are checked in
    // For now, just log
    this.logger.log(
      `Validating appointment order: ${appointmentOrder.join(", ")} for clinic ${clinicId}`,
    );
  }

  private async performQueueReorder(
    clinicId: string,
    appointmentOrder: string[],
  ): Promise<void> {
    // This would integrate with the actual queue service
    // For now, just log
    this.logger.log(
      `Reordering queue for clinic ${clinicId}: ${appointmentOrder.join(", ")}`,
    );
  }

  private async fetchLocationQueue(clinicId: string): Promise<any[]> {
    // This would integrate with the actual queue service
    // For now, return mock data
    return [
      {
        appointmentId: "app-1",
        patientName: "John Doe",
        doctorName: "Dr. Smith",
        position: 1,
        estimatedWaitTime: 10,
      },
    ];
  }
}
