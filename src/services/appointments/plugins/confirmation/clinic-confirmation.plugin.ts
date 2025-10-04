import { Injectable } from "@nestjs/common";
import { BaseAppointmentPlugin } from "../base/base-plugin.service";
import { AppointmentConfirmationService } from "./appointment-confirmation.service";

@Injectable()
export class ClinicConfirmationPlugin extends BaseAppointmentPlugin {
  readonly name = "clinic-confirmation-plugin";
  readonly version = "1.0.0";
  readonly features = [
    "qr-generation",
    "check-in",
    "confirmation",
    "completion",
  ];

  constructor(
    private readonly confirmationService: AppointmentConfirmationService,
  ) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    this.logPluginAction("Processing clinic confirmation operation", {
      operation: pluginData.operation,
    });

    // Delegate to existing confirmation service - no functionality change
    switch (pluginData.operation) {
      case "generateCheckInQR":
        return await this.confirmationService.generateCheckInQR(
          pluginData.appointmentId,
          "clinic",
        );

      case "processCheckIn":
        return await this.confirmationService.processCheckIn(
          pluginData.qrData,
          pluginData.appointmentId,
          "clinic",
        );

      case "confirmAppointment":
        return await this.confirmationService.confirmAppointment(
          pluginData.appointmentId,
          "clinic",
        );

      case "markAppointmentCompleted":
        return await this.confirmationService.markAppointmentCompleted(
          pluginData.appointmentId,
          pluginData.doctorId,
          "clinic",
        );

      case "generateConfirmationQR":
        return await this.confirmationService.generateConfirmationQR(
          pluginData.appointmentId,
          "clinic",
        );

      case "verifyAppointmentQR":
        return await this.confirmationService.verifyAppointmentQR(
          pluginData.qrData,
          pluginData.clinicId,
          "clinic",
        );

      case "invalidateQRCache":
        return await this.confirmationService.invalidateQRCache(
          pluginData.appointmentId,
        );

      default:
        this.logPluginError("Unknown confirmation operation", {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown confirmation operation: ${pluginData.operation}`);
    }
  }

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    // Validate that required fields are present for each operation
    const requiredFields = {
      generateCheckInQR: ["appointmentId"],
      processCheckIn: ["qrData", "appointmentId"],
      confirmAppointment: ["appointmentId"],
      markAppointmentCompleted: ["appointmentId", "doctorId"],
      generateConfirmationQR: ["appointmentId"],
      verifyAppointmentQR: ["qrData", "clinicId"],
      invalidateQRCache: ["appointmentId"],
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
