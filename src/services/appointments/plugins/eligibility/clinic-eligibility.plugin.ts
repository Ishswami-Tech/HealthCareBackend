import { Injectable, Logger } from "@nestjs/common";
import { BaseAppointmentPlugin } from "../base/base-plugin.service";
import { AppointmentEligibilityService } from "./appointment-eligibility.service";

@Injectable()
export class ClinicEligibilityPlugin extends BaseAppointmentPlugin {
  protected readonly logger = new Logger(ClinicEligibilityPlugin.name);

  constructor(
    private readonly eligibilityService: AppointmentEligibilityService,
  ) {
    super();
  }

  get name(): string {
    return "clinic-eligibility";
  }

  get version(): string {
    return "1.0.0";
  }

  get features(): string[] {
    return ["eligibility", "criteria", "validation"];
  }

  getSupportedOperations(): string[] {
    return [
      "checkEligibility",
      "getEligibilityCriteria",
      "createEligibilityCriteria",
      "getEligibilityHistory",
      "updateEligibilityCriteria",
      "deleteEligibilityCriteria",
    ];
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const { operation, ...params } = data as any;

    this.logger.log(`Processing eligibility operation: ${operation}`, {
      operation,
      patientId: params.patientId,
      clinicId: params.clinicId,
    });

    try {
      switch (operation) {
        case "checkEligibility":
          return await this.eligibilityService.checkEligibility(
            params.patientId,
            params.appointmentType,
            params.clinicId,
            params.requestedDate,
          );

        case "getEligibilityCriteria":
          return await this.eligibilityService.getEligibilityCriteria(
            params.clinicId,
          );

        case "createEligibilityCriteria":
          return await this.eligibilityService.createEligibilityCriteria(
            params.criteriaData,
          );

        case "getEligibilityHistory":
          return await this.eligibilityService.getEligibilityHistory(
            params.patientId,
            params.clinicId,
          );

        case "updateEligibilityCriteria":
          // TODO: Implement updateEligibilityCriteria method
          throw new Error("updateEligibilityCriteria method not implemented");

        case "deleteEligibilityCriteria":
          // TODO: Implement deleteEligibilityCriteria method
          throw new Error("deleteEligibilityCriteria method not implemented");

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (_error) {
      this.logger.error(`Eligibility operation failed: ${operation}`, {
        operation,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    const { operation, ...params } = data as any;

    // Validate required parameters based on operation
    switch (operation) {
      case "checkEligibility":
        return !!(
          params.patientId &&
          params.appointmentType &&
          params.clinicId &&
          params.requestedDate
        );

      case "getEligibilityCriteria":
        return !!params.clinicId;

      case "createEligibilityCriteria":
        return !!(
          params.criteriaData &&
          params.criteriaData.name &&
          params.criteriaData.clinicId
        );

      case "getEligibilityHistory":
        return !!(params.patientId && params.clinicId);

      case "updateEligibilityCriteria":
        return !!(params.criteriaId && params.updateData);

      case "deleteEligibilityCriteria":
        return !!params.criteriaId;

      default:
        return false;
    }
  }

  getRequiredParameters(operation: string): string[] {
    switch (operation) {
      case "checkEligibility":
        return ["patientId", "appointmentType", "clinicId", "requestedDate"];
      case "getEligibilityCriteria":
        return ["clinicId"];
      case "createEligibilityCriteria":
        return ["criteriaData"];
      case "getEligibilityHistory":
        return ["patientId", "clinicId"];
      case "updateEligibilityCriteria":
        return ["criteriaId", "updateData"];
      case "deleteEligibilityCriteria":
        return ["criteriaId"];
      default:
        return [];
    }
  }

  getHealthMetrics(): unknown {
    return {
      plugin: this.name,
      version: this.version,
      status: "healthy",
      operations: this.getSupportedOperations().length,
      lastCheck: new Date().toISOString(),
    };
  }
}

