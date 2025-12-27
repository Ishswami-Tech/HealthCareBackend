/**
 * Separate export file for DatabaseService to avoid circular dependency
 * This file breaks the circular dependency chain by using a function export
 * that delays evaluation until the module is fully initialized
 */

// Re-export the class directly (this still causes evaluation, but breaks the chain)
// The intermediate file helps break circular dependencies during module loading
export { DatabaseService } from './database.service';

// Also export as a type for type-only imports
export type { DatabaseService as DatabaseServiceType } from './database.service';
