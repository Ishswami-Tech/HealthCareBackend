/**
 * Core decorators module exports
 *
 * This module provides comprehensive decorators for the healthcare backend application:
 * - Authentication and authorization decorators
 * - Clinic-specific route decorators
 * - Role-based access control decorators
 * - Permission-based access control decorators
 * - Public route decorators
 * - Validation decorators
 * - Rate limiting decorators
 * - Caching decorators
 *
 * @module CoreDecorators
 */

// Authentication and authorization decorators
export * from "./public.decorator";
export * from "./roles.decorator";
export * from "./permissions.decorator";

// Clinic-specific decorators
export * from "./clinic.decorator";
export * from "./clinic-route.decorator";

// Validation decorators
export * from "./validation.decorator";

// Performance and security decorators
export * from "./rate-limit.decorator";
export * from "./cache.decorator";
