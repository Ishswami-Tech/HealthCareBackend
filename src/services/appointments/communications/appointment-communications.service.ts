import { Injectable, Logger } from "@nestjs/common";
import {
  SocketService,
  SocketEventData,
} from "../../../libs/communication/socket/socket.service";
import { CacheService } from "../../../libs/infrastructure/cache/cache.service";
import { LoggingService } from "../../../libs/infrastructure/logging/logging.service";
import {
  LogType,
  LogLevel,
} from "../../../libs/infrastructure/logging/types/logging.types";

export interface AppointmentSocketMessage extends SocketEventData {
  type: "queue_update" | "appointment_status" | "video_call" | "notification";
  appointmentId: string;
  clinicId: string;
  userId: string;
  data: any;
  timestamp: string;
}

export interface QueueUpdateMessage {
  appointmentId: string;
  position: number;
  estimatedWaitTime: number;
  status: "waiting" | "in_progress" | "completed";
}

export interface AppointmentStatusMessage {
  appointmentId: string;
  status:
    | "scheduled"
    | "confirmed"
    | "checked_in"
    | "in_progress"
    | "completed"
    | "cancelled";
  message?: string;
}

@Injectable()
export class AppointmentCommunicationsService {
  private readonly logger = new Logger(AppointmentCommunicationsService.name);
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly socketService: SocketService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Send queue update to clinic room
   */
  async sendQueueUpdate(
    clinicId: string,
    doctorId: string,
    queueData: QueueUpdateMessage,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const roomId = `clinic:${clinicId}:queue:${doctorId}`;
      const message: AppointmentSocketMessage = {
        type: "queue_update",
        appointmentId: queueData.appointmentId,
        clinicId,
        userId: "", // Will be filled by client
        data: queueData,
        timestamp: new Date().toISOString(),
      };

      // Send to realtime gateway
      this.socketService.sendToRoom(roomId, "queue_update", message);

      // Cache the update
      const cacheKey = `queue:update:${clinicId}:${doctorId}:${queueData.appointmentId}`;
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(message),
        this.CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Queue update sent successfully",
        "AppointmentCommunicationsService",
        {
          clinicId,
          doctorId,
          appointmentId: queueData.appointmentId,
          responseTime: Date.now() - startTime,
        },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send queue update: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentCommunicationsService",
        {
          clinicId,
          doctorId,
          queueData,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Send appointment status update to user
   */
  async sendAppointmentStatusUpdate(
    appointmentId: string,
    clinicId: string,
    userId: string,
    statusData: AppointmentStatusMessage,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const message: AppointmentSocketMessage = {
        type: "appointment_status",
        appointmentId,
        clinicId,
        userId,
        data: statusData,
        timestamp: new Date().toISOString(),
      };

      // Send to user's personal room
      const userRoomId = `user:${userId}:appointments`;
      this.socketService.sendToRoom(userRoomId, "appointment_status", message);

      // Also send to clinic room for admin visibility
      const clinicRoomId = `clinic:${clinicId}:appointments`;
      this.socketService.sendToRoom(
        clinicRoomId,
        "appointment_status",
        message,
      );

      // Cache the status update
      const cacheKey = `appointment:status:${appointmentId}`;
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(message),
        this.CACHE_TTL,
      );

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Appointment status update sent successfully",
        "AppointmentCommunicationsService",
        {
          appointmentId,
          clinicId,
          userId,
          status: statusData.status,
          responseTime: Date.now() - startTime,
        },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send appointment status update: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentCommunicationsService",
        {
          appointmentId,
          clinicId,
          userId,
          statusData,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Send video call notification
   */
  async sendVideoCallNotification(
    appointmentId: string,
    clinicId: string,
    patientId: string,
    doctorId: string,
    callData: any,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const message: AppointmentSocketMessage = {
        type: "video_call",
        appointmentId,
        clinicId,
        userId: patientId,
        data: {
          ...callData,
          doctorId,
          patientId,
        },
        timestamp: new Date().toISOString(),
      };

      // Send to both patient and doctor
      const patientRoomId = `user:${patientId}:video_calls`;
      const doctorRoomId = `user:${doctorId}:video_calls`;

      this.socketService.sendToRoom(
        patientRoomId,
        "video_call_notification",
        message,
      );
      this.socketService.sendToRoom(
        doctorRoomId,
        "video_call_notification",
        message,
      );

      // Cache the notification
      const cacheKey = `video_call:${appointmentId}`;
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(message),
        this.CACHE_TTL,
      );

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Video call notification sent successfully",
        "AppointmentCommunicationsService",
        {
          appointmentId,
          clinicId,
          patientId,
          doctorId,
          responseTime: Date.now() - startTime,
        },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send video call notification: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentCommunicationsService",
        {
          appointmentId,
          clinicId,
          patientId,
          doctorId,
          callData,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Send general notification to user
   */
  async sendNotification(
    userId: string,
    clinicId: string,
    notificationData: {
      title: string;
      message: string;
      type: "info" | "warning" | "success" | "error";
      appointmentId?: string;
    },
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const message: AppointmentSocketMessage = {
        type: "notification",
        appointmentId: notificationData.appointmentId || "",
        clinicId,
        userId,
        data: notificationData,
        timestamp: new Date().toISOString(),
      };

      // Send to user's notification room
      const userRoomId = `user:${userId}:notifications`;
      this.socketService.sendToRoom(userRoomId, "notification", message);

      // Cache the notification
      const cacheKey = `notification:${userId}:${Date.now()}`;
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(message),
        this.CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Notification sent successfully",
        "AppointmentCommunicationsService",
        {
          userId,
          clinicId,
          type: notificationData.type,
          responseTime: Date.now() - startTime,
        },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send notification: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentCommunicationsService",
        {
          userId,
          clinicId,
          notificationData,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get active connections for a clinic
   */
  async getActiveConnections(clinicId: string): Promise<any> {
    const startTime = Date.now();
    const cacheKey = `connections:clinic:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // This would integrate with the actual socket service to get real connections
      // For now, return mock data
      const connections = {
        clinicId,
        totalConnections: 0,
        connectionsByType: {
          patients: 0,
          doctors: 0,
          admins: 0,
        },
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(connections),
        this.CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Active connections retrieved successfully",
        "AppointmentCommunicationsService",
        { clinicId, responseTime: Date.now() - startTime },
      );

      return connections;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get active connections: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentCommunicationsService",
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Join user to appointment room
   */
  async joinAppointmentRoom(
    userId: string,
    appointmentId: string,
    clinicId: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const roomId = `appointment:${appointmentId}`;

      // This would integrate with the actual socket service
      // For now, just log the action
      this.logger.log(`User ${userId} joining appointment room ${roomId}`);

      // Cache the room membership
      const cacheKey = `room:${roomId}:members`;
      const members = await this.cacheService.get(cacheKey);
      const memberList = members ? JSON.parse(members as string) : [];

      if (!memberList.includes(userId)) {
        memberList.push(userId);
        await this.cacheService.set(
          cacheKey,
          JSON.stringify(memberList),
          this.CACHE_TTL,
        );
      }

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "User joined appointment room successfully",
        "AppointmentCommunicationsService",
        {
          userId,
          appointmentId,
          clinicId,
          roomId,
          responseTime: Date.now() - startTime,
        },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to join appointment room: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentCommunicationsService",
        {
          userId,
          appointmentId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Leave appointment room
   */
  async leaveAppointmentRoom(
    userId: string,
    appointmentId: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const roomId = `appointment:${appointmentId}`;

      // This would integrate with the actual socket service
      // For now, just log the action
      this.logger.log(`User ${userId} leaving appointment room ${roomId}`);

      // Update room membership cache
      const cacheKey = `room:${roomId}:members`;
      const members = await this.cacheService.get(cacheKey);
      if (members) {
        const memberList = JSON.parse(members as string);
        const updatedList = memberList.filter((id: string) => id !== userId);
        await this.cacheService.set(
          cacheKey,
          JSON.stringify(updatedList),
          this.CACHE_TTL,
        );
      }

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "User left appointment room successfully",
        "AppointmentCommunicationsService",
        { userId, appointmentId, roomId, responseTime: Date.now() - startTime },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to leave appointment room: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentCommunicationsService",
        {
          userId,
          appointmentId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }
}
