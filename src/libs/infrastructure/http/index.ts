/**
 * HTTP Infrastructure Module
 * @module HttpInfrastructure
 * @description Centralized HTTP service for making HTTP requests
 *
 * Provides a unified interface for HTTP requests with:
 * - Automatic error handling and transformation
 * - Request/response logging
 * - Retry logic with exponential backoff
 * - Type-safe responses
 * - Health check support
 *
 * @example
 * ```typescript
 * import { HttpService } from '@infrastructure/http';
 *
 * @Injectable()
 * export class MyService {
 *   constructor(private readonly httpService: HttpService) {}
 *
 *   async fetchData() {
 *     const response = await this.httpService.get<MyType>('https://api.example.com/data', {
 *       retries: 3,
 *       timeout: 5000,
 *     });
 *     return response.data;
 *   }
 * }
 * ```
 */

export { HttpService } from './http.service';
export { HttpModule } from './http.module';
// Re-export types from @core/types for convenience
export type { HttpRequestOptions, HttpResponse, RetryConfig } from '@core/types';
export { DEFAULT_RETRY_CONFIG } from '@core/types';
