# Video Services - NestJS Best Practices Analysis (Updated)

## 📋 Executive Summary

After reviewing existing `@config` and `@dtos` patterns, this document provides an **updated analysis** of what's missing and what should follow existing conventions.

---

## ✅ What's Already Following Patterns

### 1. **Configuration** ✅ **FOLLOWS PATTERN**

**Current State:**
- ✅ `video.config.ts` follows same pattern as `cache.config.ts`
- ✅ Uses `registerAs()` from `@nestjs/config`
- ✅ Has utility functions: `isVideoEnabled()`, `getVideoProvider()`
- ✅ Exported as `VideoConfigUtils`
- ✅ `ConfigService` has typed getter: `getVideoConfig()`
- ✅ Follows dual-provider pattern (like cache: Dragonfly/Redis)

**Pattern Match:**
```typescript
// ✅ video.config.ts (matches cache.config.ts pattern)
export const videoConfig = registerAs('video', (): VideoProviderConfig => { ... });
export function isVideoEnabled(): boolean { ... }
export function getVideoProvider(): 'openvidu' | 'jitsi' { ... }
export const VideoConfigUtils = { isEnabled, getProvider };

// ✅ config.service.ts (has typed getter)
getVideoConfig(): VideoProviderConfig { ... }
getVideoProvider(): 'openvidu' | 'jitsi' { ... }
```

**Status:** ✅ **PERFECT** - No changes needed

---

## ❌ What's Missing (Based on Existing Patterns)

### 1. **Video DTOs** ❌ **HIGH PRIORITY**

**Current State:**
- ❌ **NO `video.dto.ts` file exists** in `src/libs/dtos/`
- ❌ Video endpoints use inline types in controller
- ❌ No DTOs with `class-validator` decorators
- ❌ No Swagger documentation for video DTOs

**Existing Pattern (from `appointment.dto.ts`):**
```typescript
// ✅ Pattern to follow:
@ApiProperty({ description: '...', example: '...' })
@IsUUID('4', { message: '...' })
@IsNotEmpty({ message: '...' })
export class CreateAppointmentDto { ... }

@ApiPropertyOptional({ description: '...' })
@IsOptional()
@IsString({ message: '...' })
export class UpdateAppointmentDto { ... }
```

**What Should Exist (`src/libs/dtos/video.dto.ts`):**

```typescript
// Missing DTOs that should follow appointment.dto.ts pattern:

1. GenerateVideoTokenDto
   - appointmentId: UUID
   - userId: UUID
   - userRole: 'patient' | 'doctor'
   - userInfo: { displayName, email, avatar? }

2. StartVideoConsultationDto
   - appointmentId: UUID
   - userId: UUID
   - userRole: 'patient' | 'doctor'

3. EndVideoConsultationDto
   - appointmentId: UUID
   - userId: UUID

4. ShareMedicalImageDto
   - appointmentId: UUID
   - userId: UUID
   - imageData: string (base64)
   - imageType: string

5. VideoCallHistoryQueryDto
   - userId: UUID
   - clinicId?: UUID
   - page?: number
   - limit?: number

6. VideoTokenResponseDto
   - token: string
   - meetingUrl: string
   - sessionId: string
   - expiresAt: Date

7. VideoConsultationSessionDto
   - sessionId: string
   - appointmentId: string
   - meetingUrl: string
   - status: VideoCallStatus
   - startTime?: Date
   - endTime?: Date

8. VideoCallResponseDto
   - id: string
   - appointmentId: string
   - status: VideoCallStatus
   - meetingUrl: string
   - etc.
```

**Recommendation:**
- Create `src/libs/dtos/video.dto.ts` following `appointment.dto.ts` pattern
- Use same decorators: `@ApiProperty()`, `@IsUUID()`, `@IsString()`, etc.
- Extend `BaseResponseDto` or `DataResponseDto` for responses
- Export from `src/libs/dtos/index.ts`

---

### 2. **Controller Structure** ⚠️ **MEDIUM PRIORITY**

**Current State:**
- ⚠️ Video endpoints embedded in `AppointmentsController`
- ⚠️ No dedicated `VideoController`
- ⚠️ Mixed concerns (appointments + video)

**Existing Pattern:**
- `AppointmentsController` handles appointment operations
- Video operations are mixed in

**Recommendation:**
- **Option A:** Keep in `AppointmentsController` (if video is tightly coupled to appointments)
- **Option B:** Create `VideoController` (if video can be standalone)
- **Decision needed:** Based on business logic coupling

---

### 3. **Swagger Documentation** ⚠️ **MEDIUM PRIORITY**

**Current State:**
- ⚠️ Some endpoints have `@ApiOperation` and `@ApiResponse`
- ⚠️ Missing DTO documentation (no DTOs = no `@ApiProperty`)
- ⚠️ Missing comprehensive Swagger docs

**Existing Pattern (from `appointments.controller.ts`):**
```typescript
@ApiOperation({ summary: '...', description: '...' })
@ApiResponse({ status: 200, description: '...', type: AppointmentResponseDto })
@ApiParam({ name: 'id', type: 'string', format: 'uuid' })
@ApiBearerAuth()
```

**What's Missing:**
- DTOs with `@ApiProperty()` decorators
- Response DTOs for Swagger documentation
- Error response documentation

