/**
 * Business rule builder utility
 *
 * Provides a fluent API for creating business rules with proper type safety
 * and validation. This utility makes it easier to create complex business rules
 * without manually constructing the rule objects.
 *
 * @module RuleBuilder
 */

import type {
  BusinessRule,
  RuleCondition,
  RuleAction,
  RuleCategory,
  RuleSeverity,
  RuleConditionType,
  RuleActionType,
} from "../types/business-rules.types";

/**
 * Rule builder class for creating business rules
 * @class RuleBuilder
 */
export class RuleBuilder {
  private rule: Partial<BusinessRule> & {
    description?: string;
    priority?: number;
    category?: RuleCategory;
    version?: string;
    tags?: readonly string[];
    isActive?: boolean;
    conditions?: RuleCondition[];
    actions?: RuleAction[];
  } = {};

  /**
   * Creates a new rule builder instance
   * @param id - Unique rule identifier
   * @param name - Rule name
   * @returns New rule builder instance
   */
  static create(id: string, name: string): RuleBuilder {
    const builder = new RuleBuilder();
    builder.rule = {
      id,
      name,
      isActive: true,
      priority: 0,
      conditions: [],
      actions: [],
      category: "custom",
      version: "1.0.0",
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
    };
    return builder;
  }

  /**
   * Sets the rule description
   * @param description - Rule description
   * @returns Rule builder instance
   */
  withDescription(description: string): RuleBuilder {
    this.rule.description = description;
    return this;
  }

  /**
   * Sets the rule priority
   * @param priority - Rule priority (higher number = higher priority)
   * @returns Rule builder instance
   */
  withPriority(priority: number): RuleBuilder {
    this.rule.priority = priority;
    return this;
  }

  /**
   * Sets the rule category
   * @param category - Rule category
   * @returns Rule builder instance
   */
  withCategory(category: RuleCategory): RuleBuilder {
    this.rule.category = category;
    return this;
  }

  /**
   * Sets the rule version
   * @param version - Rule version
   * @returns Rule builder instance
   */
  withVersion(version: string): RuleBuilder {
    this.rule.version = version;
    return this;
  }

  /**
   * Sets the rule tags
   * @param tags - Rule tags
   * @returns Rule builder instance
   */
  withTags(tags: readonly string[]): RuleBuilder {
    this.rule.tags = tags;
    return this;
  }

  /**
   * Sets whether the rule is active
   * @param isActive - Whether the rule is active
   * @returns Rule builder instance
   */
  withActiveStatus(isActive: boolean): RuleBuilder {
    this.rule.isActive = isActive;
    return this;
  }

  /**
   * Adds a condition to the rule
   * @param condition - Rule condition
   * @returns Rule builder instance
   */
  withCondition(condition: RuleCondition): RuleBuilder {
    if (!this.rule.conditions) {
      this.rule.conditions = [];
    }
    this.rule.conditions = [...this.rule.conditions, condition];
    return this;
  }

  /**
   * Adds multiple conditions to the rule
   * @param conditions - Rule conditions
   * @returns Rule builder instance
   */
  withConditions(conditions: readonly RuleCondition[]): RuleBuilder {
    if (!this.rule.conditions) {
      this.rule.conditions = [];
    }
    this.rule.conditions = [...this.rule.conditions, ...conditions];
    return this;
  }

  /**
   * Adds an action to the rule
   * @param action - Rule action
   * @returns Rule builder instance
   */
  withAction(action: RuleAction): RuleBuilder {
    if (!this.rule.actions) {
      this.rule.actions = [];
    }
    this.rule.actions = [...this.rule.actions, action];
    return this;
  }

  /**
   * Adds multiple actions to the rule
   * @param actions - Rule actions
   * @returns Rule builder instance
   */
  withActions(actions: readonly RuleAction[]): RuleBuilder {
    if (!this.rule.actions) {
      this.rule.actions = [];
    }
    this.rule.actions = [...this.rule.actions, ...actions];
    return this;
  }

  /**
   * Builds the final business rule
   * @returns Complete business rule
   * @throws Error if required fields are missing
   */
  build(): BusinessRule {
    this.validateRule();
    return this.rule as BusinessRule;
  }

  /**
   * Validates the rule before building
   * @private
   * @throws Error if validation fails
   */
  private validateRule(): void {
    if (!this.rule.id) {
      throw new Error("Rule ID is required");
    }
    if (!this.rule.name) {
      throw new Error("Rule name is required");
    }
    if (!this.rule.description) {
      throw new Error("Rule description is required");
    }
    if (this.rule.conditions?.length === 0) {
      throw new Error("At least one condition is required");
    }
    if (this.rule.actions?.length === 0) {
      throw new Error("At least one action is required");
    }
  }
}

/**
 * Condition builder for creating rule conditions
 * @class ConditionBuilder
 */
export class ConditionBuilder {
  private condition: Partial<RuleCondition> & {
    operator?: "AND" | "OR";
    customFunction?: string;
  } = {};

