import { Injectable, Logger } from "@nestjs/common";
import type {
  BusinessRule,
  RuleCondition,
  RuleAction,
  RuleContext,
  RuleResult,
  RuleStats,
} from "./types/business-rules.types";

/**
 * Business rules engine service
 * Handles evaluation and validation of business rules for healthcare operations
 *
 * @class BusinessRulesEngine
 */
@Injectable()
export class BusinessRulesEngine {
  private readonly logger = new Logger(BusinessRulesEngine.name);
  private readonly rules = new Map<string, BusinessRule>();
  private readonly evaluationStats: RuleStats = {
    totalRules: 0,
    passedRules: 0,
    failedRules: 0,
    warningRules: 0,
    averageExecutionTime: 0,
  };

  /**
   * Registers a business rule
   * @param rule - Business rule to register
   * @returns True if registration was successful
   */
  registerRule(rule: BusinessRule): boolean {
    try {
      this.rules.set(rule.id, rule);
      this.logger.log(`Business rule registered: ${rule.name}`, {
        ruleId: rule.id,
        category: rule.category,
        priority: rule.priority,
      });
      return true;
    } catch (error) {
      this.logger.error("Failed to register business rule", {
        error: error instanceof Error ? error.message : "Unknown error",
        ruleId: rule.id,
      });
      return false;
    }
  }

