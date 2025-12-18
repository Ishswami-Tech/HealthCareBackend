# HTTP Infrastructure Service

**Purpose:** Centralized HTTP service for making HTTP requests throughout the application  
**Location:** `src/libs/infrastructure/http`  
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { HttpService } from '@infrastructure/http';

@Injectable()
export class MyService {
  constructor(private readonly httpService: HttpService) {}

  async fetchData() {
    const response = await this.httpService.get<MyType>('https://api.example.com/data', {
      retries: 3,
      timeout: 5000,
    });
    return response.data;
  }
}
```

---

## Key Features

- ✅ **Automatic Error Handling** - All errors transformed to HealthcareError
- ✅ **Request/Response Logging** - Automatic logging with LoggingService
- ✅ **Retry Logic** - Configurable retries with exponential backoff
- ✅ **Type-Safe** - Full TypeScript support with generic types
- ✅ **Timeout Management** - Configurable timeouts per request
- ✅ **Health Check Support** - Built-in health check capabilities
- ✅ **SSL Support** - Automatic SSL verification skip in development

---

## API Reference

### Methods

#### `get<T>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>`

Make a GET request.

```typescript
const response = await this.httpService.get<User>('https://api.example.com/users/123');
console.log(response.data); // User object
console.log(response.status); // 200
console.log(response.requestDuration); // Request duration in ms
```

#### `post<T, D>(url: string, data?: D, options?: HttpRequestOptions): Promise<HttpResponse<T>>`

Make a POST request.

```typescript
const response = await this.httpService.post<CreateUserResponse, CreateUserDto>(
  'https://api.example.com/users',
  { name: 'John', email: 'john@example.com' },
  {
    headers: {
      'Authorization': 'Bearer token',
    },
  }
);
```

#### `put<T, D>(url: string, data?: D, options?: HttpRequestOptions): Promise<HttpResponse<T>>`

Make a PUT request.

#### `patch<T, D>(url: string, data?: D, options?: HttpRequestOptions): Promise<HttpResponse<T>>`

Make a PATCH request.

#### `delete<T>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>`

Make a DELETE request.

#### `head<T>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>`

Make a HEAD request.

---

## Request Options

The `HttpRequestOptions` interface extends `AxiosRequestConfig` and adds:

```typescript
interface HttpRequestOptions {
  // Retry configuration
  retries?: number;                    // Number of retry attempts (default: 0)
  retryDelay?: number;                 // Retry delay in ms (default: 1000)
  exponentialBackoff?: boolean;        // Use exponential backoff (default: true)
  shouldRetry?: (error: unknown) => boolean; // Custom retry condition

  // Logging
  logRequest?: boolean;                // Whether to log request (default: true)

  // Timeout
  timeout?: number;                    // Request timeout in ms

  // Headers
  headers?: Record<string, string>;     // Additional headers

  // All AxiosRequestConfig options are also available
  // (params, auth, validateStatus, etc.)
}
```

---

## Response Format

All methods return `HttpResponse<T>`:

```typescript
interface HttpResponse<T> {
  data: T;                              // Response data (typed)
  status: number;                       // HTTP status code
  statusText: string;                   // HTTP status text
  headers: Record<string, string>;      // Response headers
  config: AxiosRequestConfig;          // Request configuration
  requestDuration: number;              // Request duration in milliseconds
}
```

---

## Examples

### Basic GET Request

```typescript
const response = await this.httpService.get<User[]>('https://api.example.com/users');
const users = response.data; // User[]
```

### POST with Retry

```typescript
const response = await this.httpService.post<CreateResult, CreateDto>(
  'https://api.example.com/create',
  { name: 'Test' },
  {
    retries: 3,
    retryDelay: 1000,
    exponentialBackoff: true,
  }
);
```

### Request with Custom Headers

```typescript
const response = await this.httpService.get<Data>(
  'https://api.example.com/data',
  {
    headers: {
      'Authorization': 'Bearer token',
      'X-Custom-Header': 'value',
    },
    timeout: 5000,
  }
);
```

### Error Handling

```typescript
try {
  const response = await this.httpService.get<Data>('https://api.example.com/data');
  return response.data;
} catch (error) {
  // Error is automatically transformed to HealthcareError
  if (error instanceof HealthcareError) {
    console.error(error.code); // ErrorCode enum
    console.error(error.message);
    console.error(error.metadata); // Request details
  }
  throw error;
}
```

### Disable Logging for Specific Request

```typescript
const response = await this.httpService.get<Data>(
  'https://api.example.com/data',
  {
    logRequest: false, // Don't log this request
  }
);
```

---

## Retry Configuration

### Default Retry Behavior

By default, retries are disabled (`retries: 0`). To enable retries:

```typescript
const response = await this.httpService.get<Data>(
  'https://api.example.com/data',
  {
    retries: 3, // Retry up to 3 times
    retryDelay: 1000, // Wait 1 second between retries
    exponentialBackoff: true, // Use exponential backoff (1s, 2s, 4s, ...)
  }
);
```

### Custom Retry Condition

```typescript
const response = await this.httpService.get<Data>(
  'https://api.example.com/data',
  {
    retries: 3,
    shouldRetry: (error) => {
      // Only retry on 5xx errors
      if (error && typeof error === 'object' && 'response' in error) {
        const status = (error.response as { status?: number })?.status;
        return status !== undefined && status >= 500;
      }
      return false;
    },
  }
);
```

### Default Retry Logic

The default retry logic retries on:
- Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
- 5xx server errors

It does NOT retry on:
- 4xx client errors (400, 401, 403, 404, etc.)
- Validation errors

---

## SSL Configuration

The service automatically handles SSL verification in development:

```typescript
// In development, SSL verification is automatically skipped for self-signed certificates
// Use getHttpConfig() for custom SSL configuration
const config = this.httpService.getHttpConfig({
  url: 'https://self-signed-cert.example.com',
  // httpsAgent is automatically configured in development
});
```

---

## Health Check

```typescript
const isHealthy = await this.httpService.isHealthy();
// Returns true if HTTP service is available
```

---

## Configuration

Default values can be configured via `ConfigService`:

```typescript
// In your config
{
  http: {
    timeout: 30000,  // Default timeout in ms (30 seconds)
    retries: 0,      // Default retry count
  }
}
```

---

## Migration from @nestjs/axios

### Before (Direct HttpService)

```typescript
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const response = await firstValueFrom(
  this.httpService.get<Data>('https://api.example.com/data', {
    timeout: 5000,
  })
);
const data = response.data;
```

### After (Centralized HttpService)

```typescript
import { HttpService } from '@infrastructure/http';

const response = await this.httpService.get<Data>('https://api.example.com/data', {
  timeout: 5000,
});
const data = response.data;
```

**Benefits:**
- ✅ No need for `firstValueFrom` - methods return Promises directly
- ✅ Automatic error handling with HealthcareError
- ✅ Automatic logging
- ✅ Built-in retry support
- ✅ Consistent error format across the application

---

## Architecture

The HTTP service wraps NestJS `HttpService` (which wraps axios) to provide:

1. **Error Transformation** - All errors converted to HealthcareError
2. **Logging Integration** - Automatic request/response logging via LoggingService
3. **Retry Logic** - Configurable retries with exponential backoff using RxJS operators
4. **Type Safety** - Full TypeScript support with generic types

---

## Related Documentation

- [Core Types - HTTP Types](../../../core/types/http.types.ts)
- [Logging Service](../logging/README.md)
- [Error Handling](../../../core/errors/README.md)

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
