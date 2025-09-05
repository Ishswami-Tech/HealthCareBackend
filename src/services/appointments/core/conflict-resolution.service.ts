import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface TimeSlot {
  startTime: Date;
  endTime: Date;
  doctorId: string;
  clinicId: string;
  isAvailable: boolean;
  appointmentId?: string;
  bufferMinutes?: number;
}

export interface ConflictResolutionOptions {
  allowOverlap: boolean;
  bufferMinutes: number;
  emergencyOverride: boolean;
  suggestAlternatives: boolean;
  maxAlternatives: number;
  timeWindow: {
    startHour: number; // 9 AM
    endHour: number;   // 18 PM
  };
  priorityLevels: {
    emergency: number;
    vip: number;
    regular: number;
    followup: number;
  };
}

export interface ConflictResolutionResult {
  canSchedule: boolean;
  conflicts: ConflictDetails[];
  alternatives: AlternativeSlot[];
  resolution: {
    strategy: 'allow' | 'reject' | 'reschedule' | 'override';
    reason: string;
    actions: ResolutionAction[];
  };
  warnings: string[];
  metadata: {
    processingTimeMs: number;
    rulesApplied: string[];
    timestamp: Date;
  };
}

export interface ConflictDetails {
  type: 'time_overlap' | 'doctor_unavailable' | 'resource_conflict' | 'business_rule' | 'capacity_exceeded';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  conflictingAppointmentId?: string;
  conflictingTimeSlot?: TimeSlot;
  affectedResources: string[];
  resolution?: string;
}

export interface AlternativeSlot {
  startTime: Date;
  endTime: Date;
  doctorId: string;
  score: number; // 0-100, higher is better
  reason: string;
  availability: 'available' | 'preferred' | 'suboptimal';
  estimatedWaitTime?: number;
}

export interface ResolutionAction {
  type: 'move_appointment' | 'notify_patient' | 'extend_hours' | 'add_resource' | 'escalate';
  description: string;
  parameters: Record<string, any>;
  requiredApproval?: boolean;
}

export interface AppointmentRequest {
  patientId: string;
  doctorId: string;
  clinicId: string;
  requestedTime: Date;
  duration: number; // minutes
  priority: 'emergency' | 'vip' | 'regular' | 'followup';
  serviceType: string;
  notes?: string;
  preferredAlternatives?: Date[];
}

@Injectable()
export class ConflictResolutionService {
  private readonly logger = new Logger(ConflictResolutionService.name);
  
  private defaultOptions: ConflictResolutionOptions = {
    allowOverlap: false,
    bufferMinutes: 15,
    emergencyOverride: true,
    suggestAlternatives: true,
    maxAlternatives: 5,
    timeWindow: {
      startHour: 9,
      endHour: 18
    },
    priorityLevels: {
      emergency: 1,
      vip: 2,
      regular: 5,
      followup: 7
    }
  };

  constructor(private eventEmitter: EventEmitter2) {}

