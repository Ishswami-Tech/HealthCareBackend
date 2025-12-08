# Video Provider Integration Guide

## Overview

The video service now uses a **dual-provider pattern** similar to the cache service (Redis/Dragonfly):
- **OpenVidu** as primary provider (modern, AI-ready, custom domain)
- **Jitsi** as fallback provider (already working, reliable)

Both providers are available, but OpenVidu is used by default with automatic fallback to Jitsi if OpenVidu is unavailable.

---

## Architecture

### Provider Pattern (Similar to Cache Service)

```
VideoService (Main Entry Point - SINGLE SERVICE)
    ↓
VideoProviderFactory (Selects Provider)
    ↓
    ├─ OpenViduVideoProvider (Primary - like Dragonfly)
    └─ JitsiVideoProvider (Fallback - like Redis)
```

### Key Components

1. **`IVideoProvider`** - Interface for video providers
2. **`OpenViduVideoProvider`** - Primary provider implementation
3. **`JitsiVideoProvider`** - Fallback provider implementation
4. **`VideoProviderFactory`** - Factory for provider selection
5. **`VideoService`** - Single consolidated service using factory pattern (includes all methods)
6. **`video.config.ts`** - Configuration (similar to `cache.config.ts`)

---

## Configuration

### Environment Variables

```env
# Video Configuration
VIDEO_ENABLED=true
VIDEO_PROVIDER=openvidu  # 'openvidu' (primary) or 'jitsi' (fallback)

# OpenVidu Configuration (Primary)
OPENVIDU_URL=https://video.yourdomain.com
OPENVIDU_SECRET=your-openvidu-secret
OPENVIDU_DOMAIN=video.yourdomain.com

# Jitsi Configuration (Fallback - already configured)
JITSI_DOMAIN=meet.ishswami.in
JITSI_BASE_URL=https://meet.ishswami.in
JITSI_APP_ID=healthcare-jitsi-app
JITSI_APP_SECRET=your-jitsi-secret
JITSI_ENABLE_RECORDING=true
JITSI_ENABLE_WAITING_ROOM=true
```

### Config Service Methods

```typescript
// Check if video is enabled
configService.isVideoEnabled(): boolean

// Get video provider type
configService.getVideoProvider(): 'openvidu' | 'jitsi'

// Get video configuration (includes both OpenVidu and Jitsi configs)
configService.getVideoConfig(): VideoProviderConfig

// Get Jitsi configuration (for backward compatibility)
configService.getJitsiConfig(): JitsiConfig
```

### Video Configuration Structure

```typescript
interface VideoProviderConfig {
  enabled: boolean;
  provider: 'openvidu' | 'jitsi';
  openvidu?: {
    url: string;
    secret: string;
    domain: string;
    enabled: boolean;
  };
  jitsi?: {
    domain: string;
    baseUrl: string;
    wsUrl: string;
    appId: string;
    appSecret: string;
    enabled: boolean;
    enableRecording: boolean;
    enableWaitingRoom: boolean;
  };
}
```

---

## Usage

### Using VideoService (Single Service) - Recommended

```typescript
import { VideoService } from '@services/appointments/plugins/video/video.service';

@Injectable()
export class MyService {
  constructor(
    private readonly videoService: VideoService
  ) {}

  async createVideoConsultation(appointmentId: string, userId: string) {
    // Automatically uses OpenVidu (primary), falls back to Jitsi if needed
    // VideoService handles provider selection internally via VideoProviderFactory
    const token = await this.videoService.generateMeetingToken(
      appointmentId,
      userId,
      'doctor',
      {
        displayName: 'Dr. Smith',
        email: 'doctor@example.com',
      }
    );

    return token;
  }

  async checkVideoHealth() {
    // Check if video service is healthy (checks current provider health)
    const isHealthy = await this.videoService.isHealthy();
    const currentProvider = this.videoService.getCurrentProvider();
    const fallbackProvider = this.videoService.getFallbackProvider();
    
    return { isHealthy, currentProvider, fallbackProvider };
  }
}
```

