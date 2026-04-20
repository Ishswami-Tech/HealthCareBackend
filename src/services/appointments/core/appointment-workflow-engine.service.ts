import { Injectable, Logger } from '@nestjs/common';
import type { WorkflowContext, WorkflowResult } from '@core/types/appointment.types';
import {
  canCancelAppointmentStatus,
  isValidAppointmentStatusTransition,
} from './appointment-state-contract';

// Re-export for backward compatibility
export type { WorkflowContext, WorkflowResult };

@Injectable()
export class AppointmentWorkflowEngine {
  private readonly logger = new Logger(AppointmentWorkflowEngine.name);

  /**
   * Execute workflow step
   */
  executeWorkflowStep(context: WorkflowContext): WorkflowResult {
    try {
      this.logger.log(`Executing workflow step for appointment: ${context.appointmentId}`);

      // Placeholder workflow logic
      return {
        success: true,
        message: 'Workflow step executed successfully',
        data: { processedAt: new Date() },
      };
    } catch (_error) {
      this.logger.error(`Workflow execution failed:`, (_error as Error).stack);
      return {
        success: false,
        message: (_error as Error).message,
      };
    }
  }

  /**
   * Process appointment creation workflow
   */
  processCreationWorkflow(context: WorkflowContext): WorkflowResult {
    return this.executeWorkflowStep(context);
  }

  /**
   * Process appointment update workflow
   */
  processUpdateWorkflow(context: WorkflowContext): WorkflowResult {
    return this.executeWorkflowStep(context);
  }

  /**
   * Process appointment cancellation workflow
   */
  processCancellationWorkflow(context: WorkflowContext): WorkflowResult {
    return this.executeWorkflowStep(context);
  }

  /**
   * Initialize workflow for an appointment
   */
  initializeWorkflow(appointmentId: string, eventType: string): WorkflowResult {
    try {
      this.logger.log(
        `Initializing workflow for appointment ${appointmentId} with event ${eventType}`
      );

      const context: WorkflowContext = {
        appointmentId,
        userId: 'system',
        data: { eventType, initializedAt: new Date() },
      };

      return this.executeWorkflowStep(context);
    } catch (_error) {
      this.logger.error(`Failed to initialize workflow:`, (_error as Error).stack);
      return {
        success: false,
        message: (_error as Error).message,
      };
    }
  }

  /**
   * Check if status transition is valid
   */
  isValidStatusTransition(currentStatus: string, newStatus: string): boolean {
    return isValidAppointmentStatusTransition(currentStatus, newStatus);
  }

  /**
   * Transition appointment status with workflow validation
   */
  transitionStatus(
    appointmentId: string,
    currentStatus: string,
    newStatus: string,
    userId: string
  ): WorkflowResult {
    try {
      if (!this.isValidStatusTransition(currentStatus, newStatus)) {
        return {
          success: false,
          message: `Invalid status transition from ${currentStatus} to ${newStatus}`,
        };
      }

      this.logger.log(
        `Transitioning appointment ${appointmentId} from ${currentStatus} to ${newStatus}`
      );

      const context: WorkflowContext = {
        appointmentId,
        userId,
        data: {
          currentStatus,
          newStatus,
          transitionedAt: new Date(),
        },
      };

      return this.executeWorkflowStep(context);
    } catch (_error) {
      this.logger.error(`Failed to transition status:`, (_error as Error).stack);
      return {
        success: false,
        message: (_error as Error).message,
      };
    }
  }

  /**
   * Check if appointment can be cancelled based on its current status
   */
  canCancelAppointment(currentStatus: string): boolean {
    return canCancelAppointmentStatus(currentStatus);
  }
}