  async resolveSchedulingConflict(
    request: AppointmentRequest,
    existingAppointments: TimeSlot[],
    options: Partial<ConflictResolutionOptions> = {}
  ): Promise<ConflictResolutionResult> {
    const startTime = Date.now();
    const resolvedOptions = { ...this.defaultOptions, ...options };
    
    this.logger.log(`🔍 Resolving scheduling conflict for ${request.priority} appointment at ${request.requestedTime}`);

    const result: ConflictResolutionResult = {
      canSchedule: false,
      conflicts: [],
      alternatives: [],
      resolution: {
        strategy: 'reject',
        reason: '',
        actions: []
      },
      warnings: [],
      metadata: {
        processingTimeMs: 0,
        rulesApplied: [],
        timestamp: new Date()
      }
    };

    try {
      // Step 1: Detect all conflicts
      const conflicts = await this.detectConflicts(request, existingAppointments, resolvedOptions);
      result.conflicts = conflicts;

      // Step 2: Analyze conflict severity
      const criticalConflicts = conflicts.filter(c => c.severity === 'critical');
      const highConflicts = conflicts.filter(c => c.severity === 'high');

      // Step 3: Apply intelligent conflict resolution
      if (conflicts.length === 0) {
        // No conflicts - schedule normally
        result.canSchedule = true;
        result.resolution = {
          strategy: 'allow',
          reason: 'No conflicts detected',
          actions: []
        };
        
      } else if (request.priority === 'emergency' && resolvedOptions.emergencyOverride) {
        // Emergency override logic
        result.canSchedule = true;
        result.resolution = {
          strategy: 'override',
          reason: 'Emergency appointment override',
          actions: await this.createEmergencyResolutionActions(request, conflicts)
        };
        result.warnings.push('Emergency appointment may cause conflicts with existing appointments');
        
      } else if (criticalConflicts.length === 0 && this.canResolveConflicts(conflicts, request, resolvedOptions)) {
        // Conflicts can be resolved
        result.canSchedule = true;
        result.resolution = {
          strategy: 'reschedule',
          reason: 'Conflicts resolved through intelligent rescheduling',
          actions: await this.createResolutionActions(conflicts, request, resolvedOptions)
        };
        
      } else {
        // Cannot resolve conflicts - suggest alternatives
        result.canSchedule = false;
        result.resolution = {
          strategy: 'reject',
          reason: 'Unresolvable conflicts detected',
          actions: []
        };
      }

      // Step 4: Generate alternative time slots if needed
      if (resolvedOptions.suggestAlternatives) {
        result.alternatives = await this.generateAlternatives(
          request,
          existingAppointments,
          resolvedOptions
        );
      }

      // Step 5: Apply business rules validation
      result.metadata.rulesApplied = await this.applyBusinessRules(request, result, resolvedOptions);

      result.metadata.processingTimeMs = Date.now() - startTime;
      
      // Emit resolution event for monitoring
      await this.eventEmitter.emitAsync('appointment.conflict-resolved', {
        request,
        result,
        processingTime: result.metadata.processingTimeMs
      });

      this.logger.log(`✅ Conflict resolution complete: ${result.resolution.strategy} (${result.metadata.processingTimeMs}ms)`);
      
      return result;

    } catch (error) {
      this.logger.error(`❌ Conflict resolution failed: ${error.message}`);
      result.conflicts.push({
        type: 'business_rule',
        severity: 'critical',
        description: `System error during conflict resolution: ${error.message}`,
        affectedResources: ['system']
      });
      return result;
    }
  }

  private async detectConflicts(
    request: AppointmentRequest,
    existingAppointments: TimeSlot[],
    options: ConflictResolutionOptions
  ): Promise<ConflictDetails[]> {
    const conflicts: ConflictDetails[] = [];
    
    const requestEndTime = new Date(request.requestedTime.getTime() + request.duration * 60000);
    const bufferStartTime = new Date(request.requestedTime.getTime() - options.bufferMinutes * 60000);
    const bufferEndTime = new Date(requestEndTime.getTime() + options.bufferMinutes * 60000);

    // Check for time overlaps with existing appointments
    for (const appointment of existingAppointments) {
      if (appointment.doctorId !== request.doctorId) continue;
      if (appointment.clinicId !== request.clinicId) continue;

      const hasTimeOverlap = this.hasTimeOverlap(
        bufferStartTime,
        bufferEndTime,
        appointment.startTime,
        appointment.endTime
      );

      if (hasTimeOverlap) {
        const severity = this.calculateConflictSeverity(request, appointment, options);
        
        conflicts.push({
          type: 'time_overlap',
          severity,
          description: `Time overlap with existing appointment ${appointment.appointmentId}`,
          conflictingAppointmentId: appointment.appointmentId,
          conflictingTimeSlot: appointment,
          affectedResources: ['doctor', 'time-slot']
        });
      }
    }

    // Check business hours
    const requestHour = request.requestedTime.getHours();
    if (requestHour < options.timeWindow.startHour || requestHour >= options.timeWindow.endHour) {
      conflicts.push({
        type: 'business_rule',
        severity: 'medium',
        description: `Appointment outside business hours (${options.timeWindow.startHour}:00-${options.timeWindow.endHour}:00)`,
        affectedResources: ['business-hours']
      });
    }

    // Check doctor availability (this would integrate with doctor schedule)
    const doctorAvailable = await this.checkDoctorAvailability(request.doctorId, request.requestedTime);
    if (!doctorAvailable) {
      conflicts.push({
        type: 'doctor_unavailable',
        severity: 'high',
        description: 'Doctor is not available at requested time',
        affectedResources: ['doctor']
      });
    }

    // Check clinic capacity
    const clinicCapacity = await this.checkClinicCapacity(request.clinicId, request.requestedTime);
    if (!clinicCapacity.available) {
      conflicts.push({
        type: 'capacity_exceeded',
        severity: 'high',
        description: `Clinic capacity exceeded (${clinicCapacity.current}/${clinicCapacity.maximum})`,
        affectedResources: ['clinic-capacity']
      });
    }

    return conflicts;
  }

  private hasTimeOverlap(
    start1: Date,
    end1: Date,
    start2: Date,
    end2: Date
  ): boolean {
    return start1 < end2 && end1 > start2;
  }