### Using ConfigService for Video Configuration

```typescript
import { ConfigService } from '@config';

@Injectable()
export class MyService {
  constructor(
    private readonly configService: ConfigService
  ) {}

  checkVideoConfig() {
    // Check if video is enabled
    const isEnabled = this.configService.isVideoEnabled();
    
    // Get current provider type
    const provider = this.configService.getVideoProvider();
    
    // Get full video configuration
    const videoConfig = this.configService.getVideoConfig();
    
    // Access specific provider configs
    const openviduConfig = videoConfig.openvidu;
    const jitsiConfig = videoConfig.jitsi;
    
    return { isEnabled, provider, videoConfig };
  }
}
```

### Direct Provider Access (Advanced - Not Recommended)

**Note:** In most cases, you should use `VideoService` instead. Direct provider access is only needed for advanced scenarios.

```typescript
import { VideoProviderFactory } from '@services/appointments/plugins/video/providers/video-provider.factory';
import type { IVideoProvider } from '@core/types/video.types';

@Injectable()
export class MyService {
  constructor(
    private readonly videoProviderFactory: VideoProviderFactory
  ) {}

  async getPrimaryProvider(): Promise<IVideoProvider> {
    // Get primary provider (OpenVidu)
    return this.videoProviderFactory.getPrimaryProvider();
  }

  async getFallbackProvider(): Promise<IVideoProvider> {
    // Get fallback provider (Jitsi)
    return this.videoProviderFactory.getFallbackProvider();
  }

  async getProviderWithHealthCheck(): Promise<IVideoProvider> {
    // Get provider with automatic fallback if unhealthy
    // This is what VideoService uses internally
    return await this.videoProviderFactory.getProviderWithFallback();
  }

  async getProvider(): Promise<IVideoProvider> {
    // Get configured provider (respects VIDEO_PROVIDER env var)
    return this.videoProviderFactory.getProvider();
  }
}
```

### How Providers Access Configuration

**OpenViduVideoProvider:**
```typescript
// In constructor
const videoConfig = this.configService.get<VideoProviderConfig>('video');
this.apiUrl = videoConfig?.openvidu?.url || 'https://video.yourdomain.com';
this.secret = videoConfig?.openvidu?.secret || '';
this.domain = videoConfig?.openvidu?.domain || 'video.yourdomain.com';

// Check if enabled
isEnabled(): boolean {
  const videoConfig = this.configService.get<VideoProviderConfig>('video');
  return videoConfig?.enabled === true && videoConfig?.provider === 'openvidu';
}
```

**JitsiVideoProvider:**
```typescript
// Uses JitsiConfig (from jitsi.config.ts) for backward compatibility
generateJitsiToken(...) {
  const jitsiConfig = this.configService.getJitsiConfig();
  // Uses jitsiConfig.appId, jitsiConfig.appSecret, etc.
}

// Check if enabled
isEnabled(): boolean {
  const videoConfig = this.configService.get<{ enabled: boolean; provider: string }>('video');
  return videoConfig?.enabled === true; // Jitsi is always enabled as fallback
}
```

**VideoProviderFactory:**
```typescript
getProvider(): IVideoProvider {
  // Uses ConfigService helper methods
  if (!this.configService.isVideoEnabled()) {
    return this.jitsiProvider; // Fallback
  }

  const providerType = this.configService.getVideoProvider();
  // Select provider based on type
}
```

---

## Automatic Fallback

The `VideoService` automatically handles fallback:

1. **Health Check**: Checks if primary provider (OpenVidu) is healthy via `getProvider()`
2. **Automatic Fallback**: Falls back to Jitsi if OpenVidu is unhealthy
3. **Error Handling**: Tries fallback if primary provider throws error
4. **Logging**: Logs fallback events for monitoring via `LoggingService`

### Example Flow

