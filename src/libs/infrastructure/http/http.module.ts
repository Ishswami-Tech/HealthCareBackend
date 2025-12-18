/**
 * HTTP Module
 * @module HttpModule
 * @description Module for centralized HTTP service
 */

import { Module, Global } from '@nestjs/common';
import { HttpModule as NestHttpModule } from '@nestjs/axios';

import { HttpService } from './http.service';
import { LoggingModule } from '@infrastructure/logging';

/**
 * Global HTTP Module
 * Provides centralized HTTP service throughout the application
 *
 * @example
 * ```typescript
 * // Import in your module
 * import { HttpModule } from '@infrastructure/http';
 *
 * @Module({
 *   imports: [HttpModule],
 * })
 * export class MyModule {}
 * ```
 */
@Global()
@Module({
  imports: [
    NestHttpModule.register({
      timeout: 30000, // 30 seconds default timeout
      maxRedirects: 5,
    }),
    LoggingModule,
  ],
  providers: [HttpService],
  exports: [HttpService],
})
export class HttpModule {}
