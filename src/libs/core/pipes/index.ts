/**
 * Core Pipes Library
 *
 * Provides validation and transformation pipes for the healthcare application.
 * Includes enhanced validation with detailed error reporting and type safety.
 *
 * @module CorePipes
 * @description Comprehensive pipe system for data validation and transformation
 * @example
 * ```typescript
 * import { ValidationPipe } from '@libs/core/pipes';
 *
 * @Controller('users')
 * export class UsersController {
 *   @Post()
 *   @UsePipes(ValidationPipe)
 *   async createUser(@Body() dto: CreateUserDto) {
 *     // dto is automatically validated
 *   }
 * }
 * ```
 */

// Main validation pipe
export { ValidationPipe } from './validation.pipe';

// Re-export types for convenience
export type { ValidationPipe as ValidationPipeType } from './validation.pipe';