```
1. Request comes in → VideoService.generateMeetingToken()
2. VideoService.getProvider() → Checks OpenVidu health
3. If OpenVidu healthy → Use OpenVidu
4. If OpenVidu unhealthy → Log warning, use Jitsi fallback
5. If OpenVidu throws error → Catch error, try Jitsi fallback
6. If both fail → Throw HealthcareError
```

### Fallback Implementation

```typescript
// In VideoService
private async getProvider(): Promise<IVideoProvider> {
  const isHealthy = await this.provider.isHealthy();
  if (isHealthy) {
    return this.provider; // Primary (OpenVidu)
  }

  // Fallback to Jitsi if primary is unhealthy
  if (this.provider.providerName !== this.fallbackProvider.providerName) {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Primary video provider (${this.provider.providerName}) unhealthy, using fallback (${this.fallbackProvider.providerName})`,
      'VideoService.getProvider',
      { primaryProvider: this.provider.providerName, fallbackProvider: this.fallbackProvider.providerName }
    );
  }

  return this.fallbackProvider; // Jitsi
}
```

---

## Migration from Old Services

### Before (Multiple Services - Deprecated)

```typescript
// ❌ OLD WAY - Multiple services (deprecated)
import { VideoService } from './video.service';
import { JitsiVideoService } from './jitsi-video.service';

constructor(
  private readonly videoService: VideoService,
  private readonly jitsiVideoService: JitsiVideoService // ❌ Don't use directly
) {}

async createConsultation() {
  // ❌ Direct Jitsi usage - no fallback, no provider abstraction
  return await this.jitsiVideoService.generateMeetingToken(...);
}
```

### After (Single Consolidated Service - Current)

```typescript
// ✅ NEW WAY - Single consolidated service (OpenVidu primary, Jitsi fallback)
import { VideoService } from '@services/appointments/plugins/video/video.service';

constructor(
  private readonly videoService: VideoService // ✅ Single service
) {}

async createConsultation() {
  // ✅ Automatically uses OpenVidu (primary), falls back to Jitsi if needed
  // ✅ Health checks and error handling built-in
  return await this.videoService.generateMeetingToken(
    appointmentId,
    userId,
    'doctor',
    { displayName: 'Dr. Smith', email: 'doctor@example.com' }
  );
}
```

### Current Service Status

**✅ Active Services:**
- `VideoService` - Main consolidated service (use this)
- `VideoProviderFactory` - Provider selection (internal)
- `OpenViduVideoProvider` - Primary provider (internal)
- `JitsiVideoProvider` - Fallback provider (internal)

**❌ Deprecated Services (still exist for backward compatibility):**
- `JitsiVideoService` - Legacy service, use `VideoService` instead
- Direct provider access - Use `VideoService` instead

---

## Provider Selection Logic

### Similar to Cache Provider Pattern

```typescript
// Cache Pattern (for reference)
getCacheProvider(): 'redis' | 'dragonfly' | 'memory'
// Default: 'dragonfly' (primary)
// Fallback: 'redis' (if dragonfly not available)

