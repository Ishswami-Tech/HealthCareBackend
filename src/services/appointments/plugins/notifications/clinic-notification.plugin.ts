import { Injectable } from "@nestjs/common";
import { BaseAppointmentPlugin } from "../base/base-plugin.service";
import { AppointmentNotificationService } from "./appointment-notification.service";

@Injectable()
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
export class ClinicNotificationPlugin extends BaseAppointmentPlugin {
  readonly name = "clinic-notification-plugin";
  readonly version = "1.0.0";
  readonly features = [
    "notification-scheduling",
    "multi-channel-notifications",
    "notification-templates",
    "notification-analytics",
  ];

  constructor(
    private readonly notificationService: AppointmentNotificationService,
  ) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    this.logPluginAction("Processing clinic notification operation", {
      operation: pluginData.operation,
    });

    switch (pluginData.operation) {
      case "sendNotification":
        return await this.notificationService.sendNotification(
          pluginData.notificationData,
        );

      case "scheduleNotification":
        return await this.notificationService.scheduleNotification(
          pluginData.notificationData,
          pluginData.scheduledFor,
        );

      case "sendReminderNotifications":
        return await this.notificationService.sendReminderNotifications(
          pluginData.clinicId,
          pluginData.hoursBefore,
        );

      case "getNotificationTemplates":
        return await this.notificationService.getNotificationTemplates(
          pluginData.clinicId,
          pluginData.type,
        );

      case "sendAppointmentConfirmation":
        return await this.sendAppointmentConfirmation(data);

      case "sendAppointmentCancellation":
        return await this.sendAppointmentCancellation(data);

      case "sendAppointmentReschedule":
        return await this.sendAppointmentReschedule(data);

      default:
        this.logPluginError("Unknown notification operation", {
          operation: pluginData.operation,
        });
        throw new Error(
          `Unknown notification operation: ${pluginData.operation}`,
        );
    }
  }

  validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    const requiredFields = {
      sendNotification: ["notificationData"],
      scheduleNotification: ["notificationData", "scheduledFor"],
      sendReminderNotifications: ["clinicId"],
      getNotificationTemplates: ["clinicId"],
      sendAppointmentConfirmation: [
        "appointmentId",
        "patientId",
        "doctorId",
        "clinicId",
      ],
      sendAppointmentCancellation: [
        "appointmentId",
        "patientId",
        "doctorId",
        "clinicId",
      ],
      sendAppointmentReschedule: [
        "appointmentId",
        "patientId",
        "doctorId",
        "clinicId",
      ],
    };

    const operation = pluginData.operation;
    const required = requiredFields[operation as keyof typeof requiredFields];

    if (!required) {
      this.logPluginError("Unknown operation for validation", { operation });
      return Promise.resolve(false);
    }

    for (const field of required) {
      if (!pluginData[field]) {
        this.logPluginError(`Missing required field: ${field}`, {
          operation,
          field,
        });
        return Promise.resolve(false);
      }
    }

    return Promise.resolve(true);
  }

  /**
   * Send appointment confirmation notification
   */
  private async sendAppointmentConfirmation(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const notificationData = {
      appointmentId: pluginData.appointmentId,
      patientId: pluginData.patientId,
      doctorId: pluginData.doctorId,
      clinicId: pluginData.clinicId,
      type: "confirmation" as const,
      priority: (pluginData.priority || "normal") as
        | "low"
        | "normal"
        | "high"
        | "urgent",
      channels: (pluginData.channels || ["email", "whatsapp", "push"]) as (
        | "email"
        | "sms"
        | "whatsapp"
        | "push"
        | "socket"
      )[],
      templateData: {
        patientName: pluginData.patientName || "Patient",
        doctorName: pluginData.doctorName || "Doctor",
        appointmentDate:
          pluginData.appointmentDate || new Date().toISOString().split("T")[0],
        appointmentTime: pluginData.appointmentTime || "10:00",
        location: pluginData.location || "Clinic",
        clinicName: pluginData.clinicName || "Healthcare Clinic",
        appointmentType: pluginData.appointmentType,
        notes: pluginData.notes,
      },
    };

    return await this.notificationService.sendNotification(notificationData);
  }

  /**
   * Send appointment cancellation notification
   */
  private async sendAppointmentCancellation(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const notificationData = {
      appointmentId: pluginData.appointmentId,
      patientId: pluginData.patientId,
      doctorId: pluginData.doctorId,
      clinicId: pluginData.clinicId,
      type: "cancellation" as const,
      priority: (pluginData.priority || "high") as
        | "low"
        | "normal"
        | "high"
        | "urgent",
      channels: (pluginData.channels || [
        "email",
        "whatsapp",
        "push",
        "socket",
      ]) as ("email" | "sms" | "whatsapp" | "push" | "socket")[],
      templateData: {
        patientName: pluginData.patientName || "Patient",
        doctorName: pluginData.doctorName || "Doctor",
        appointmentDate:
          pluginData.appointmentDate || new Date().toISOString().split("T")[0],
        appointmentTime: pluginData.appointmentTime || "10:00",
        location: pluginData.location || "Clinic",
        clinicName: pluginData.clinicName || "Healthcare Clinic",
        appointmentType: pluginData.appointmentType,
        notes: pluginData.notes,
      },
    };

    return await this.notificationService.sendNotification(notificationData);
  }

  /**
   * Send appointment reschedule notification
   */
  private async sendAppointmentReschedule(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const notificationData = {
      appointmentId: pluginData.appointmentId,
      patientId: pluginData.patientId,
      doctorId: pluginData.doctorId,
      clinicId: pluginData.clinicId,
      type: "reschedule" as const,
      priority: (pluginData.priority || "normal") as
        | "low"
        | "normal"
        | "high"
        | "urgent",
      channels: (pluginData.channels || ["email", "whatsapp", "push"]) as (
        | "email"
        | "sms"
        | "whatsapp"
        | "push"
        | "socket"
      )[],
      templateData: {
        patientName: pluginData.patientName || "Patient",
        doctorName: pluginData.doctorName || "Doctor",
        appointmentDate:
          pluginData.appointmentDate || new Date().toISOString().split("T")[0],
        appointmentTime: pluginData.appointmentTime || "10:00",
        location: pluginData.location || "Clinic",
        clinicName: pluginData.clinicName || "Healthcare Clinic",
        appointmentType: pluginData.appointmentType,
        notes: pluginData.notes,
        rescheduleUrl: pluginData.rescheduleUrl,
      },
    };

    return await this.notificationService.sendNotification(notificationData);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