  private calculateConflictSeverity(
    request: AppointmentRequest,
    existingAppointment: TimeSlot,
    options: ConflictResolutionOptions
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Emergency appointments get highest priority
    if (request.priority === 'emergency') {
      return 'low'; // Emergency can override others
    }

    // If overlapping with another emergency, it's critical
    // This would require checking the priority of the existing appointment
    // For now, we'll use a simple heuristic

    const overlapMinutes = this.calculateOverlapMinutes(
      request.requestedTime,
      new Date(request.requestedTime.getTime() + request.duration * 60000),
      existingAppointment.startTime,
      existingAppointment.endTime
    );

    if (overlapMinutes > 30) return 'critical';
    if (overlapMinutes > 15) return 'high';
    if (overlapMinutes > 5) return 'medium';
    return 'low';
  }

  private calculateOverlapMinutes(
    start1: Date,
    end1: Date,
    start2: Date,
    end2: Date
  ): number {
    const overlapStart = new Date(Math.max(start1.getTime(), start2.getTime()));
    const overlapEnd = new Date(Math.min(end1.getTime(), end2.getTime()));
    
    if (overlapStart >= overlapEnd) return 0;
    
    return (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60);
  }

  private canResolveConflicts(
    conflicts: ConflictDetails[],
    request: AppointmentRequest,
    options: ConflictResolutionOptions
  ): boolean {
    // Check if all conflicts are resolvable
    for (const conflict of conflicts) {
      if (conflict.severity === 'critical') {
        return false; // Cannot resolve critical conflicts
      }
      
      if (conflict.type === 'doctor_unavailable') {
        return false; // Cannot schedule when doctor is unavailable
      }
    }
    
    return true;
  }

  private async createEmergencyResolutionActions(
    request: AppointmentRequest,
    conflicts: ConflictDetails[]
  ): Promise<ResolutionAction[]> {
    const actions: ResolutionAction[] = [];

    for (const conflict of conflicts) {
      if (conflict.type === 'time_overlap' && conflict.conflictingAppointmentId) {
        actions.push({
          type: 'move_appointment',
          description: `Reschedule conflicting appointment ${conflict.conflictingAppointmentId} to accommodate emergency`,
          parameters: {
            appointmentId: conflict.conflictingAppointmentId,
            reason: 'Emergency override',
            priority: 'high'
          },
          requiredApproval: true
        });

        actions.push({
          type: 'notify_patient',
          description: 'Notify affected patient of emergency rescheduling',
          parameters: {
            appointmentId: conflict.conflictingAppointmentId,
            notificationType: 'emergency_reschedule',
            urgency: 'high'
          }
        });
      }
    }

    // Add escalation for emergency appointments
    actions.push({
      type: 'escalate',
      description: 'Escalate emergency appointment to clinic administrator',
      parameters: {
        escalationLevel: 'emergency',
        reason: 'Emergency appointment conflict resolution'
      }
    });

    return actions;
  }

  private async createResolutionActions(
    conflicts: ConflictDetails[],
    request: AppointmentRequest,
    options: ConflictResolutionOptions
  ): Promise<ResolutionAction[]> {
    const actions: ResolutionAction[] = [];

    for (const conflict of conflicts) {
      switch (conflict.type) {
        case 'time_overlap':
          if (conflict.severity === 'low' || conflict.severity === 'medium') {
            actions.push({
              type: 'move_appointment',
              description: 'Adjust appointment time to resolve minor overlap',
              parameters: {
                timeAdjustmentMinutes: options.bufferMinutes,
                direction: 'later'
              }
            });
          }
          break;

        case 'capacity_exceeded':
          actions.push({
            type: 'extend_hours',
            description: 'Extend clinic hours to accommodate appointment',
            parameters: {
              extensionMinutes: 30,
              reason: 'Capacity management'
            },
            requiredApproval: true
          });
          break;

        case 'business_rule':
          actions.push({
            type: 'escalate',
            description: 'Escalate business rule conflict for manual review',
            parameters: {
              escalationLevel: 'supervisor',
              reason: conflict.description
            }
          });
          break;
      }
    }

    return actions;
  }