// Video Pattern (same approach)
getVideoProvider(): 'openvidu' | 'jitsi'
// Default: 'openvidu' (primary)
// Fallback: 'jitsi' (if openvidu not available)
```

### Configuration Priority

1. **`VIDEO_PROVIDER`** environment variable
2. **Default**: `'openvidu'` (if not set)
3. **Jitsi always enabled** as fallback (similar to Redis in cache)

---

## Integration Points

### Configuration Integration

- ✅ **`video.config.ts`** - Centralized video configuration factory
- ✅ **`ConfigModule`** - Includes `videoConfig` in all environments (development, staging, production, test)
- ✅ **`ConfigService`** - Has `getVideoConfig()`, `getVideoProvider()`, `isVideoEnabled()`
- ✅ **Environment Configs** - All environment configs (`development.config.ts`, `production.config.ts`, `staging.config.ts`, `test.config.ts`) include `video: videoConfig()`
- ✅ **Type Definitions** - `VideoProviderConfig` interface in `@core/types/config.types.ts`

### Service Integration

- ✅ **`VideoService`** - Main consolidated service (uses `ConfigService` via dependency injection)
- ✅ **`VideoProviderFactory`** - Uses `configService.isVideoEnabled()` and `configService.getVideoProvider()`
- ✅ **`OpenViduVideoProvider`** - Uses `configService.get<VideoProviderConfig>('video')` to access OpenVidu config
- ✅ **`JitsiVideoProvider`** - Uses `configService.getJitsiConfig()` for Jitsi-specific configuration
- ✅ **`VideoModule`** - Registers single `VideoService` with both providers
- ✅ **`ClinicVideoPlugin`** - Uses `VideoService` for all video operations
- ✅ **`AppointmentsController`** - Uses `VideoService` for video consultation endpoints
- ✅ **`AppointmentsService`** - Integrates with `ClinicVideoPlugin` (which uses `VideoService`)

### Consolidated Architecture

- ✅ **Single `VideoService`** - All methods from old `VideoService` and `JitsiVideoService` consolidated
- ✅ **Provider Pattern** - OpenVidu (primary) + Jitsi (fallback) via `VideoProviderFactory`
- ✅ **All References Updated** - No more direct `JitsiVideoService` usage, all go through `VideoService`
- ✅ **Automatic Fallback** - Health checks and automatic provider switching built into `VideoService`

---

## Provider Comparison

| Feature | OpenVidu (Primary) | Jitsi (Fallback) |
|---------|-------------------|------------------|
| **Status** | Primary | Fallback |
| **Modern** | ✅ Yes | ⚠️ Older |
| **AI Integration** | ✅ Easy | ⚠️ Limited |
| **Custom Domain** | ✅ Yes | ✅ Yes |
| **UI/UX Control** | ✅ Full | ✅ Good |
| **Already Working** | ⚠️ New | ✅ Yes |
| **Cost** | $0-20K/month | $0-20K/month |

---

## Health Check & Fallback

### Automatic Health Monitoring

```typescript
// VideoService automatically checks health
const provider = await this.getProvider(); // Checks health internally

