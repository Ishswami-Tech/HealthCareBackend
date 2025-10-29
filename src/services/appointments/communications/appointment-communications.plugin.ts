/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { Injectable } from "@nestjs/common";
import { BaseAppointmentPlugin } from "../plugins/base/base-plugin.service";
import { AppointmentCommunicationsService } from "./appointment-communications.service";

@Injectable()
export class AppointmentCommunicationsPlugin extends BaseAppointmentPlugin {
  readonly name = "appointment-communications-plugin";
  readonly version = "1.0.0";
  readonly features = [
    "real-time-updates",
    "queue-notifications",
    "appointment-status",
    "video-calls",
    "notifications",
  ];

  constructor(
    private readonly communicationsService: AppointmentCommunicationsService,
  ) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    this.logPluginAction("Processing appointment communications operation", {
      operation: pluginData.operation,
    });

    // Delegate to communications service - proper separation of concerns
    switch (pluginData.operation) {
      case "sendQueueUpdate":
        return await this.communicationsService.sendQueueUpdate(
          pluginData.clinicId,
          pluginData.doctorId,
          pluginData.queueData,
        );

      case "sendAppointmentStatusUpdate":
        return await this.communicationsService.sendAppointmentStatusUpdate(
          pluginData.appointmentId,
          pluginData.clinicId,
          pluginData.userId,
          pluginData.statusData,
        );

      case "sendVideoCallNotification":
        return await this.communicationsService.sendVideoCallNotification(
          pluginData.appointmentId,
          pluginData.clinicId,
          pluginData.patientId,
          pluginData.doctorId,
          pluginData.callData,
        );

      case "sendNotification":
        return await this.communicationsService.sendNotification(
          pluginData.userId,
          pluginData.clinicId,
          pluginData.notificationData,
        );

      case "getActiveConnections":
        return await this.communicationsService.getActiveConnections(
          pluginData.clinicId,
        );

      case "joinAppointmentRoom":
        return await this.communicationsService.joinAppointmentRoom(
          pluginData.userId,
          pluginData.appointmentId,
          pluginData.clinicId,
        );

      case "leaveAppointmentRoom":
        return await this.communicationsService.leaveAppointmentRoom(
          pluginData.userId,
          pluginData.appointmentId,
        );

      default:
        this.logPluginError("Unknown communications operation", {
          operation: pluginData.operation,
        });
        throw new Error(
          `Unknown communications operation: ${pluginData.operation}`,
        );
    }
  }

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    // Validate that required fields are present for each operation
    const requiredFields = {
      sendQueueUpdate: ["clinicId", "doctorId", "queueData"],
      sendAppointmentStatusUpdate: [
        "appointmentId",
        "clinicId",
        "userId",
        "statusData",
      ],
      sendVideoCallNotification: [
        "appointmentId",
        "clinicId",
        "patientId",
        "doctorId",
        "callData",
      ],
      sendNotification: ["userId", "clinicId", "notificationData"],
      getActiveConnections: ["clinicId"],
      joinAppointmentRoom: ["userId", "appointmentId", "clinicId"],
      leaveAppointmentRoom: ["userId", "appointmentId"],
    };

    const operation = pluginData.operation;
    const fields = (requiredFields as any)[operation];

    if (!fields) {
      this.logPluginError("Invalid operation", { operation });
      return false;
    }

    const isValid = fields.every(
      (field: unknown) => pluginData[field as string] !== undefined,
    );
    if (!isValid) {
      this.logPluginError("Missing required fields", {
        operation,
        requiredFields: fields,
      });
    }

    return isValid;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
