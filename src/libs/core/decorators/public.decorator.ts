import { SetMetadata } from '@nestjs/common';

/**
 * Public route metadata key
 */
export const IS_PUBLIC_KEY = 'isPublic' as const;

/**
 * Public decorator for marking routes that bypass authentication
 *
 * This decorator marks a route handler as public, meaning it bypasses
 * authentication and authorization checks. Use with caution and only
 * for routes that should be accessible without authentication.
 *
 * @returns Decorator function that sets public metadata
 *
 * @example
 * ```typescript
 * @Controller('auth')
 * export class AuthController {
 *   @Post('login')
 *   @Public()
 *   async login(@Body() loginDto: LoginDto) {
 *     // This route bypasses authentication
 *     return this.authService.login(loginDto);
 *   }
 * }
 * ```
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