// Manual health check methods
const isHealthy = await videoService.isHealthy();
const currentProvider = videoService.getCurrentProvider(); // Returns 'openvidu' or 'jitsi'
const fallbackProvider = videoService.getFallbackProvider(); // Always 'jitsi'
```

### Health Check Implementation

**In VideoService:**
```typescript
async isHealthy(): Promise<boolean> {
  try {
    const provider = await this.getProvider(); // Includes health check
    return await provider.isHealthy();
  } catch {
    return false;
  }
}
```

**In Providers:**
```typescript
// OpenViduVideoProvider
async isHealthy(): Promise<boolean> {
  try {
    const response = await axios.get(`${this.apiUrl}/api/config`, {
      headers: { Authorization: this.getAuthHeader() },
      timeout: 5000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

// JitsiVideoProvider
async isHealthy(): Promise<boolean> {
  // Jitsi is considered healthy if config is valid
  const jitsiConfig = this.configService.getJitsiConfig();
  return jitsiConfig.enabled && !!jitsiConfig.domain;
}
```

### Fallback Scenarios

1. **OpenVidu Unhealthy**: Automatically uses Jitsi
2. **OpenVidu Error**: Catches error, tries Jitsi
3. **OpenVidu Not Configured**: Uses Jitsi
4. **Both Unhealthy**: Returns error (should not happen)

---

## Environment Setup

### For OpenVidu (Primary)

1. Deploy OpenVidu on your Kubernetes cluster
2. Set environment variables:
   ```env
   VIDEO_PROVIDER=openvidu
   OPENVIDU_URL=https://video.yourdomain.com
   OPENVIDU_SECRET=your-secret
   OPENVIDU_DOMAIN=video.yourdomain.com
   ```

### For Jitsi (Fallback)

Jitsi is already configured! It will be used automatically as fallback.

---

## Testing

### Test Primary Provider (OpenVidu)

```typescript
// Set environment variable
process.env.VIDEO_PROVIDER = 'openvidu';
process.env.VIDEO_ENABLED = 'true';
process.env.OPENVIDU_URL = 'https://video.yourdomain.com';
process.env.OPENVIDU_SECRET = 'your-secret';

// Restart application or reload config
const token = await videoService.generateMeetingToken(
  appointmentId,
  userId,
  'doctor',
  { displayName: 'Test', email: 'test@example.com' }
);
// Should use OpenVidu
```

### Test Fallback (Jitsi)

```typescript
// Option 1: Set provider to jitsi
process.env.VIDEO_PROVIDER = 'jitsi';

// Option 2: Make OpenVidu unhealthy (simulate failure)
// Set invalid OpenVidu URL
process.env.OPENVIDU_URL = 'https://invalid-url.com';

// Option 3: Disable OpenVidu
process.env.VIDEO_PROVIDER = 'jitsi';

const token = await videoService.generateMeetingToken(...);
// Should use Jitsi (fallback)
```

### Test Health Checks

```typescript
// Check current provider health
const isHealthy = await videoService.isHealthy();
const currentProvider = videoService.getCurrentProvider();

console.log(`Provider: ${currentProvider}, Healthy: ${isHealthy}`);

// Force health check
const provider = await videoProviderFactory.getProviderWithFallback();
const healthStatus = await provider.isHealthy();
```

---

## Monitoring

### Logs

The unified service logs:
- Provider selection
- Fallback events
- Health check results
- Errors

### Example Logs

```
[INFO] Video Service initialized (OpenVidu primary, Jitsi fallback)
  service: 'VideoService'
  primaryProvider: 'openvidu'
  fallbackProvider: 'jitsi'

[WARN] Primary video provider (openvidu) unhealthy, using fallback (jitsi)
  service: 'VideoService.getProvider'
  primaryProvider: 'openvidu'
  fallbackProvider: 'jitsi'

[WARN] Primary provider failed, trying fallback: Connection timeout
  service: 'VideoService.generateMeetingToken'
  appointmentId: 'appt-123'
  primaryProvider: 'openvidu'
  fallbackProvider: 'jitsi'

[ERROR] Both primary and fallback providers failed: Network error
  service: 'VideoService.generateMeetingToken'
  appointmentId: 'appt-123'
  primaryError: 'Connection timeout'
  fallbackError: 'Service unavailable'
```

---

## Service Integration Summary

### Services Using Video Configuration

1. **VideoService** (`src/services/appointments/plugins/video/video.service.ts`)
   - Main entry point for all video operations
   - Uses `ConfigService` via dependency injection (constructor)
   - Uses `VideoProviderFactory` for provider selection
   - Implements automatic fallback logic with health checks
   - Methods: `generateMeetingToken()`, `startConsultation()`, `endConsultation()`, `getConsultationStatus()`, `reportTechnicalIssue()`, `processRecording()`, etc.
   - **Config Access:** Uses `VideoProviderFactory` which accesses config, doesn't directly call config methods

2. **VideoProviderFactory** (`src/services/appointments/plugins/video/providers/video-provider.factory.ts`)
   - Uses `configService.isVideoEnabled()` to check if video is enabled
   - Uses `configService.getVideoProvider()` to get provider type ('openvidu' | 'jitsi')
   - Selects provider based on configuration
   - Provides health-checked provider selection via `getProviderWithFallback()`
   - **Config Access:** Direct calls to `configService.isVideoEnabled()` and `configService.getVideoProvider()`

3. **OpenViduVideoProvider** (`src/services/appointments/plugins/video/providers/openvidu-video.provider.ts`)
   - Uses `configService.get<VideoProviderConfig>('video')` to access full video config
   - Reads `openvidu.url`, `openvidu.secret`, `openvidu.domain` from config in constructor
   - Implements `IVideoProvider` interface
   - **Config Access:** `this.configService.get<VideoProviderConfig>('video')` then accesses `videoConfig.openvidu.*`

4. **JitsiVideoProvider** (`src/services/appointments/plugins/video/providers/jitsi-video.provider.ts`)
   - Uses `configService.getJitsiConfig()` for Jitsi-specific configuration
   - Maintains backward compatibility with existing Jitsi setup
   - Implements `IVideoProvider` interface
   - **Config Access:** `this.configService.getJitsiConfig()` (uses separate Jitsi config, not video config)

5. **AppointmentsController** (`src/services/appointments/appointments.controller.ts`)
   - Uses `VideoService` for video consultation endpoints
   - Injected via constructor: `private readonly videoService: VideoService`
   - Endpoints: `POST /appointments/:id/video/token`, `POST /appointments/:id/video/start`, `POST /appointments/:id/video/end`, etc.
   - **Config Access:** None (uses VideoService which handles config internally)

6. **ClinicVideoPlugin** (`src/services/appointments/plugins/video/clinic-video.plugin.ts`)
   - Uses `VideoService` for all video operations
   - Integrates with appointment plugin system
   - Handles video-related appointment events
   - **Config Access:** None (uses VideoService which handles config internally)

7. **AppointmentsService** (`src/services/appointments/appointments.service.ts`)
   - Integrates with `ClinicVideoPlugin` (which uses `VideoService`)
   - Uses plugin system for video operations
   - **Config Access:** None (uses plugins which use VideoService)

### Configuration Files Updated

- ✅ `src/config/video.config.ts` - Video configuration factory (exports `videoConfig`, `isVideoEnabled()`, `getVideoProvider()`)
- ✅ `src/config/config.module.ts` - Includes `videoConfig` in ConfigModule load array
- ✅ `src/config/config.service.ts` - Has `getVideoConfig()`, `isVideoEnabled()`, `getVideoProvider()` methods
- ✅ `src/config/environment/development.config.ts` - Includes `video: videoConfig()` in config object
- ✅ `src/config/environment/production.config.ts` - Includes `video: videoConfig()` in config object
- ✅ `src/config/environment/staging.config.ts` - Includes `video: videoConfig()` in config object
- ✅ `src/config/environment/test.config.ts` - Includes `video: videoConfig()` in config object
- ✅ `src/libs/core/types/config.types.ts` - `VideoProviderConfig` interface added to `Config` type

### Module Integration

- ✅ **`VideoModule`** - Registers `VideoService`, `VideoProviderFactory`, `OpenViduVideoProvider`, `JitsiVideoProvider`
- ✅ **`AppointmentsModule`** - Imports `VideoModule`, uses `VideoService` in controllers and services
- ✅ **`ConfigModule`** - Includes `videoConfig` factory in load array

### Configuration Access Patterns

**Pattern 1: Via ConfigService Helper Methods (Recommended)**
```typescript
// In VideoProviderFactory
const isEnabled = this.configService.isVideoEnabled();
const providerType = this.configService.getVideoProvider();
```

**Pattern 2: Via Direct Config Access**
```typescript
// In OpenViduVideoProvider
const videoConfig = this.configService.get<VideoProviderConfig>('video');
const openviduConfig = videoConfig?.openvidu;
```

**Pattern 3: Via Specific Config Getter**
```typescript
// In JitsiVideoProvider
const jitsiConfig = this.configService.getJitsiConfig();
```

## Next Steps

1. **Deploy OpenVidu** on your Kubernetes cluster (if using OpenVidu)
2. **Set environment variables** for OpenVidu (if using OpenVidu)
3. **Test** with `VIDEO_PROVIDER=openvidu` or `VIDEO_PROVIDER=jitsi`
4. **Monitor** fallback events in logs
5. **Verify** all services are using `VideoService` (not direct `JitsiVideoService`)

---

**Document Version:** 1.1  
**Last Updated:** December 6, 2025  
**Author:** Healthcare Backend Team  
**Status:** ✅ All services integrated with video configuration

