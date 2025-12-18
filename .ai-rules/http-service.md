# HTTP Service Guidelines

**Purpose:** Centralized HTTP service for making HTTP requests throughout the application  
**Location:** `src/libs/infrastructure/http`  
**Status:** ✅ Production-ready

---

## 🎯 Key Principles

### **MANDATORY: Use Centralized HTTP Service**

- ✅ **ALWAYS** use `@infrastructure/http` `HttpService` for all HTTP requests
- ❌ **NEVER** use `@nestjs/axios` `HttpService` directly in application code
- ❌ **NEVER** use `fetch()`, `axios()`, or other HTTP clients directly
- ❌ **NEVER** use `firstValueFrom()` with NestJS HttpService - the centralized service returns Promises directly

### **Why Centralized HTTP Service?**

1. **Consistent Error Handling** - All errors automatically transformed to `HealthcareError`
2. **Automatic Logging** - Request/response logging via `LoggingService`
3. **Retry Logic** - Configurable retries with exponential backoff
4. **Type Safety** - Full TypeScript support with generic types
5. **SSL Support** - Automatic SSL verification skip in development
6. **Health Checks** - Built-in health check capabilities

---

## 📋 Import Guidelines

### ✅ Correct Import

```typescript
import { HttpService } from '@infrastructure/http';
import type { HttpRequestOptions, HttpResponse } from '@infrastructure/http';
```

### ❌ Incorrect Imports

```typescript
// ❌ DON'T: Direct NestJS HttpService
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// ❌ DON'T: Direct axios
import axios from 'axios';

// ❌ DON'T: Native fetch
const response = await fetch(url);
```

---

## 🔧 Usage Patterns

### Basic GET Request

```typescript
@Injectable()
export class MyService {
  constructor(private readonly httpService: HttpService) {}

  async fetchData() {
    const response = await this.httpService.get<User[]>('https://api.example.com/users');
    return response.data; // User[]
  }
}
```

### POST Request with Retry

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

---

## 🚨 Common Mistakes to Avoid

### ❌ Using firstValueFrom

```typescript
// ❌ DON'T: Using firstValueFrom
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const response = await firstValueFrom(this.httpService.get(url));
```

```typescript
// ✅ DO: Direct Promise from centralized service
import { HttpService } from '@infrastructure/http';

const response = await this.httpService.get(url);
```

### ❌ Direct Axios Usage

```typescript
// ❌ DON'T: Direct axios
import axios from 'axios';

const response = await axios.get(url);
```

```typescript
// ✅ DO: Use centralized service
const response = await this.httpService.get(url);
```

### ❌ Missing Error Handling

```typescript
// ❌ DON'T: No error handling
const response = await this.httpService.get(url);
return response.data;
```

```typescript
// ✅ DO: Proper error handling
try {
  const response = await this.httpService.get(url);
  return response.data;
} catch (error) {
  // Handle HealthcareError
  if (error instanceof HealthcareError) {
    // Log or handle appropriately
  }
  throw error;
}
```

---

## 📚 API Reference

### Methods

- `get<T>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>`
- `post<T, D>(url: string, data?: D, options?: HttpRequestOptions): Promise<HttpResponse<T>>`
- `put<T, D>(url: string, data?: D, options?: HttpRequestOptions): Promise<HttpResponse<T>>`
- `patch<T, D>(url: string, data?: D, options?: HttpRequestOptions): Promise<HttpResponse<T>>`
- `delete<T>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>`
- `head<T>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>`

### Request Options

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

### Response Format

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

## 🔄 Migration from @nestjs/axios

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

## 🏗️ Architecture

The HTTP service wraps NestJS `HttpService` (which wraps axios) to provide:

1. **Error Transformation** - All errors converted to HealthcareError
2. **Logging Integration** - Automatic request/response logging via LoggingService
3. **Retry Logic** - Configurable retries with exponential backoff using RxJS operators
4. **Type Safety** - Full TypeScript support with generic types

---

## 📖 Related Documentation

- [HTTP Service README](../../src/libs/infrastructure/http/README.md)
- [Core Types - HTTP Types](../../src/libs/core/types/http.types.ts)
- [Logging Service](../infrastructure/logging/README.md)
- [Error Handling](../../src/libs/core/errors/README.md)

---

## ✅ Checklist

When making HTTP requests, ensure:

- [ ] Using `@infrastructure/http` `HttpService`
- [ ] Not using `@nestjs/axios` directly
- [ ] Not using `firstValueFrom`
- [ ] Proper error handling with `HealthcareError`
- [ ] Appropriate retry configuration for critical requests
- [ ] Request/response logging enabled (default)
- [ ] Type-safe request/response types
- [ ] Proper timeout configuration