  private async generateAlternatives(
    request: AppointmentRequest,
    existingAppointments: TimeSlot[],
    options: ConflictResolutionOptions
  ): Promise<AlternativeSlot[]> {
    const alternatives: AlternativeSlot[] = [];
    const baseTime = new Date(request.requestedTime);
    
    // Generate alternatives within the same day
    for (let i = 1; i <= options.maxAlternatives * 2; i++) {
      const alternativeTime = new Date(baseTime.getTime() + i * 30 * 60000); // 30-minute intervals
      
      // Check if this time slot is available
      const conflicts = await this.detectConflicts(
        { ...request, requestedTime: alternativeTime },
        existingAppointments,
        options
      );

      if (conflicts.length === 0) {
        const score = this.calculateAlternativeScore(request.requestedTime, alternativeTime, request.priority);
        
        alternatives.push({
          startTime: alternativeTime,
          endTime: new Date(alternativeTime.getTime() + request.duration * 60000),
          doctorId: request.doctorId,
          score,
          reason: `Available slot ${Math.round(i * 0.5)} hours from requested time`,
          availability: score > 80 ? 'preferred' : score > 60 ? 'available' : 'suboptimal'
        });
      }

      if (alternatives.length >= options.maxAlternatives) break;
    }

    // Generate alternatives for next day if not enough found
    if (alternatives.length < options.maxAlternatives) {
      const nextDay = new Date(baseTime);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(options.timeWindow.startHour, 0, 0, 0);

      for (let hour = 0; hour < (options.timeWindow.endHour - options.timeWindow.startHour); hour++) {
        const alternativeTime = new Date(nextDay.getTime() + hour * 60 * 60000);
        
        const conflicts = await this.detectConflicts(
          { ...request, requestedTime: alternativeTime },
          existingAppointments,
          options
        );

        if (conflicts.length === 0) {
          alternatives.push({
            startTime: alternativeTime,
            endTime: new Date(alternativeTime.getTime() + request.duration * 60000),
            doctorId: request.doctorId,
            score: 70, // Next day gets moderate score
            reason: 'Available next day',
            availability: 'available'
          });
        }

        if (alternatives.length >= options.maxAlternatives) break;
      }
    }

    // Sort alternatives by score (best first)
    alternatives.sort((a, b) => b.score - a.score);
    
    return alternatives.slice(0, options.maxAlternatives);
  }

  private calculateAlternativeScore(
    requestedTime: Date,
    alternativeTime: Date,
    priority: string
  ): number {
    const timeDiffHours = Math.abs(alternativeTime.getTime() - requestedTime.getTime()) / (1000 * 60 * 60);
    
    let score = 100;
    
    // Deduct points for time difference
    score -= timeDiffHours * 5; // 5 points per hour difference
    
    // Priority adjustments
    if (priority === 'emergency') {
      score += 20; // Emergency appointments get bonus
    } else if (priority === 'vip') {
      score += 10; // VIP appointments get bonus
    }
    
    // Time of day preferences (prefer mid-morning and early afternoon)
    const hour = alternativeTime.getHours();
    if (hour >= 10 && hour <= 11) score += 10; // Mid-morning
    if (hour >= 14 && hour <= 15) score += 10; // Early afternoon
    if (hour < 9 || hour > 17) score -= 20; // Outside preferred hours
    
    return Math.max(0, Math.min(100, score));
  }

  private async applyBusinessRules(
    request: AppointmentRequest,
    result: ConflictResolutionResult,
    options: ConflictResolutionOptions
  ): Promise<string[]> {
    const appliedRules: string[] = [];

    // Rule: Emergency override
    if (request.priority === 'emergency' && options.emergencyOverride) {
      appliedRules.push('emergency-override');
    }

    // Rule: VIP priority
    if (request.priority === 'vip') {
      appliedRules.push('vip-priority');
    }

    // Rule: Buffer time validation
    appliedRules.push('buffer-time-validation');

    // Rule: Business hours check
    appliedRules.push('business-hours-check');

    return appliedRules;
  }

  // Helper methods that would integrate with actual data sources

  private async checkDoctorAvailability(doctorId: string, time: Date): Promise<boolean> {
    // This would integrate with doctor schedule/availability system
    // For now, return true to indicate doctor is available
    return true;
  }

  private async checkClinicCapacity(clinicId: string, time: Date): Promise<{
    available: boolean;
    current: number;
    maximum: number;
  }> {
    // This would integrate with clinic capacity management system
    // For now, return available capacity
    return {
      available: true,
      current: 5,
      maximum: 10
    };
  }

  // Public utility methods for external services

  async findNextAvailableSlot(
    doctorId: string,
    clinicId: string,
    fromTime: Date,
    duration: number
  ): Promise<Date | null> {
    // Simplified implementation - would integrate with actual appointment data
    const nextSlot = new Date(fromTime.getTime() + 60 * 60000); // Next hour
    return nextSlot;
  }

  async getConflictStatistics(clinicId: string, dateRange: { from: Date; to: Date }): Promise<{
    totalConflicts: number;
    resolvedConflicts: number;
    conflictsByType: Record<string, number>;
    averageResolutionTime: number;
  }> {
    // This would query actual conflict resolution history
    return {
      totalConflicts: 0,
      resolvedConflicts: 0,
      conflictsByType: {},
      averageResolutionTime: 0
    };
  }
}