  /**
   * Unregisters a business rule
   * @param ruleId - ID of the rule to unregister
   * @returns True if unregistration was successful
   */
  unregisterRule(ruleId: string): boolean {
    try {
      const rule = this.rules.get(ruleId);
      if (rule) {
        this.rules.delete(ruleId);
        this.logger.log(`Business rule unregistered: ${rule.name}`, {
          ruleId,
        });
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error("Failed to unregister business rule", {
        error: error instanceof Error ? error.message : "Unknown error",
        ruleId,
      });
      return false;
    }
  }

  /**
   * Gets all registered rules
   * @returns Array of all registered business rules
   */
  getAllRules(): readonly BusinessRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Gets rules by category
   * @param category - Rule category
   * @returns Array of rules in the specified category
   */
  getRulesByCategory(category: string): readonly BusinessRule[] {
    return Array.from(this.rules.values()).filter(
      (rule) => rule.category === category && rule.isActive,
    );
  }

  /**
   * Evaluates business rules for a given context
   * @param context - Rule evaluation context
   * @param category - Optional category filter
   * @returns Rule evaluation result
   */
  evaluateRules(context: RuleContext, category?: string): RuleResult {
    const startTime = Date.now();
    const evaluatedRules: string[] = [];
    const violations: string[] = [];
    const warnings: string[] = [];
    const actions: RuleAction[] = [];
    let valid = true;

    try {
      this.logger.log("Evaluating business rules", {
        userId: context.userId,
        appointmentId: context.appointmentId,
        clinicId: context.clinicId,
        category,
      });

      // Get rules to evaluate
      const rulesToEvaluate = category
        ? this.getRulesByCategory(category)
        : Array.from(this.rules.values()).filter((rule) => rule.isActive);

      // Sort rules by priority (higher priority first)
      const sortedRules = [...rulesToEvaluate].sort(
        (a, b) => b.priority - a.priority,
      );

      // Evaluate each rule
      for (const rule of sortedRules) {
        evaluatedRules.push(rule.id);
        const ruleResult = this.evaluateSingleRule(rule, context);

        if (!ruleResult.valid) {
          valid = false;
          violations.push(...ruleResult.violations);
        }

        warnings.push(...ruleResult.warnings);
        actions.push(...ruleResult.actions);
      }

      const executionTime = Date.now() - startTime;
      this.updateStats(
        evaluatedRules.length,
        valid,
        warnings.length > 0,
        executionTime,
      );

      return {
        valid,
        violations,
        warnings,
        actions,
        metadata: {
          evaluatedRules,
          executionTime,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error("Rule evaluation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: context.userId,
        executionTime,
      });

      return {
        valid: false,
        violations: [error instanceof Error ? error.message : "Unknown error"],
        warnings: ["Rule evaluation encountered an error"],
        actions: [],
        metadata: {
          evaluatedRules,
          executionTime,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Evaluates a single business rule
   * @param rule - Business rule to evaluate
   * @param context - Rule evaluation context
   * @returns Rule evaluation result
   * @private
   */
  private evaluateSingleRule(
    rule: BusinessRule,
    context: RuleContext,
  ): RuleResult {
    try {
      // Evaluate conditions
      const conditionsMet = this.evaluateConditions(rule.conditions, context);

      if (!conditionsMet) {
        return {
          valid: true,
          violations: [],
          warnings: [],
          actions: [],
        };
      }

      // If conditions are met, execute actions
      const violations: string[] = [];
      const warnings: string[] = [];
      const actions: RuleAction[] = [];

      for (const action of rule.actions) {
        switch (action.type) {
          case "block":
            violations.push(action.message);
            break;
          case "warn":
            warnings.push(action.message);
            break;
          case "allow":
            // Allow action - no violations
            break;
          case "log":
            this.logger.log(`Business rule action: ${action.message}`, {
              ruleId: rule.id,
              ruleName: rule.name,
              actionType: action.type,
            });
            break;
          case "notify":
            // Add notification action
            actions.push(action);
            break;
          case "require_approval":
            violations.push(action.message);
            actions.push(action);
            break;
          default:
            actions.push(action);
        }
      }

      return {
        valid: violations.length === 0,
        violations,
        warnings,
        actions,
      };
    } catch (error) {
      this.logger.error("Failed to evaluate single rule", {
        error: error instanceof Error ? error.message : "Unknown error",
        ruleId: rule.id,
        ruleName: rule.name,
      });

      return {
        valid: false,
        violations: [`Rule evaluation failed: ${rule.name}`],
        warnings: [],
        actions: [],
      };
    }
  }

  /**
   * Evaluates rule conditions
   * @param conditions - Rule conditions to evaluate
   * @param context - Rule evaluation context
   * @returns True if all conditions are met
   * @private
   */
  private evaluateConditions(
    conditions: readonly RuleCondition[],
    context: RuleContext,
  ): boolean {
    if (conditions.length === 0) {
      return true;
    }

    let result = true;
    let currentOperator: "AND" | "OR" = "AND";

    for (const condition of conditions) {
      const conditionResult = this.evaluateCondition(condition, context);

      if (currentOperator === "AND") {
        result = result && conditionResult;
      } else {
        result = result || conditionResult;
      }

      currentOperator = condition.operator || "AND";
    }

    return result;
  }

  /**
   * Evaluates a single condition
   * @param condition - Condition to evaluate
   * @param context - Rule evaluation context
   * @returns True if condition is met
   * @private
   */
  private evaluateCondition(
    condition: RuleCondition,
    context: RuleContext,
  ): boolean {
    try {
      const fieldValue = this.getFieldValue(condition.field, context);

      switch (condition.type) {
        case "equals":
          return fieldValue === condition.value;
        case "not_equals":
          return fieldValue !== condition.value;
        case "greater_than":
          return (
            typeof fieldValue === "number" &&
            typeof condition.value === "number" &&
            fieldValue > condition.value
          );
        case "less_than":
          return (
            typeof fieldValue === "number" &&
            typeof condition.value === "number" &&
            fieldValue < condition.value
          );
        case "contains":
          return (
            typeof fieldValue === "string" &&
            typeof condition.value === "string" &&
            fieldValue.includes(condition.value)
          );
        case "not_contains":
          return (
            typeof fieldValue === "string" &&
            typeof condition.value === "string" &&
            !fieldValue.includes(condition.value)
          );
        case "is_empty":
          return (
            fieldValue === null || fieldValue === undefined || fieldValue === ""
          );
        case "is_not_empty":
          return (
            fieldValue !== null && fieldValue !== undefined && fieldValue !== ""
          );
        case "custom":
          // Custom condition evaluation would go here
          return true;
        default:
          this.logger.warn(`Unknown condition type: ${condition.type}`);
          return false;
      }
    } catch (error) {
      this.logger.error("Failed to evaluate condition", {
        error: error instanceof Error ? error.message : "Unknown error",
        conditionType: condition.type,
        field: condition.field,
      });
      return false;
    }
  }

  /**
   * Gets field value from context using dot notation
   * @param fieldPath - Field path (e.g., "data.appointment.time")
   * @param context - Rule evaluation context
   * @returns Field value
   * @private
   */
  private getFieldValue(fieldPath: string, context: RuleContext): unknown {
    const parts = fieldPath.split(".");
    let current: unknown = context;

    for (const part of parts) {
      if (current && typeof current === "object" && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Updates evaluation statistics
   * @param totalRules - Number of rules evaluated
   * @param valid - Whether evaluation was valid
   * @param hasWarnings - Whether there were warnings
   * @param executionTime - Execution time in milliseconds
   * @private
   */
  private updateStats(
    totalRules: number,
    valid: boolean,
    hasWarnings: boolean,
    executionTime: number,
  ): void {
    this.evaluationStats.totalRules += totalRules;

    if (valid) {
      this.evaluationStats.passedRules += totalRules;
    } else {
      this.evaluationStats.failedRules += totalRules;
    }

    if (hasWarnings) {
      this.evaluationStats.warningRules += totalRules;
    }

    // Update average execution time
    const totalEvaluations = this.evaluationStats.totalRules;
    this.evaluationStats.averageExecutionTime =
      (this.evaluationStats.averageExecutionTime *
        (totalEvaluations - totalRules) +
        executionTime) /
      totalEvaluations;
  }

  /**
   * Validates appointment creation rules
   * @param context - Rule evaluation context
   * @returns Rule evaluation result
   */
  validateCreationRules(context: RuleContext): RuleResult {
    return this.evaluateRules(context, "appointment_creation");
  }

  /**
   * Validates appointment update rules
   * @param context - Rule evaluation context
   * @returns Rule evaluation result
   */
  validateUpdateRules(context: RuleContext): RuleResult {
    return this.evaluateRules(context, "appointment_update");
  }

  /**
   * Validates appointment cancellation rules
   * @param context - Rule evaluation context
   * @returns Rule evaluation result
   */
  validateCancellationRules(context: RuleContext): RuleResult {
    return this.evaluateRules(context, "appointment_cancellation");
  }

  /**
   * Validates user access rules
   * @param context - Rule evaluation context
   * @returns Rule evaluation result
   */
  validateAccessRules(context: RuleContext): RuleResult {
    return this.evaluateRules(context, "user_access");
  }

  /**
   * Validates data integrity rules
   * @param context - Rule evaluation context
   * @returns Rule evaluation result
   */
  validateDataIntegrityRules(context: RuleContext): RuleResult {
    return this.evaluateRules(context, "data_integrity");
  }

  /**
   * Gets evaluation statistics
   * @returns Current evaluation statistics
   */
  getEvaluationStats(): RuleStats {
    return { ...this.evaluationStats };
  }

  /**
   * Resets evaluation statistics
   */
  resetStats(): void {
    this.evaluationStats.totalRules = 0;
    this.evaluationStats.passedRules = 0;
    this.evaluationStats.failedRules = 0;
    this.evaluationStats.warningRules = 0;
    this.evaluationStats.averageExecutionTime = 0;
  }

  /**
   * Gets rule by ID
   * @param ruleId - Rule ID
   * @returns Business rule or undefined if not found
   */
  getRule(ruleId: string): BusinessRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Checks if a rule exists
   * @param ruleId - Rule ID
   * @returns True if rule exists
   */
  hasRule(ruleId: string): boolean {
    return this.rules.has(ruleId);
  }

  /**
   * Gets total number of registered rules
   * @returns Number of registered rules
   */
  getRuleCount(): number {
    return this.rules.size;
  }
}
