# Video Service Architecture - Standalone Service with Microservice-Ready Design

## 🎯 Overview

This document outlines the architecture for a **standalone Video Service** that:
1. ✅ Can be used by appointments and other services
2. ✅ Can be easily converted to a microservice later
3. ✅ Follows all .ai-rules and existing patterns
4. ✅ Uses event-driven architecture for loose coupling

---

## 📁 Proposed Structure

```
src/services/video/
├── video.module.ts                    # Main module (can become microservice entry point)
├── video.controller.ts                # REST API endpoints
├── video.service.ts                   # Core business logic
├── video-consultation-tracker.service.ts  # Session tracking
├── providers/                          # Video provider implementations
│   ├── video-provider.factory.ts
│   ├── openvidu-video.provider.ts
│   └── jitsi-video.provider.ts
├── dto/                               # Video-specific DTOs (if needed)
│   └── video.dto.ts                   # (Already in @dtos, can reference)
├── events/                            # Event listeners and emitters
│   ├── video-event.listener.ts       # Listen to external events
│   └── video-event.emitter.ts         # Emit video events
└── index.ts                           # Exports
```

---

## 🏗️ Architecture Design

### **Current State (Embedded)**
```
AppointmentsModule
  └── VideoModule (plugin)
      └── VideoService
```

### **Proposed State (Standalone Service)**
```
VideoModule (Standalone)
  ├── VideoController (REST API)
  ├── VideoService (Core Logic)
  └── Video Providers

AppointmentsModule
  └── VideoModule (imports standalone service)
      └── Uses VideoService via DI
```

### **Future State (Microservice)**
```
Video Microservice (Separate Process)
  ├── VideoController (REST API)
  ├── VideoService
  └── Video Providers

Appointments Service
  └── VideoClient (HTTP client to video microservice)
```

---

## 🔄 Integration Patterns

### **Pattern 1: Direct Module Import (Current → Standalone)**
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

### **Pattern 2: Event-Driven (Loose Coupling)**
```typescript
// VideoService emits events
await this.eventService.emitEnterprise('video.consultation.started', {
  appointmentId: '...',
  sessionId: '...',
  // ...
});

// AppointmentsService listens to events
@OnEvent('video.consultation.started')
async handleVideoConsultationStarted(payload: VideoConsultationStartedEvent) {
  // Update appointment status, etc.
}
```

### **Pattern 3: HTTP Client (Microservice)**
```typescript
// VideoClient (when converted to microservice)
@Injectable()
export class VideoClient {
  constructor(private readonly httpService: HttpService) {}

  async generateToken(dto: GenerateVideoTokenDto): Promise<VideoTokenResponseDto> {
    return this.httpService.post('/api/video/token', dto).toPromise();
  }
}
```

---

## 📋 Implementation Plan

### **Phase 1: Extract to Standalone Service** ✅

1. **Create `src/services/video/` structure**
   - Move video code from `appointments/plugins/video/` to `services/video/`
   - Create `VideoController` with REST endpoints
   - Keep `VideoService` as core business logic
   - Move providers to `services/video/providers/`

2. **Create VideoModule**
   - Standalone module with all dependencies
   - Export `VideoService` for other services to use
   - Export `VideoController` for REST API

3. **Update AppointmentsModule**
   - Import `VideoModule` instead of plugin
   - Use `VideoService` via DI
   - Remove video plugin (or keep as adapter)

4. **Event Integration**
   - Emit video events via `EventService`
   - Listen to appointment events if needed

### **Phase 2: API-First Design** ✅

1. **VideoController**
   - REST endpoints for all video operations
   - Uses DTOs for request/response
   - Proper Swagger documentation
   - Authentication/authorization

2. **Service Layer**
   - `VideoService` handles business logic
   - Provider abstraction (OpenVidu/Jitsi)
   - Event emission for integration

### **Phase 3: Microservice-Ready** ✅

1. **Stateless Design**
   - No local state
   - Session data in database/cache
   - Can scale horizontally

2. **API Gateway Ready**
   - RESTful endpoints
   - Standard HTTP status codes
   - Error handling

3. **Event-Driven**
   - Emits events for other services
   - Listens to events from other services
   - Loose coupling

---

## 🔌 API Endpoints (REST)

### **Video Consultation Endpoints**

```
POST   /api/video/token                    # Generate meeting token
POST   /api/video/consultation/start       # Start consultation
POST   /api/video/consultation/end         # End consultation
GET    /api/video/consultation/:id/status   # Get consultation status
POST   /api/video/consultation/:id/report  # Report technical issue
POST   /api/video/image/share              # Share medical image
GET    /api/video/history                  # Get video call history
```

