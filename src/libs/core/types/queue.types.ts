/**
 * Represents a patient's position in the queue
 * @interface QueuePosition
 * @description Contains queue position and wait time information
 * @example
 * ```typescript
 * const position: QueuePosition = {
 *   position: 3,
 *   estimatedWaitTime: 45,
 *   totalAhead: 2
 * };
 * ```
 */
export interface QueuePosition {
  /** Current position in the queue */
  readonly position: number;
  /** Estimated wait time in minutes */
  readonly estimatedWaitTime: number;
  /** Number of patients ahead */
  readonly totalAhead: number;
}

/**
 * Represents queue statistics
 * @interface QueueStats
 * @description Contains comprehensive queue performance metrics
 * @example
 * ```typescript
 * const stats: QueueStats = {
 *   waiting: 5,
 *   active: 3,
 *   completed: 25,
 *   failed: 1,
 *   avgWaitTime: 15,
 *   estimatedWaitTime: 20
 * };
 * ```
 */
export interface QueueStats {
  /** Number of patients waiting */
  readonly waiting: number;
  /** Number of patients currently being served */
  readonly active: number;
  /** Number of completed appointments */
  readonly completed: number;
  /** Number of failed appointments */
  readonly failed: number;
  /** Average wait time in minutes */
  readonly avgWaitTime: number;
  /** Current estimated wait time in minutes */
  readonly estimatedWaitTime: number;
}

/**
 * Represents queue statistics for a specific location
 * @interface LocationQueueStats
 * @description Extends QueueStats with location-specific data and doctor statistics
 * @example
 * ```typescript
 * const locationStats: LocationQueueStats = {
 *   locationId: "location-123",
 *   waiting: 5,
 *   active: 3,
 *   completed: 25,
 *   failed: 1,
 *   avgWaitTime: 15,
 *   estimatedWaitTime: 20,
 *   doctorStats: {
 *     "doctor-1": { waiting: 2, active: 1, avgWaitTime: 10 },
 *     "doctor-2": { waiting: 3, active: 2, avgWaitTime: 20 }
 *   }
 * };
 * ```
 */
export interface LocationQueueStats extends QueueStats {
  /** Location identifier */
  readonly locationId: string;
  /** Statistics per doctor */
  readonly doctorStats: {
    /** Doctor ID to statistics mapping */
    readonly [doctorId: string]: {
      /** Number of patients waiting for this doctor */
      readonly waiting: number;
      /** Number of patients currently being served by this doctor */
      readonly active: number;
      /** Average wait time for this doctor in minutes */
      readonly avgWaitTime: number;
    };
  };
}

/**
 * Represents queue statistics for a specific doctor
 * @interface DoctorQueueStats
 * @description Contains doctor-specific queue metrics and next appointment information
 * @example
 * ```typescript
 * const doctorStats: DoctorQueueStats = {
 *   waiting: 3,
 *   active: 1,
 *   completed: 15,
 *   avgWaitTime: 12,
 *   nextAppointment: {
 *     id: "appointment-123",
 *     patientName: "John Doe",
 *     scheduledTime: "2024-01-15T14:30:00Z"
 *   }
 * };
 * ```
 */
export interface DoctorQueueStats {
  /** Number of patients waiting for this doctor */
  readonly waiting: number;
  /** Number of patients currently being served by this doctor */
  readonly active: number;
  /** Number of completed appointments for this doctor */
  readonly completed: number;
  /** Average wait time for this doctor in minutes */
  readonly avgWaitTime: number;
  /** Optional next appointment information */
  readonly nextAppointment?: {
    /** Appointment ID */
    readonly id: string;
    /** Patient name */
    readonly patientName: string;
    /** Scheduled time */
    readonly scheduledTime: string;
  };
}
