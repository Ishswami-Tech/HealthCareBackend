# Video Service - Complete Documentation

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Configuration](#configuration)
4. [Usage & Integration](#usage--integration)
5. [API Reference](#api-reference)
6. [Provider Pattern](#provider-pattern)
7. [Implementation Status](#implementation-status)
8. [Best Practices & Improvements](#best-practices--improvements)
9. [Migration Guide](#migration-guide)

---

## Overview

The video service is a **standalone service** that provides video conferencing capabilities for healthcare consultations. It uses a **dual-provider pattern** similar to the cache service:

- **OpenVidu** as primary provider (modern, AI-ready, custom domain support)
- **Jitsi** as fallback provider (reliable, already configured)

Both providers are available, but OpenVidu is used by default with automatic fallback to Jitsi if OpenVidu is unavailable.

### Key Features

- ✅ Standalone service (can be used by appointments and other services)
- ✅ Microservice-ready design
- ✅ Dual-provider pattern with automatic fallback
- ✅ Event-driven architecture
- ✅ REST API endpoints
- ✅ Health checks and monitoring
- ✅ HIPAA compliant

---

## Architecture

### Service Structure

```
src/services/video/
├── video.module.ts                    # Standalone module
├── video.controller.ts                # REST API endpoints
├── video.service.ts                   # Core business logic
├── video-consultation-tracker.service.ts  # Session tracking
├── index.ts                           # Exports
└── providers/                         # Video provider implementations
    ├── video-provider.factory.ts
    ├── openvidu-video.provider.ts
    └── jitsi-video.provider.ts
```

### Provider Pattern (Similar to Cache Service)

```
VideoService (Main Entry Point - SINGLE SERVICE)
    ↓
VideoProviderFactory (Selects Provider)
    ↓
    ├─ OpenViduVideoProvider (Primary - like Dragonfly)
    └─ JitsiVideoProvider (Fallback - like Redis)
```

### Current State (Standalone Service)

```
VideoModule (Standalone)
  ├── VideoController (REST API)
  ├── VideoService (Core Logic)
  └── Video Providers

AppointmentsModule
  └── VideoModule (imports standalone service)
      └── Uses VideoService via DI
```

### Future State (Microservice)

```
Video Microservice (Separate Process)
  ├── VideoController (REST API)
  ├── VideoService
  └── Video Providers

Appointments Service
  └── VideoClient (HTTP client to video microservice)
```

**No code changes needed** - just extract to separate process and use HTTP client.

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
OPENVIDU_WEBHOOK_ENABLED=false
OPENVIDU_WEBHOOK_ENDPOINT=http://api:8088/api/v1/webhooks/openvidu
OPENVIDU_WEBHOOK_EVENTS=sessionCreated,sessionDestroyed,participantJoined,participantLeft,recordingStarted,recordingStopped

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
    webhookEnabled: boolean;
    webhookEndpoint?: string;
    webhookEvents?: string;
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

### Configuration Files

- ✅ `src/config/video.config.ts` - Video configuration factory
- ✅ `src/config/config.module.ts` - Includes `videoConfig` in ConfigModule
- ✅ `src/config/config.service.ts` - Has `getVideoConfig()`, `getVideoProvider()`, `isVideoEnabled()`
- ✅ All environment configs include `video: videoConfig()`

---

## Usage & Integration

### Using VideoService (Recommended)

```typescript
import { VideoService } from '@services/video/video.service';

@Injectable()
export class MyService {
  constructor(
    private readonly videoService: VideoService
  ) {}

  async createVideoConsultation(appointmentId: string, userId: string) {
    // Automatically uses OpenVidu (primary), falls back to Jitsi if needed
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
    const isEnabled = this.configService.isVideoEnabled();
    const provider = this.configService.getVideoProvider();
    const videoConfig = this.configService.getVideoConfig();
    
    return { isEnabled, provider, videoConfig };
  }
}
```

### Module Integration

```typescript
// AppointmentsModule
@Module({
  imports: [
    VideoModule, // Import standalone video service
    // ...
  ],
})
export class AppointmentsModule {}

// AppointmentsController uses VideoService via DI
constructor(
  private readonly videoService: VideoService
) {}
```

### Event-Driven Integration

```typescript
// VideoService emits events
await this.eventService.emitEnterprise('video.consultation.started', {
  appointmentId: '...',
  sessionId: '...',
  userId: '...',
  userRole: 'doctor',
  provider: 'openvidu',
});

// AppointmentsService listens to events
@OnEvent('video.consultation.started')
async handleVideoConsultationStarted(payload: VideoConsultationStartedEvent) {
  // Update appointment status, etc.
}
```

---

## API Reference

### Video Consultation Endpoints

```
POST   /api/video/token                                    # Generate meeting token
POST   /api/video/consultation/start                       # Start consultation
POST   /api/video/consultation/end                         # End consultation
GET    /api/video/consultation/:appointmentId/status       # Get consultation status
POST   /api/video/consultation/:appointmentId/report        # Report technical issue
POST   /api/video/consultation/:appointmentId/share-image  # Share medical image
GET    /api/video/history                                  # Get video call history
```

### OpenVidu Pro Features

```
POST   /api/video/recording/start                          # Start recording
POST   /api/video/recording/stop                           # Stop recording
GET    /api/video/recording/:appointmentId                # Get recordings for session
POST   /api/video/participant/manage                      # Manage participant (kick/mute/etc)
GET    /api/video/participants/:appointmentId              # Get participants list
GET    /api/video/analytics/:appointmentId                 # Get session analytics
```

### Health & Monitoring

```
GET    /api/video/health                                   # Service health check
```

### Authentication & Authorization

- ✅ JWT authentication via `JwtAuthGuard`
- ✅ RBAC authorization via `RbacGuard`
- ✅ Clinic context via `ClinicGuard`
- ✅ Resource permissions via `RequireResourcePermission`

---

## Provider Pattern

### Automatic Fallback

The `VideoService` automatically handles fallback:

1. **Health Check**: Checks if primary provider (OpenVidu) is healthy
2. **Automatic Fallback**: Falls back to Jitsi if OpenVidu is unhealthy
3. **Error Handling**: Tries fallback if primary provider throws error
4. **Logging**: Logs fallback events for monitoring

### Fallback Flow

```
1. Request comes in → VideoService.generateMeetingToken()
2. VideoService.getProvider() → Checks OpenVidu health
3. If OpenVidu healthy → Use OpenVidu
4. If OpenVidu unhealthy → Log warning, use Jitsi fallback
5. If OpenVidu throws error → Catch error, try Jitsi fallback
6. If both fail → Throw HealthcareError
```

### Provider Selection Logic

```typescript
// Similar to Cache Provider Pattern
getVideoProvider(): 'openvidu' | 'jitsi'
// Default: 'openvidu' (primary)
// Fallback: 'jitsi' (if openvidu not available)

// Configuration Priority
1. VIDEO_PROVIDER environment variable
2. Default: 'openvidu' (if not set)
3. Jitsi always enabled as fallback (similar to Redis in cache)
```

### Health Check Implementation

```typescript
// VideoService automatically checks health
const provider = await this.getProvider(); // Checks health internally

// Manual health check methods
const isHealthy = await videoService.isHealthy();
const currentProvider = videoService.getCurrentProvider(); // Returns 'openvidu' or 'jitsi'
const fallbackProvider = videoService.getFallbackProvider(); // Always 'jitsi'
```

### Provider Comparison

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

## Implementation Status

### ✅ Completed Features

1. **Standalone Service**
   - ✅ Complete video service module
   - ✅ REST API endpoints via `VideoController`
   - ✅ Can be used by appointments and other services
   - ✅ Microservice-ready design

2. **Event Integration**
   - ✅ Emits `video.consultation.started` events
   - ✅ Emits `video.consultation.ended` events
   - ✅ Emits `video.token.generated` events
   - ✅ Emits `video.technical.issue.reported` events
   - ✅ Uses centralized `EventService`

3. **Provider Pattern**
   - ✅ OpenVidu as primary provider
   - ✅ Jitsi as fallback provider
   - ✅ Automatic fallback on failure
   - ✅ Health checks

4. **Configuration**
   - ✅ Follows same pattern as `cache.config.ts`
   - ✅ Uses `registerAs()` from `@nestjs/config`
   - ✅ Has utility functions: `isVideoEnabled()`, `getVideoProvider()`
   - ✅ `ConfigService` has typed getter: `getVideoConfig()`
   - ✅ Follows dual-provider pattern (like cache: Dragonfly/Redis)

5. **Security & Authorization**
   - ✅ JWT authentication
   - ✅ RBAC authorization
   - ✅ Clinic context isolation
   - ✅ Resource permissions

### ✅ Completed Features (Continued)

6. **DTOs and Validation** ✅ COMPLETE
   - ✅ Dedicated `video.dto.ts` file exists in `src/libs/dtos/`
   - ✅ All video endpoints use proper DTOs (no inline types)
   - ✅ All DTOs have `class-validator` decorators
   - ✅ Validation happens at DTO layer via `ValidationPipe`
   - ✅ All DTOs have `@ApiProperty` decorators for Swagger

   **Implemented DTOs:**
   - ✅ `GenerateVideoTokenDto` - Request DTO for generating tokens
   - ✅ `StartVideoConsultationDto` - Request DTO for starting consultations
   - ✅ `EndVideoConsultationDto` - Request DTO for ending consultations
   - ✅ `ShareMedicalImageDto` - Request DTO for sharing medical images
   - ✅ `ShareMedicalImageResponseDto` - Response DTO for shared images
   - ✅ `VideoCallHistoryQueryDto` - Query DTO for history requests
   - ✅ `VideoTokenResponseDto` - Response DTO for token generation
   - ✅ `VideoConsultationSessionDto` - Response DTO for session data
   - ✅ `VideoCallResponseDto` - Response DTO for call data
   - ✅ `VideoCallHistoryResponseDto` - Response DTO for history
   - ✅ `ReportTechnicalIssueDto` - Request DTO for reporting issues
   - ✅ `StartRecordingDto` - Request DTO for starting recordings (OpenVidu Pro)
   - ✅ `StopRecordingDto` - Request DTO for stopping recordings (OpenVidu Pro)
   - ✅ `ManageParticipantDto` - Request DTO for participant management (OpenVidu Pro)
   - ✅ `RecordingResponseDto` - Response DTO for recording data
   - ✅ `RecordingListResponseDto` - Response DTO for recording lists
   - ✅ `ParticipantListResponseDto` - Response DTO for participant lists
   - ✅ `SessionAnalyticsResponseDto` - Response DTO for session analytics

7. **Swagger Documentation** ✅ COMPLETE
   - ✅ All endpoints have `@ApiOperation` with summary and description
   - ✅ All endpoints have `@ApiResponse` decorators for success/error cases
   - ✅ All endpoints have `@ApiBody` decorators for request DTOs
   - ✅ All endpoints have `@ApiParam` decorators for path parameters
   - ✅ All DTOs have `@ApiProperty` decorators for Swagger schema generation
   - ✅ Comprehensive Swagger documentation available at `/docs`

### ⚠️ Areas for Improvement

3. **Testing** 🔴 HIGH PRIORITY
   - ❌ No unit tests found (`*.spec.ts` files missing)
   - ❌ No integration tests
   - ❌ No e2e tests for video endpoints

4. **HTTP Client** 🟡 MEDIUM PRIORITY
   - ⚠️ Uses raw `axios` directly
   - ⚠️ No NestJS `HttpModule` / `HttpService`
   - ⚠️ No retry logic
   - ⚠️ No timeout configuration

5. **Health Checks** 🟡 MEDIUM PRIORITY
   - ✅ Provider has `isHealthy()` method
   - ⚠️ No NestJS health check integration
   - ⚠️ No `/health/video` endpoint

6. **Interceptors** 🟡 MEDIUM PRIORITY
   - ❌ No response transformation interceptors
   - ❌ No logging interceptors for video operations
   - ❌ No timeout interceptors

### Recommended Implementation Order

1. **Phase 1: DTOs & Validation** ✅ COMPLETE
   - ✅ Created `src/libs/dtos/video.dto.ts` following `appointment.dto.ts` pattern
   - ✅ Used same decorators: `@ApiProperty()`, `@IsUUID()`, `@IsString()`, etc.
   - ✅ Updated controller to use DTOs
   - ✅ Validation moved to DTO layer via `ValidationPipe`

2. **Phase 2: Testing** (HIGH PRIORITY - IN PROGRESS)
   - Add unit tests for DTOs
   - Add unit tests for service
   - Add integration tests for controller
   - Add e2e tests for video endpoints

3. **Phase 3: Enhancements** (MEDIUM PRIORITY)
   - Replace `axios` with `HttpService` from `@nestjs/axios`
   - Add retry logic and timeouts
   - Add comprehensive Swagger documentation
   - Integrate with `@nestjs/terminus` for health checks
   - Add logging and transform interceptors

---

## Best Practices & Improvements

### ✅ What's Good

- ✅ Configuration follows pattern perfectly
- ✅ Module structure is good
- ✅ Dependency injection is proper
- ✅ Lifecycle hooks implemented
- ✅ Error handling is good
- ✅ Guards are properly used
- ✅ Event-driven architecture
- ✅ SOLID principles followed
- ✅ DRY & KISS principles
- ✅ Path aliases used correctly

### ✅ What's Implemented

1. **Video DTOs** - ✅ Complete `video.dto.ts` file with all required DTOs
2. **DTO-based Validation** - ✅ Validation at DTO layer via `ValidationPipe`
3. **Response DTOs** - ✅ All response DTOs properly defined with `@ApiProperty`
4. **Swagger Docs** - ✅ Complete Swagger documentation for all endpoints
5. **Error Handling** - ✅ Centralized error handling via `HealthcareErrorsService`
6. **Event Integration** - ✅ All video events properly emitted
7. **OpenVidu Pro Features** - ✅ Recording, participant management, analytics

### ❌ What's Missing

1. **Testing** - No tests (HIGH PRIORITY)
   - ❌ No unit tests for DTOs
   - ❌ No unit tests for service
   - ❌ No integration tests for controller
   - ❌ No e2e tests for video endpoints

### SOLID Principles

- **Single Responsibility**: VideoService handles only video operations
- **Open/Closed**: Provider pattern allows adding new providers without modifying existing code
- **Liskov Substitution**: All providers implement `IVideoProvider` interface
- **Interface Segregation**: Clean interfaces for providers
- **Dependency Inversion**: Depends on abstractions (`IVideoProvider`), not concretions

---

## Migration Guide

### From Old Plugin Location

**Before (Deprecated):**
```typescript
// Old location - DEPRECATED
import { VideoService } from './plugins/video/video.service';
import { VideoModule } from './plugins/video/video.module';
```

**After (Current):**
```typescript
// New location - ACTIVE
import { VideoService } from '@services/video/video.service';
import { VideoModule } from '@services/video/video.module';
```

### Removed Files

- ❌ `src/services/appointments/plugins/video/video.module.ts`
- ❌ `src/services/appointments/plugins/video/video.service.ts`
- ❌ `src/services/appointments/plugins/video/video-consultation-tracker.service.ts`
- ❌ `src/services/appointments/plugins/video/jitsi-video.service.ts`
- ❌ `src/services/appointments/plugins/video/providers/` (all files)

### Kept Files

- ✅ `src/services/appointments/plugins/video/clinic-video.plugin.ts` - **KEPT** - Plugin wrapper that uses the new `@services/video/video.service`

### Current Structure

```
src/services/
├── video/                          # ✅ NEW: Standalone video service
│   ├── video.module.ts
│   ├── video.controller.ts
│   ├── video.service.ts
│   ├── video-consultation-tracker.service.ts
│   ├── index.ts
│   └── providers/
│       ├── video-provider.factory.ts
│       ├── openvidu-video.provider.ts
│       └── jitsi-video.provider.ts
│
└── appointments/
    └── plugins/
        └── video/
            └── clinic-video.plugin.ts  # ✅ KEPT: Plugin wrapper
```

---

## Events

### Events Emitted by Video Service

```typescript
// Video consultation started
'video.consultation.started'
{
  appointmentId: string;
  sessionId: string;
  userId: string;
  userRole: 'patient' | 'doctor';
  provider: 'openvidu' | 'jitsi';
}

// Video consultation ended
'video.consultation.ended'
{
  appointmentId: string;
  sessionId: string;
  duration: number;
  recordingUrl?: string;
}

// Video token generated
'video.token.generated'
{
  appointmentId: string;
  userId: string;
  provider: 'openvidu' | 'jitsi';
}

// Technical issue reported
'video.technical.issue.reported'
{
  appointmentId: string;
  userId: string;
  issueType: 'audio' | 'video' | 'connection' | 'other';
  description: string;
}

// Medical image shared
'video.medical.image.shared'
{
  appointmentId: string;
  callId: string;
  userId: string;
  imageUrl: string;
}

// Recording started (OpenVidu Pro)
'video.recording.started'
{
  appointmentId: string;
  recordingId: string;
  sessionId: string;
  outputMode?: 'COMPOSED' | 'INDIVIDUAL';
}

// Recording stopped (OpenVidu Pro)
'video.recording.stopped'
{
  appointmentId: string;
  recordingId: string;
  url?: string;
  duration: number;
}

// Participant managed (OpenVidu Pro)
'video.participant.managed'
{
  appointmentId: string;
  connectionId: string;
  action: 'kick' | 'mute' | 'unmute' | 'forceUnpublish';
}
```

### Events Listened by Video Service

```typescript
// Appointment created (if video type)
'appointment.created'
// → Pre-create video session if needed

// Appointment cancelled
'appointment.cancelled'
// → End video session if active
```

---

## Monitoring & Logging

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

## Custom Domain Setup

For production deployment on custom domain, see:
- `docs/OPENVIDU_CUSTOM_DOMAIN_DEPLOYMENT.md` - Complete guide for deploying OpenVidu on custom domain

**Quick Summary:**
- Development: Uses `localhost` (no custom domain needed)
- Production: Configure `video.yourdomain.com` in Kubernetes
- DNS: Add A record pointing to your server
- SSL: Let's Encrypt via cert-manager (auto-configured)

---

## Next Steps

1. ✅ **Create Video DTOs** - ✅ COMPLETE - All DTOs implemented following `appointment.dto.ts` pattern
2. **Add Tests** - Unit, integration, and e2e tests (HIGH PRIORITY)
3. ✅ **Enhance Swagger** - ✅ COMPLETE - All endpoints documented with DTOs
4. **Replace Axios** - Use NestJS `HttpService` (MEDIUM PRIORITY)
5. **Add Health Checks** - Integrate with `@nestjs/terminus` (MEDIUM PRIORITY)
6. **Microservice Conversion** (Future) - Extract to separate process

---

## References

- **Existing DTO Pattern:** `src/libs/dtos/appointment.dto.ts`
- **Existing Config Pattern:** `src/config/video.config.ts`, `src/config/cache.config.ts`
- **Response DTOs:** `src/libs/dtos/common-response.dto.ts`
- **Validation:** `src/config/validation-pipe.config.ts`
- **Architecture Rules:** `.ai-rules/architecture.md`
- **NestJS Patterns:** `.ai-rules/nestjs-specific.md`

---

**Document Version:** 2.1  
**Last Updated:** December 11, 2025  
**Author:** Healthcare Backend Team  
**Status:** ✅ **Complete** - All DTOs implemented, validation at DTO layer, Swagger documentation complete

