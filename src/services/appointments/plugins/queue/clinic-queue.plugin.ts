import { Injectable } from "@nestjs/common";
import { BaseAppointmentPlugin } from "../base/base-plugin.service";
import { AppointmentQueueService } from "./appointment-queue.service";

@Injectable()
export class ClinicQueuePlugin extends BaseAppointmentPlugin {
  readonly name = "clinic-queue-plugin";
  readonly version = "1.0.0";
  readonly features = [
    "queue-management",
    "priority-queues",
    "emergency-handling",
  ];

  constructor(private readonly queueService: AppointmentQueueService) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    this.logPluginAction("Processing clinic queue operation", {
      operation: pluginData.operation,
    });

    // Delegate to existing queue service - no functionality change
    switch (pluginData.operation) {
      case "getDoctorQueue":
        return await this.queueService.getDoctorQueue(
          pluginData.doctorId,
          pluginData.date,
          "clinic",
        );

      case "getPatientQueuePosition":
        return await this.queueService.getPatientQueuePosition(
          pluginData.appointmentId,
          "clinic",
        );

      case "confirmAppointment":
        return await this.queueService.confirmAppointment(
          pluginData.appointmentId,
          "clinic",
        );

      case "startConsultation":
        return await this.queueService.startConsultation(
          pluginData.appointmentId,
          pluginData.doctorId,
          "clinic",
        );

      case "reorderQueue":
        return await this.queueService.reorderQueue(pluginData.reorderData, "clinic");

      case "getLocationQueueStats":
        return await this.queueService.getLocationQueueStats(
          pluginData.locationId,
          "clinic",
        );

      case "getQueueMetrics":
        return await this.queueService.getQueueMetrics(
          pluginData.locationId,
          "clinic",
          pluginData.period,
        );

      case "handleEmergencyAppointment":
        return await this.queueService.handleEmergencyAppointment(
          pluginData.appointmentId,
          pluginData.priority,
          "clinic",
        );

      default:
        this.logPluginError("Unknown queue operation", {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown queue operation: ${pluginData.operation}`);
    }
  }

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    // Validate that required fields are present for each operation
    const requiredFields = {
      getDoctorQueue: ["doctorId", "date"],
      getPatientQueuePosition: ["appointmentId"],
      confirmAppointment: ["appointmentId"],
      startConsultation: ["appointmentId", "doctorId"],
      reorderQueue: ["reorderData"],
      getLocationQueueStats: ["locationId"],
      getQueueMetrics: ["locationId", "period"],
      handleEmergencyAppointment: ["appointmentId", "priority"],
    };

    const operation = pluginData.operation;
    const fields = (requiredFields as any)[operation];

    if (!fields) {
      this.logPluginError("Invalid operation", { operation });
      return false;
    }

    const isValid = fields.every((field: unknown) => pluginData[(field as string)] !== undefined);
    if (!isValid) {
      this.logPluginError("Missing required fields", {
        operation,
        requiredFields: fields,
      });
    }

    return isValid;
  }
}