**Recommendation:**
- Add DTOs first (see #1)
- Then add Swagger decorators to controller
- Document all responses with DTO types

---

### 4. **Validation** ⚠️ **HIGH PRIORITY** (Depends on DTOs)

**Current State:**
- ⚠️ Validation happens in service layer
- ⚠️ No DTO-based validation
- ⚠️ Uses `ValidationPipe` at controller level (good)

**Existing Pattern:**
```typescript
// ✅ Global ValidationPipe configured
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })
)
```

**What's Missing:**
- DTOs with `class-validator` decorators
- Validation in DTO layer (not service layer)

**Recommendation:**
- Create DTOs with validators
- Move validation from service to DTO layer
- Keep `ValidationPipe` at controller level

---

### 5. **Response DTOs** ⚠️ **MEDIUM PRIORITY**

**Current State:**
- ⚠️ Service returns inline types
- ⚠️ No response DTOs extending `BaseResponseDto`

**Existing Pattern (from `common-response.dto.ts`):**
```typescript
// ✅ Pattern to follow:
export class DataResponseDto<T> extends BaseResponseDto {
  @ApiProperty({ description: 'Response data' })
  data: T = {} as T;
}

export class PaginatedResponseDto<T> extends BaseResponseDto {
  @ApiProperty({ description: 'Response data array' })
  data: T[] = [];
  
  @ApiProperty({ description: 'Pagination metadata', type: PaginationMetaDto })
  meta: PaginationMetaDto = new PaginationMetaDto();
}
```

**What's Missing:**
- Response DTOs for video operations
- Should extend `DataResponseDto<T>` or `PaginatedResponseDto<T>`

**Recommendation:**
- Create response DTOs extending base classes
- Use `DataResponseDto<VideoTokenResponseDto>` pattern
- Use `PaginatedResponseDto<VideoCallResponseDto>` for lists

---

## 📊 Updated Priority Matrix

| Feature | Priority | Impact | Effort | Status |
|---------|----------|--------|--------|--------|
| **Video DTOs** | 🔴 HIGH | High | Medium | ❌ Missing |
| **Validation (DTO-based)** | 🔴 HIGH | High | Low | ⚠️ Partial |
| **Response DTOs** | 🟡 MEDIUM | Medium | Low | ⚠️ Missing |
| **Swagger Documentation** | 🟡 MEDIUM | Medium | Medium | ⚠️ Partial |
| **Controller Structure** | 🟡 MEDIUM | Low | Low | ⚠️ Mixed |
| **Testing** | 🔴 HIGH | High | High | ❌ Missing |
| **HTTP Client (HttpService)** | 🟡 MEDIUM | Medium | Low | ⚠️ Using axios |
| **Interceptors** | 🟡 MEDIUM | Medium | Medium | ⚠️ Missing |
| **Guards** | 🟡 MEDIUM | Medium | Low | ✅ Good |
| **Health Checks** | 🟡 MEDIUM | Medium | Low | ⚠️ Missing |

---

## 🎯 Recommended Implementation Order

### **Phase 1: DTOs & Validation** (HIGH PRIORITY)

1. **Create `src/libs/dtos/video.dto.ts`**
   - Follow `appointment.dto.ts` pattern exactly
   - Use same decorators: `@ApiProperty()`, `@IsUUID()`, `@IsString()`, etc.
   - Create all request DTOs
   - Create all response DTOs (extending `BaseResponseDto`)

2. **Update Controller**
   - Replace inline types with DTOs
   - Add proper Swagger decorators
   - Use DTOs in method signatures

3. **Update Service**
   - Accept DTOs instead of inline types
   - Return response DTOs
   - Remove validation logic (moved to DTOs)

### **Phase 2: Testing** (HIGH PRIORITY)

4. **Add Tests**
   - Unit tests for DTOs
   - Unit tests for service
   - Integration tests for controller
   - E2E tests for video endpoints

### **Phase 3: Enhancements** (MEDIUM PRIORITY)

5. **HTTP Client**
   - Replace `axios` with `HttpService` from `@nestjs/axios`
   - Add retry logic
   - Configure timeouts

6. **Interceptors**
   - Add logging interceptor
   - Add transform interceptor
   - Add timeout interceptor

7. **Health Checks**
   - Integrate with `@nestjs/terminus`
   - Add `/health/video` endpoint

---

## 📝 Summary

### ✅ **What's Good:**
- Configuration follows pattern perfectly ✅
- Module structure is good ✅
- Dependency injection is proper ✅
- Lifecycle hooks implemented ✅
- Error handling is good ✅
- Guards are properly used ✅

### ❌ **What's Missing:**
1. **Video DTOs** - No `video.dto.ts` file (HIGH PRIORITY)
2. **DTO-based Validation** - Validation in service, not DTOs (HIGH PRIORITY)
3. **Response DTOs** - No response DTOs extending base classes (MEDIUM PRIORITY)
4. **Swagger Docs** - Missing because no DTOs (MEDIUM PRIORITY)
5. **Testing** - No tests (HIGH PRIORITY)

### 🎯 **Next Steps:**
1. **Create `src/libs/dtos/video.dto.ts`** following `appointment.dto.ts` pattern
2. **Update controller** to use DTOs
3. **Update service** to accept/return DTOs
4. **Add tests**
5. **Enhance with interceptors, health checks, etc.**

---

## 🔗 References

- **Existing DTO Pattern:** `src/libs/dtos/appointment.dto.ts`
- **Existing Config Pattern:** `src/config/video.config.ts`, `src/config/cache.config.ts`
- **Response DTOs:** `src/libs/dtos/common-response.dto.ts`
- **Validation:** `src/config/validation-pipe.config.ts`

