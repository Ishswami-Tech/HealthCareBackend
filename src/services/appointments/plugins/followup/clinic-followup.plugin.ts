import { Injectable } from "@nestjs/common";
import { BaseAppointmentPlugin } from "../base/base-plugin.service";
import { AppointmentFollowUpService } from "./appointment-followup.service";

@Injectable()
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
export class ClinicFollowUpPlugin extends BaseAppointmentPlugin {
  readonly name = "clinic-followup-plugin";
  readonly version = "1.0.0";
  readonly features = [
    "follow-up-planning",
    "follow-up-reminders",
    "follow-up-templates",
    "overdue-tracking",
  ];

  constructor(private readonly followUpService: AppointmentFollowUpService) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    this.logPluginAction("Processing clinic follow-up operation", {
      operation: pluginData.operation,
    });

    switch (pluginData.operation) {
      case "createFollowUpPlan":
        return await this.followUpService.createFollowUpPlan(
          pluginData.appointmentId,
          pluginData.patientId,
          pluginData.doctorId,
          pluginData.clinicId,
          pluginData.followUpType,
          pluginData.daysAfter,
          pluginData.instructions,
          pluginData.priority,
          pluginData.medications,
          pluginData.tests,
          pluginData.restrictions,
          pluginData.notes,
        );

      case "getPatientFollowUps":
        return await this.followUpService.getPatientFollowUps(
          pluginData.patientId,
          pluginData.clinicId,
          pluginData.status,
        );

      case "updateFollowUpStatus":
        return await this.followUpService.updateFollowUpStatus(
          pluginData.followUpId,
          pluginData.status,
          pluginData.notes,
        );

      case "getFollowUpTemplates":
        return await this.followUpService.getFollowUpTemplates(
          pluginData.clinicId,
        );

      case "createFollowUpTemplate":
        return await this.followUpService.createFollowUpTemplate(
          pluginData.template,
        );

      case "getOverdueFollowUps":
        return await this.followUpService.getOverdueFollowUps(
          pluginData.clinicId,
        );

      case "createRoutineFollowUp":
        return await this.createRoutineFollowUp(data);

      case "createUrgentFollowUp":
        return await this.createUrgentFollowUp(data);

      case "createSpecialistFollowUp":
        return await this.createSpecialistFollowUp(data);

      case "createTherapyFollowUp":
        return await this.createTherapyFollowUp(data);

      case "createSurgeryFollowUp":
        return await this.createSurgeryFollowUp(data);

      default:
        this.logPluginError("Unknown follow-up operation", {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown follow-up operation: ${pluginData.operation}`);
    }
  }

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    const requiredFields = {
      createFollowUpPlan: [
        "appointmentId",
        "patientId",
        "doctorId",
        "clinicId",
        "followUpType",
        "daysAfter",
        "instructions",
      ],
      getPatientFollowUps: ["patientId", "clinicId"],
      updateFollowUpStatus: ["followUpId", "status"],
      getFollowUpTemplates: ["clinicId"],
      createFollowUpTemplate: ["template"],
      getOverdueFollowUps: ["clinicId"],
      createRoutineFollowUp: [
        "appointmentId",
        "patientId",
        "doctorId",
        "clinicId",
      ],
      createUrgentFollowUp: [
        "appointmentId",
        "patientId",
        "doctorId",
        "clinicId",
      ],
      createSpecialistFollowUp: [
        "appointmentId",
        "patientId",
        "doctorId",
        "clinicId",
      ],
      createTherapyFollowUp: [
        "appointmentId",
        "patientId",
        "doctorId",
        "clinicId",
      ],
      createSurgeryFollowUp: [
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
      return false;
    }

    for (const field of required) {
      if (!pluginData[field]) {
        this.logPluginError(`Missing required field: ${field}`, {
          operation,
          field,
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Create routine follow-up
   */
  private async createRoutineFollowUp(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const followUpType = "routine";
    const daysAfter = pluginData.daysAfter || 7;
    const instructions =
      pluginData.instructions ||
      "Routine follow-up appointment to monitor progress";
    const priority = pluginData.priority || "normal";

    return await this.followUpService.createFollowUpPlan(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      followUpType,
      daysAfter,
      instructions,
      priority,
      pluginData.medications,
      pluginData.tests,
      pluginData.restrictions,
      pluginData.notes,
    );
  }

  /**
   * Create urgent follow-up
   */
  private async createUrgentFollowUp(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const followUpType = "urgent";
    const daysAfter = pluginData.daysAfter || 1;
    const instructions =
      pluginData.instructions || "Urgent follow-up appointment required";
    const priority = "urgent";

    return await this.followUpService.createFollowUpPlan(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      followUpType,
      daysAfter,
      instructions,
      priority,
      pluginData.medications,
      pluginData.tests,
      pluginData.restrictions,
      pluginData.notes,
    );
  }

  /**
   * Create specialist follow-up
   */
  private async createSpecialistFollowUp(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const followUpType = "specialist";
    const daysAfter = pluginData.daysAfter || 14;
    const instructions =
      pluginData.instructions || "Specialist follow-up appointment";
    const priority = pluginData.priority || "high";

    return await this.followUpService.createFollowUpPlan(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      followUpType,
      daysAfter,
      instructions,
      priority,
      pluginData.medications,
      pluginData.tests,
      pluginData.restrictions,
      pluginData.notes,
    );
  }

  /**
   * Create therapy follow-up
   */
  private async createTherapyFollowUp(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const followUpType = "therapy";
    const daysAfter = pluginData.daysAfter || 3;
    const instructions =
      pluginData.instructions ||
      "Therapy follow-up to assess progress and adjust treatment plan";
    const priority = pluginData.priority || "normal";

    return await this.followUpService.createFollowUpPlan(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      followUpType,
      daysAfter,
      instructions,
      priority,
      pluginData.medications,
      pluginData.tests,
      pluginData.restrictions,
      pluginData.notes,
    );
  }

  /**
   * Create surgery follow-up
   */
  private async createSurgeryFollowUp(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const followUpType = "surgery";
    const daysAfter = pluginData.daysAfter || 14;
    const instructions =
      pluginData.instructions ||
      "Post-surgery follow-up to check healing and recovery";
    const priority = pluginData.priority || "high";

    return await this.followUpService.createFollowUpPlan(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      followUpType,
      daysAfter,
      instructions,
      priority,
      pluginData.medications,
      pluginData.tests,
      pluginData.restrictions,
      pluginData.notes,
    );
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
