import { Injectable, Logger } from "@nestjs/common";
import { BaseAppointmentPlugin } from "../base/base-plugin.service";
import { AppointmentResourceService } from "./appointment-resource.service";

@Injectable()
export class ClinicResourcePlugin extends BaseAppointmentPlugin {
  protected readonly logger = new Logger(ClinicResourcePlugin.name);

  constructor(private readonly resourceService: AppointmentResourceService) {
    super();
  }

  get name(): string {
    return "clinic-resource";
  }

  get version(): string {
    return "1.0.0";
  }

  get features(): string[] {
    return ["resources", "booking", "conflicts"];
  }

  getSupportedOperations(): string[] {
    return [
      "createResource",
      "getClinicResources",
      "bookResource",
      "checkResourceConflicts",
      "getResourceBookings",
      "cancelResourceBooking",
      "getAlternativeResources",
    ];
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const { operation, ...params } = data as any;

    this.logger.log(`Processing resource operation: ${operation}`, {
      operation,
      resourceId: params.resourceId,
      clinicId: params.clinicId,
    });

    try {
      switch (operation) {
        case "createResource":
          return await this.resourceService.createResource(params.resourceData);

        case "getClinicResources":
          return await this.resourceService.getClinicResources(
            params.clinicId,
            params.type,
          );

        case "bookResource":
          return await this.resourceService.bookResource(
            params.resourceId,
            params.appointmentId,
            params.startTime,
            params.endTime,
            params.notes,
          );

        case "checkResourceConflicts":
          return await this.resourceService.checkResourceConflicts(
            params.resourceId,
            params.startTime,
            params.endTime,
          );

        case "getResourceBookings":
          return await this.resourceService.getResourceBookings(
            params.resourceId,
            params.startTime,
            params.endTime,
          );

        case "cancelResourceBooking":
          return await this.resourceService.cancelResourceBooking(
            params.bookingId,
          );

        case "getAlternativeResources":
          return await this.resourceService.getAlternativeResources(
            params.resourceId,
          );

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (_error) {
      this.logger.error(`Resource operation failed: ${operation}`, {
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
      case "createResource":
        return !!(
          params.resourceData &&
          params.resourceData.name &&
          params.resourceData.type &&
          params.resourceData.clinicId
        );

      case "getClinicResources":
        return !!params.clinicId;

      case "bookResource":
        return !!(
          params.resourceId &&
          params.appointmentId &&
          params.startTime &&
          params.endTime
        );

      case "checkResourceConflicts":
        return !!(params.resourceId && params.startTime && params.endTime);

      case "getResourceBookings":
        return !!params.resourceId;

      case "cancelResourceBooking":
        return !!params.bookingId;

      case "getAlternativeResources":
        return !!params.resourceId;

      default:
        return false;
    }
  }

  getRequiredParameters(operation: string): string[] {
    switch (operation) {
      case "createResource":
        return ["resourceData"];
      case "getClinicResources":
        return ["clinicId"];
      case "bookResource":
        return ["resourceId", "appointmentId", "startTime", "endTime"];
      case "checkResourceConflicts":
        return ["resourceId", "startTime", "endTime"];
      case "getResourceBookings":
        return ["resourceId"];
      case "cancelResourceBooking":
        return ["bookingId"];
      case "getAlternativeResources":
        return ["resourceId"];
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
