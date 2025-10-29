/**
 * Business rules type definitions
 *
 * This file contains all type definitions for the business rules engine,
 * providing comprehensive type safety and better developer experience.
 *
 * @module BusinessRulesTypes
 */

/**
 * Business rule condition types
 */
export type RuleConditionType =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "contains"
  | "not_contains"
  | "in_range"
  | "is_empty"
  | "is_not_empty"
  | "custom";

/**
 * Business rule action types
 */
export type RuleActionType =
  | "block"
  | "allow"
  | "warn"
  | "log"
  | "notify"
  | "auto_correct"
  | "require_approval"
  | "custom";

/**
 * Rule severity levels
 */
export type RuleSeverity = "low" | "medium" | "high" | "critical";

/**
 * Rule categories for healthcare operations
 */
export type RuleCategory =
  | "appointment_creation"
  | "appointment_update"
  | "appointment_cancellation"
  | "user_access"
  | "data_integrity"
  | "billing"
  | "prescription"
  | "patient_safety"
  | "compliance"
  | "audit"
  | "custom";

/**
 * Business rule condition interface
 * @interface RuleCondition
 */
export interface RuleCondition {
  /** Condition type */
  readonly type: RuleConditionType;
  /** Field path to evaluate */
  readonly field: string;
  /** Expected value for comparison */
  readonly value: unknown;
  /** Optional custom function for complex conditions */
  readonly customFunction?: string;
  /** Logical operator for combining conditions */
  readonly operator?: "AND" | "OR";
}

/**
 * Business rule action interface
 * @interface RuleAction
 */
export interface RuleAction {
  /** Action type */
  readonly type: RuleActionType;
  /** Action message or description */
  readonly message: string;
  /** Action severity level */
  readonly severity: RuleSeverity;
  /** Optional custom function for complex actions */
  readonly customFunction?: string;
  /** Action parameters */
  readonly parameters?: Record<string, unknown>;
}

/**
 * Business rule interface
 * @interface BusinessRule
 */
export interface BusinessRule {
  /** Unique rule identifier */
  readonly id: string;
  /** Rule name */
  readonly name: string;
  /** Rule description */
  readonly description: string;
  /** Rule priority (higher number = higher priority) */
  readonly priority: number;
  /** Rule conditions */
  readonly conditions: readonly RuleCondition[];
  /** Rule actions */
  readonly actions: readonly RuleAction[];
  /** Whether the rule is active */
  readonly isActive: boolean;
  /** Rule category */
  readonly category: RuleCategory;
  /** Rule version */
  readonly version: string;
  /** Rule creation date */
  readonly createdAt: Date;
  /** Rule last updated date */
  readonly updatedAt: Date;
  /** Rule tags for categorization */
  readonly tags: readonly string[];
}

/**
 * Rule context interface
 * @interface RuleContext
 */
export interface RuleContext {
  /** Appointment ID (if applicable) */
  readonly appointmentId?: string;
  /** User ID */
  readonly userId: string;
  /** Clinic ID (if applicable) */
  readonly clinicId?: string;
  /** Context data */
  readonly data: Record<string, unknown>;
  /** Request metadata */
  readonly metadata?: {
    readonly userRole?: string;
    readonly userPermissions?: readonly string[];
    readonly requestSource?: string;
    readonly timestamp?: Date;
  };
}

/**
 * Rule result interface
 * @interface RuleResult
 */
export interface RuleResult {
  /** Whether the rule evaluation passed */
  readonly valid: boolean;
  /** List of rule violations */
  readonly violations: readonly string[];
  /** List of warnings */
  readonly warnings: readonly string[];
  /** List of actions to be taken */
  readonly actions: readonly RuleAction[];
  /** Evaluation metadata */
  readonly metadata?: {
    readonly evaluatedRules: readonly string[];
    readonly executionTime: number;
    readonly timestamp: Date;
  };
}

/**
 * Rule evaluation statistics
 * @interface RuleStats
 */
export interface RuleStats {
  /** Total rules evaluated */
  totalRules: number;
  /** Rules that passed */
  passedRules: number;
  /** Rules that failed */
  failedRules: number;
  /** Rules that generated warnings */
  warningRules: number;
  /** Average execution time */
  averageExecutionTime: number;
}

/**
 * Rule validation result for specific operations
 * @interface ValidationResult
 */
export interface ValidationResult {
  /** Whether validation passed */
  readonly isValid: boolean;
  /** Validation errors */
  readonly errors: readonly string[];
  /** Validation warnings */
  readonly warnings: readonly string[];
  /** Suggested corrections */
  readonly suggestions: readonly string[];
  /** Validation metadata */
  readonly metadata?: {
    readonly validatedAt: Date;
    readonly validatedBy: string;
    readonly validationDuration: number;
  };
}

/**
 * Rule execution context for complex operations
 * @interface ExecutionContext
 */
export interface ExecutionContext extends RuleContext {
  /** Execution session ID */
  readonly sessionId: string;
  /** Request ID for tracking */
  readonly requestId: string;
  /** Execution environment */
  readonly environment: "development" | "staging" | "production";
  /** Additional context data */
  readonly additionalData?: Record<string, unknown>;
}

/**
 * Rule performance metrics
 * @interface RulePerformanceMetrics
 */
export interface RulePerformanceMetrics {
  /** Rule ID */
  readonly ruleId: string;
  /** Average execution time */
  readonly averageExecutionTime: number;
  /** Total executions */
  readonly totalExecutions: number;
  /** Success rate */
  readonly successRate: number;
  /** Last execution time */
  readonly lastExecuted: Date;
  /** Performance trend */
  readonly trend: "improving" | "stable" | "degrading";
}
