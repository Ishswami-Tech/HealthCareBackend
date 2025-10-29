/**
 * Business rule validation service
 *
 * Provides validation utilities for business rules, ensuring they are properly
 * configured and can be safely executed. This service helps maintain rule
 * integrity and prevents runtime errors.
 *
 * @module RuleValidationService
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  BusinessRule,
  RuleCondition,
  RuleAction,
  RuleContext,
  ValidationResult,
  RuleConditionType,
  RuleActionType,
} from "../types/business-rules.types";

/**
 * Business rule validation service
 *
 * @class RuleValidationService
 */
@Injectable()
export class RuleValidationService {
  private readonly logger = new Logger(RuleValidationService.name);

  /**
   * Validates a business rule
   * @param rule - Business rule to validate
   * @returns Validation result
   */
  validateRule(rule: BusinessRule): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    try {
      // Validate basic rule properties
      this.validateBasicProperties(rule, errors, warnings, suggestions);

      // Validate conditions
      this.validateConditions(rule.conditions, errors, warnings, suggestions);

      // Validate actions
      this.validateActions(rule.actions, errors, warnings, suggestions);

      // Validate rule consistency
      this.validateRuleConsistency(rule, errors, warnings, suggestions);

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        suggestions,
        metadata: {
          validatedAt: new Date(),
          validatedBy: "RuleValidationService",
          validationDuration: 0, // Could be measured if needed
        },
      };
    } catch (error) {
      this.logger.error("Rule validation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        ruleId: rule.id,
      });

      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : "Validation failed"],
        warnings: [],
        suggestions: [],
        metadata: {
          validatedAt: new Date(),
          validatedBy: "RuleValidationService",
          validationDuration: 0,
        },
      };
    }
  }

  /**
   * Validates basic rule properties
   * @param rule - Business rule
   * @param errors - Error collection
   * @param warnings - Warning collection
   * @param suggestions - Suggestion collection
   * @private
   */
  private validateBasicProperties(
    rule: BusinessRule,
    errors: string[],
    warnings: string[],
    suggestions: string[],
  ): void {
    // Validate ID
    if (!rule.id || rule.id.trim().length === 0) {
      errors.push("Rule ID is required and cannot be empty");
    } else if (!/^[a-zA-Z0-9_-]+$/.test(rule.id)) {
      errors.push(
        "Rule ID must contain only alphanumeric characters, underscores, and hyphens",
      );
    }

    // Validate name
    if (!rule.name || rule.name.trim().length === 0) {
      errors.push("Rule name is required and cannot be empty");
    } else if (rule.name.length > 100) {
      warnings.push(
        "Rule name is longer than 100 characters, consider shortening it",
      );
    }

    // Validate description
    if (!rule.description || rule.description.trim().length === 0) {
      errors.push("Rule description is required and cannot be empty");
    } else if (rule.description.length < 10) {
      warnings.push(
        "Rule description is very short, consider adding more details",
      );
    }

    // Validate priority
    if (typeof rule.priority !== "number" || rule.priority < 0) {
      errors.push("Rule priority must be a non-negative number");
    } else if (rule.priority > 1000) {
      warnings.push("Rule priority is very high, ensure this is intentional");
    }

    // Validate category
    if (!rule.category || rule.category.trim().length === 0) {
      errors.push("Rule category is required");
    }

    // Validate version
    if (!rule.version || rule.version.trim().length === 0) {
      errors.push("Rule version is required");
    } else if (!/^\d+\.\d+\.\d+$/.test(rule.version)) {
      warnings.push(
        "Rule version should follow semantic versioning (e.g., 1.0.0)",
      );
    }

    // Validate dates
    if (!rule.createdAt || !(rule.createdAt instanceof Date)) {
      errors.push("Rule creation date is required and must be a valid Date");
    }

    if (!rule.updatedAt || !(rule.updatedAt instanceof Date)) {
      errors.push("Rule update date is required and must be a valid Date");
    }

    if (rule.updatedAt && rule.createdAt && rule.updatedAt < rule.createdAt) {
      errors.push("Rule update date cannot be earlier than creation date");
    }

    // Validate tags
    if (!Array.isArray(rule.tags)) {
      errors.push("Rule tags must be an array");
    } else if (rule.tags.length === 0) {
      suggestions.push("Consider adding tags to improve rule categorization");
    }
  }

  /**
   * Validates rule conditions
   * @param conditions - Rule conditions
   * @param errors - Error collection
   * @param warnings - Warning collection
   * @param suggestions - Suggestion collection
   * @private
   */
  private validateConditions(
    conditions: readonly RuleCondition[],
    errors: string[],
    warnings: string[],
    suggestions: string[],
  ): void {
    if (!conditions || conditions.length === 0) {
      errors.push("At least one condition is required");
      return;
    }

    if (conditions.length > 20) {
      warnings.push(
        "Rule has many conditions, consider breaking it into smaller rules",
      );
    }

    conditions.forEach((condition, index) => {
      this.validateCondition(condition, index, errors, warnings, suggestions);
    });
  }

  /**
   * Validates a single condition
   * @param condition - Rule condition
   * @param index - Condition index
   * @param errors - Error collection
   * @param warnings - Warning collection
   * @param suggestions - Suggestion collection
   * @private
   */
  private validateCondition(
    condition: RuleCondition,
    index: number,
    errors: string[],
    warnings: string[],
    suggestions: string[],
  ): void {
    const prefix = `Condition ${index + 1}:`;

    // Validate condition type
    if (!condition.type || !this.isValidConditionType(condition.type)) {
      errors.push(
        `${prefix} Invalid condition type: ${String(condition.type)}`,
      );
    }

    // Validate field
    if (!condition.field || condition.field.trim().length === 0) {
      errors.push(`${prefix} Field is required and cannot be empty`);
    } else if (!/^[a-zA-Z0-9._-]+$/.test(condition.field)) {
      errors.push(
        `${prefix} Field must contain only alphanumeric characters, dots, underscores, and hyphens`,
      );
    }

    // Validate value based on condition type
    this.validateConditionValue(
      condition,
      prefix,
      errors,
      warnings,
      suggestions,
    );

    // Validate operator
    if (condition.operator && !["AND", "OR"].includes(condition.operator)) {
      errors.push(`${prefix} Operator must be 'AND' or 'OR'`);
    }

    // Validate custom function
    if (condition.customFunction && condition.type !== "custom") {
      warnings.push(
        `${prefix} Custom function is specified but condition type is not 'custom'`,
      );
    }
  }

  /**
   * Validates condition value based on type
   * @param condition - Rule condition
   * @param prefix - Error prefix
   * @param errors - Error collection
   * @param warnings - Warning collection
   * @param suggestions - Suggestion collection
   * @private
   */
  private validateConditionValue(
    condition: RuleCondition,
    prefix: string,
    errors: string[],
    warnings: string[],
    _suggestions: string[],
  ): void {
    switch (condition.type) {
      case "greater_than":
      case "less_than":
        if (typeof condition.value !== "number") {
          errors.push(
            `${prefix} Value must be a number for ${condition.type} condition`,
          );
        }
        break;

      case "contains":
      case "not_contains":
        if (typeof condition.value !== "string") {
          errors.push(
            `${prefix} Value must be a string for ${condition.type} condition`,
          );
        }
        break;

      case "is_empty":
      case "is_not_empty":
        if (condition.value !== null && condition.value !== undefined) {
          warnings.push(
            `${prefix} Value should be null or undefined for ${condition.type} condition`,
          );
        }
        break;

      case "custom":
        if (!condition.customFunction) {
          errors.push(
            `${prefix} Custom function is required for custom condition type`,
          );
        }
        break;

      default:
        // For equals, not_equals, in_range - value can be any type
        break;
    }
  }

  /**
   * Validates rule actions
   * @param actions - Rule actions
   * @param errors - Error collection
   * @param warnings - Warning collection
   * @param suggestions - Suggestion collection
   * @private
   */
  private validateActions(
    actions: readonly RuleAction[],
    errors: string[],
    warnings: string[],
    suggestions: string[],
  ): void {
    if (!actions || actions.length === 0) {
      errors.push("At least one action is required");
      return;
    }

    if (actions.length > 10) {
      warnings.push(
        "Rule has many actions, consider breaking it into smaller rules",
      );
    }

    actions.forEach((action, index) => {
      this.validateAction(action, index, errors, warnings, suggestions);
    });
  }

  /**
   * Validates a single action
   * @param action - Rule action
   * @param index - Action index
   * @param errors - Error collection
   * @param warnings - Warning collection
   * @param suggestions - Suggestion collection
   * @private
   */
  private validateAction(
    action: RuleAction,
    index: number,
    errors: string[],
    warnings: string[],
    _suggestions: string[],
  ): void {
    const prefix = `Action ${index + 1}:`;

    // Validate action type
    if (!action.type || !this.isValidActionType(action.type)) {
      errors.push(`${prefix} Invalid action type: ${String(action.type)}`);
    }

    // Validate message
    if (!action.message || action.message.trim().length === 0) {
      errors.push(`${prefix} Message is required and cannot be empty`);
    } else if (action.message.length > 500) {
      warnings.push(
        `${prefix} Message is longer than 500 characters, consider shortening it`,
      );
    }

    // Validate severity
    if (!action.severity || !this.isValidSeverity(action.severity)) {
      errors.push(`${prefix} Invalid severity: ${action.severity}`);
    }

    // Validate custom function
    if (action.customFunction && action.type !== "custom") {
      warnings.push(
        `${prefix} Custom function is specified but action type is not 'custom'`,
      );
    }

    // Validate parameters
    if (action.parameters && typeof action.parameters !== "object") {
      errors.push(`${prefix} Parameters must be an object`);
    }
  }

  /**
   * Validates rule consistency
   * @param rule - Business rule
   * @param errors - Error collection
   * @param warnings - Warning collection
   * @param suggestions - Suggestion collection
   * @private
   */
  private validateRuleConsistency(
    rule: BusinessRule,
    errors: string[],
    warnings: string[],
    suggestions: string[],
  ): void {
    // Check for conflicting actions
    const hasBlockAction = rule.actions.some(
      (action) => action.type === "block",
    );
    const hasAllowAction = rule.actions.some(
      (action) => action.type === "allow",
    );

    if (hasBlockAction && hasAllowAction) {
      warnings.push(
        "Rule has both block and allow actions, which may be conflicting",
      );
    }

    // Check for high priority rules without critical actions
    if (rule.priority > 500) {
      const hasCriticalAction = rule.actions.some(
        (action) => action.severity === "critical",
      );
      if (!hasCriticalAction) {
        suggestions.push(
          "High priority rule should have critical severity actions",
        );
      }
    }

    // Check for inactive rules
    if (!rule.isActive) {
      suggestions.push(
        "Rule is inactive, consider removing it if no longer needed",
      );
    }
  }

  /**
   * Validates a rule context
   * @param context - Rule context
   * @returns Validation result
   */
  validateContext(context: RuleContext): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    try {
      // Validate user ID
      if (!context.userId || context.userId.trim().length === 0) {
        errors.push("User ID is required in rule context");
      }

      // Validate data
      if (!context.data || typeof context.data !== "object") {
        errors.push("Context data must be an object");
      }

      // Validate metadata if present
      if (context.metadata) {
        this.validateContextMetadata(
          context.metadata,
          errors,
          warnings,
          suggestions,
        );
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        suggestions,
        metadata: {
          validatedAt: new Date(),
          validatedBy: "RuleValidationService",
          validationDuration: 0,
        },
      };
    } catch (error) {
      this.logger.error("Context validation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: context.userId,
      });

      return {
        isValid: false,
        errors: [
          error instanceof Error ? error.message : "Context validation failed",
        ],
        warnings: [],
        suggestions: [],
        metadata: {
          validatedAt: new Date(),
          validatedBy: "RuleValidationService",
          validationDuration: 0,
        },
      };
    }
  }

  /**
   * Validates context metadata
   * @param metadata - Context metadata
   * @param errors - Error collection
   * @param warnings - Warning collection
   * @param suggestions - Suggestion collection
   * @private
   */
  private validateContextMetadata(
    metadata: NonNullable<RuleContext["metadata"]>,
    errors: string[],
    _warnings: string[],
    _suggestions: string[],
  ): void {
    // Validate user role
    if (metadata.userRole && typeof metadata.userRole !== "string") {
      errors.push("User role must be a string");
    }

    // Validate user permissions
    if (metadata.userPermissions && !Array.isArray(metadata.userPermissions)) {
      errors.push("User permissions must be an array");
    }

    // Validate request source
    if (metadata.requestSource && typeof metadata.requestSource !== "string") {
      errors.push("Request source must be a string");
    }

    // Validate timestamp
    if (metadata.timestamp && !(metadata.timestamp instanceof Date)) {
      errors.push("Timestamp must be a valid Date");
    }
  }

  /**
   * Checks if condition type is valid
   * @param type - Condition type
   * @returns True if valid
   * @private
   */
  private isValidConditionType(type: string): type is RuleConditionType {
    const validTypes: RuleConditionType[] = [
      "equals",
      "not_equals",
      "greater_than",
      "less_than",
      "contains",
      "not_contains",
      "in_range",
      "is_empty",
      "is_not_empty",
      "custom",
    ];
    return validTypes.includes(type as RuleConditionType);
  }

  /**
   * Checks if action type is valid
   * @param type - Action type
   * @returns True if valid
   * @private
   */
  private isValidActionType(type: string): type is RuleActionType {
    const validTypes: RuleActionType[] = [
      "block",
      "allow",
      "warn",
      "log",
      "notify",
      "auto_correct",
      "require_approval",
      "custom",
    ];
    return validTypes.includes(type as RuleActionType);
  }

  /**
   * Checks if severity is valid
   * @param severity - Severity level
   * @returns True if valid
   * @private
   */
  private isValidSeverity(severity: string): boolean {
    const validSeverities = ["low", "medium", "high", "critical"];
    return validSeverities.includes(severity);
  }
}
