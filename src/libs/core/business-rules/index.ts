/**
 * Business rules module exports
 *
 * This module provides a comprehensive business rules engine for healthcare operations:
 * - Rule registration and management
 * - Rule evaluation and validation
 * - Support for multiple rule types and conditions
 * - Statistics and monitoring capabilities
 * - Integration with appointment, user access, and data integrity workflows
 * - Rule building utilities and validation services
 *
 * @module BusinessRules
 */

// Core services
export * from "./business-rules-engine.service";
export * from "./services/rule-validation.service";

// Types
export * from "./types/business-rules.types";

// Utilities
export * from "./utils/rule-builder.util";