  /**
   * Creates a new condition builder
   * @param type - Condition type
   * @param field - Field path
   * @param value - Expected value
   * @returns New condition builder instance
   */
  static create(
    type: RuleConditionType,
    field: string,
    value: unknown,
  ): ConditionBuilder {
    const builder = new ConditionBuilder();
    builder.condition = {
      type,
      field,
      value,
      operator: "AND",
    };
    return builder;
  }

  /**
   * Sets the logical operator
   * @param operator - Logical operator
   * @returns Condition builder instance
   */
  withOperator(operator: "AND" | "OR"): ConditionBuilder {
    this.condition.operator = operator;
    return this;
  }

  /**
   * Sets a custom function for the condition
   * @param customFunction - Custom function name
   * @returns Condition builder instance
   */
  withCustomFunction(customFunction: string): ConditionBuilder {
    this.condition.customFunction = customFunction;
    return this;
  }

  /**
   * Builds the condition
   * @returns Complete rule condition
   */
  build(): RuleCondition {
    return this.condition as RuleCondition;
  }
}

/**
 * Action builder for creating rule actions
 * @class ActionBuilder
 */
export class ActionBuilder {
  private action: Partial<RuleAction> & {
    parameters?: Record<string, unknown>;
    customFunction?: string;
  } = {};

  /**
   * Creates a new action builder
   * @param type - Action type
   * @param message - Action message
   * @param severity - Action severity
   * @returns New action builder instance
   */
  static create(
    type: RuleActionType,
    message: string,
    severity: RuleSeverity,
  ): ActionBuilder {
    const builder = new ActionBuilder();
    builder.action = {
      type,
      message,
      severity,
    };
    return builder;
  }

  /**
   * Sets action parameters
   * @param parameters - Action parameters
   * @returns Action builder instance
   */
  withParameters(parameters: Record<string, unknown>): ActionBuilder {
    this.action.parameters = parameters;
    return this;
  }

  /**
   * Sets a custom function for the action
   * @param customFunction - Custom function name
   * @returns Action builder instance
   */
  withCustomFunction(customFunction: string): ActionBuilder {
    this.action.customFunction = customFunction;
    return this;
  }

  /**
   * Builds the action
   * @returns Complete rule action
   */
  build(): RuleAction {
    return this.action as RuleAction;
  }
}

/**
 * Utility functions for common rule patterns
 */
export class RulePatterns {
  /**
   * Creates a simple equals condition
   * @param field - Field path
   * @param value - Expected value
   * @returns Rule condition
   */
  static equals(field: string, value: unknown): RuleCondition {
    return ConditionBuilder.create("equals", field, value).build();
  }

  /**
   * Creates a not equals condition
   * @param field - Field path
   * @param value - Expected value
   * @returns Rule condition
   */
  static notEquals(field: string, value: unknown): RuleCondition {
    return ConditionBuilder.create("not_equals", field, value).build();
  }

  /**
   * Creates a greater than condition
   * @param field - Field path
   * @param value - Expected value
   * @returns Rule condition
   */
  static greaterThan(field: string, value: number): RuleCondition {
    return ConditionBuilder.create("greater_than", field, value).build();
  }

  /**
   * Creates a less than condition
   * @param field - Field path
   * @param value - Expected value
   * @returns Rule condition
   */
  static lessThan(field: string, value: number): RuleCondition {
    return ConditionBuilder.create("less_than", field, value).build();
  }

  /**
   * Creates a contains condition
   * @param field - Field path
   * @param value - Expected value
   * @returns Rule condition
   */
  static contains(field: string, value: string): RuleCondition {
    return ConditionBuilder.create("contains", field, value).build();
  }

  /**
   * Creates an is empty condition
   * @param field - Field path
   * @returns Rule condition
   */
  static isEmpty(field: string): RuleCondition {
    return ConditionBuilder.create("is_empty", field, null).build();
  }

  /**
   * Creates an is not empty condition
   * @param field - Field path
   * @returns Rule condition
   */
  static isNotEmpty(field: string): RuleCondition {
    return ConditionBuilder.create("is_not_empty", field, null).build();
  }

  /**
   * Creates a block action
   * @param message - Block message
   * @param severity - Action severity
   * @returns Rule action
   */
  static block(message: string, severity: RuleSeverity = "high"): RuleAction {
    return ActionBuilder.create("block", message, severity).build();
  }

  /**
   * Creates a warning action
   * @param message - Warning message
   * @param severity - Action severity
   * @returns Rule action
   */
  static warn(message: string, severity: RuleSeverity = "medium"): RuleAction {
    return ActionBuilder.create("warn", message, severity).build();
  }

  /**
   * Creates a log action
   * @param message - Log message
   * @param severity - Action severity
   * @returns Rule action
   */
  static log(message: string, severity: RuleSeverity = "low"): RuleAction {
    return ActionBuilder.create("log", message, severity).build();
  }

  /**
   * Creates a notification action
   * @param message - Notification message
   * @param severity - Action severity
   * @returns Rule action
   */
  static notify(
    message: string,
    severity: RuleSeverity = "medium",
  ): RuleAction {
    return ActionBuilder.create("notify", message, severity).build();
  }
}
