# Healthcare Backend - ConfigService Error Analysis

## 🔴 Current Issue

**Error Message:** `Cannot read properties of undefined (reading 'get')`

**Location:** Health endpoint (`/health`) is failing with 500 error

**Impact:** 
- Kubernetes startup probes are failing
- Pods are stuck in `Running` but not `Ready` state
- Health endpoint returns 500 instead of 200 OK
- Application cannot be accessed via NodePort

## 🔍 Root Cause Analysis

The error occurs when a service tries to call `.get()` on `configService`, but `configService` is `undefined`. This happens during:

1. **Health Check Execution** - When `/health` endpoint is called, it checks multiple services
2. **Service Initialization** - Some services use ConfigService during `onModuleInit()`
3. **Queue Health Check** - The health check calls `getLocationQueueStats()` which may trigger auto-scaling

## 🎯 Potential Sources

Based on the error pattern and code analysis, the issue is likely in one of these places:

### 1. **EmailService.onModuleInit()** ✅ FIXED
- **File:** `src/libs/communication/messaging/email/email.service.ts`
- **Line:** ~69-76
- **Issue:** Calls `this.configService.get('EMAIL_PROVIDER')` without checking if configService exists
- **Status:** Fixed with optional chaining and try-catch

### 2. **EmailService.initSMTP()** ✅ FIXED
- **File:** `src/libs/communication/messaging/email/email.service.ts`
- **Line:** ~84
- **Issue:** Calls `this.configService.get<EmailConfig>('email')` without defensive checks
- **Status:** Fixed with optional chaining and process.env fallback

### 3. **EmailService.initAPI()** ✅ FIXED
- **File:** `src/libs/communication/messaging/email/email.service.ts`
- **Line:** ~134
- **Issue:** Calls `this.configService.get<string>('MAILTRAP_API_TOKEN')` without defensive checks
- **Status:** Fixed with optional chaining and process.env fallback

### 4. **EmailService.sendViaSMTP()** ✅ FIXED
- **File:** `src/libs/communication/messaging/email/email.service.ts`
- **Line:** ~217
- **Issue:** Calls `this.configService.get<EmailConfig>('email')` without defensive checks
- **Status:** Fixed with optional chaining and process.env fallback

### 5. **QueueService.scaleUpWorkers()** ✅ FIXED
- **File:** `src/libs/infrastructure/queue/src/queue.service.ts`
- **Line:** ~1470-1471
- **Issue:** Calls `this.configService.get()` for Redis connection without optional chaining
- **Status:** Fixed with optional chaining and process.env fallback

### 6. **QueueService.autoScaleWorkers()** ✅ FIXED
- **File:** `src/libs/infrastructure/queue/src/queue.service.ts`
- **Line:** ~1429
- **Issue:** May trigger scaleUpWorkers which uses ConfigService
- **Status:** Added ConfigService check before auto-scaling

## 🔧 How to Debug Further

If the error persists after these fixes, check:

1. **Check for other ConfigService usages:**
   ```bash
   grep -r "configService\.get\|this\.configService\.get" src/ --include="*.ts"
   ```

2. **Enable detailed error logging:**
   - The error logs should now show stack traces with the new error handling
   - Check which service is throwing the error

3. **Check dependency injection:**
   - Ensure ConfigModule is properly imported in all modules
   - Verify ConfigService is injected correctly in constructors

4. **Check module initialization order:**
   - Some services might be initialized before ConfigService is ready
   - Use `OnModuleInit` lifecycle hooks properly

## 📋 Files Modified

1. ✅ `src/libs/communication/messaging/email/email.service.ts`
   - Added optional chaining to all `configService.get()` calls
   - Added process.env fallbacks
   - Added try-catch in `onModuleInit()`
   - Fixed `initSMTP()`, `initAPI()`, and `sendViaSMTP()`

2. ✅ `src/libs/communication/messaging/whatsapp/whatsapp.config.ts`
   - Added `getConfig()` helper with defensive checks

3. ✅ `src/libs/infrastructure/queue/src/queue.service.ts`
   - Fixed `scaleUpWorkers()` to use optional chaining
   - Added ConfigService check in `autoScaleWorkers()`
   - Enhanced error handling in `getLocationQueueStats()`

4. ✅ `src/services/health/health.service.ts`
   - Enhanced error handling in `checkQueueHealth()`
   - Added timeout protection
   - Better error logging

5. ✅ `src/main.ts`
   - Made global prefix configurable via `API_PREFIX` env var
   - Fixed rate limit Redis config to use optional chaining
   - Fixed Redis adapter config to use optional chaining

6. ✅ `src/services/auth/core/jwt.service.ts`
   - Fixed `generateAccessToken()` to use optional chaining
   - Fixed `generateRefreshToken()` to use optional chaining

## 🚀 Next Steps

1. **Rebuild the Docker image** with all fixes
2. **Restart pods** to use the new image
3. **Monitor logs** for any remaining ConfigService errors
4. **Test health endpoint** - should return 200 OK even if some services are unhealthy
5. **Verify all endpoints** work via NodePort

## 💡 Key Learning

The issue is that **ConfigService might not be available** when services are initialized or when health checks run. Always use:
- Optional chaining: `this.configService?.get()`
- Try-catch blocks around ConfigService calls
- Process.env fallbacks: `process.env['KEY'] || defaultValue`
- Defensive checks: `if (!this.configService) return;`