### **Health & Monitoring**

```
GET    /api/video/health                   # Service health
GET    /api/video/providers/status         # Provider status
```

---

## 📡 Event Integration

### **Events Emitted by Video Service**

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
```

### **Events Listened by Video Service**

```typescript
// Appointment created (if video type)
'appointment.created'
// → Pre-create video session if needed

// Appointment cancelled
'appointment.cancelled'
// → End video session if active
```

---

## 🔐 Security & Authentication

- ✅ JWT authentication via `JwtAuthGuard`
- ✅ RBAC authorization via `RbacGuard`
- ✅ Clinic context via `ClinicGuard`
- ✅ Resource permissions via `RequireResourcePermission`
- ✅ HIPAA compliance for video data

---

## 📊 Benefits

### **Immediate Benefits (Standalone Service)**
1. ✅ **Separation of Concerns** - Video logic separate from appointments
2. ✅ **Reusability** - Can be used by other services (EHR, Telemedicine, etc.)
3. ✅ **Testability** - Easier to test in isolation
4. ✅ **Maintainability** - Clear boundaries and responsibilities

### **Future Benefits (Microservice)**
1. ✅ **Independent Scaling** - Scale video service separately
2. ✅ **Technology Flexibility** - Can use different tech stack if needed
3. ✅ **Deployment Independence** - Deploy video service separately
4. ✅ **Team Ownership** - Separate team can own video service

---

## 🚀 Migration Path

### **Step 1: Create Standalone Service** (No Breaking Changes)
- Create `src/services/video/`
- Move code from `appointments/plugins/video/`
- Create `VideoController`
- Update `VideoModule` to be standalone

### **Step 2: Update Appointments** (Backward Compatible)
- Import `VideoModule` in `AppointmentsModule`
- Use `VideoService` via DI
- Keep video endpoints in `AppointmentsController` (or remove if using VideoController)

### **Step 3: Event-Driven Integration** (Optional)
- Emit events from VideoService
- Listen to events in AppointmentsService
- Loose coupling

### **Step 4: Microservice Conversion** (Future)
- Extract to separate process
- Add API gateway
- Use HTTP client in other services
- Keep event-driven for real-time updates

---

## 📝 Code Structure

### **VideoModule (Standalone)**
```typescript
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CacheModule,
    LoggingModule,
    EventsModule,
    SocketModule,
    GuardsModule,
    RbacModule,
  ],
  controllers: [VideoController],
  providers: [
    VideoService,
    VideoConsultationTracker,
    VideoProviderFactory,
    OpenViduVideoProvider,
    JitsiVideoProvider,
  ],
  exports: [VideoService], // Export for other services
})
export class VideoModule {}
```

### **VideoController (REST API)**
```typescript
@Controller('video')
@ApiTags('video')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Post('token')
  async generateToken(@Body() dto: GenerateVideoTokenDto): Promise<VideoTokenResponseDto> {
    return this.videoService.generateMeetingToken(...);
  }

  // ... other endpoints
}
```

### **AppointmentsModule (Uses Video Service)**
```typescript
@Module({
  imports: [
    VideoModule, // Import standalone video service
    // ...
  ],
})
export class AppointmentsModule {}
```

---

## ✅ Decision Points

1. **Keep video endpoints in AppointmentsController?**
   - Option A: Keep (backward compatibility)
   - Option B: Remove (use VideoController only)
   - **Recommendation**: Keep initially, deprecate later

2. **Event-driven vs Direct calls?**
   - Option A: Direct service calls (simpler, faster)
   - Option B: Event-driven (loose coupling, async)
   - **Recommendation**: Hybrid - Direct for synchronous, Events for async

3. **Microservice conversion timeline?**
   - Can be done anytime
   - No code changes needed (already API-first)
   - Just extract to separate process

---

## 🎯 Next Steps

1. ✅ Create standalone `VideoModule` structure
2. ✅ Move video code to `src/services/video/`
3. ✅ Create `VideoController` with REST endpoints
4. ✅ Update `AppointmentsModule` to import `VideoModule`
5. ✅ Add event integration
6. ✅ Update documentation

---

## 📚 References

- **Existing Services**: `src/services/auth/`, `src/services/billing/`, `src/services/ehr/`
- **Event System**: `src/libs/infrastructure/events/`
- **Architecture Rules**: `.ai-rules/architecture.md`
- **NestJS Patterns**: `.ai-rules/nestjs-specific.md`

