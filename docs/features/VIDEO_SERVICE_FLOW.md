# Video + Timeslot Flow (Unified Video Service)

## 1. Overview

`@services/video` is intentionally the **only** video module in the backend. It
exposes `VideoModule`, `VideoController`, `VideoService`, and the provider
abstractions (OpenVidu + Jitsi) via `index.ts`, so every consumer—even the
appointment timeslot machinery—talks to the same API surface. The goal is to
keep video coordination, caching, and provider checks centralized while letting
multiple providers be switched dynamically through `VIDEO_PROVIDER` and
`VIDEO_ENABLED`.

## 2. Key public endpoints

| Path                              | Method                | Description                                                                                                                 | Guards/Guards                                                               |
| --------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `POST /video/token`               | `generateToken()`     | Issues a provider token for an appointment/time slot. Verifies appointment ownership, clinic context, and participant role. | `JwtAuthGuard`, `RolesGuard`, `RequireResourcePermission('video','create')` |
| `POST /video/consultation/start`  | `startConsultation()` | Marks the video call as started (updates `VideoCall`, changes status, caches call info).                                    | Same + profile guards                                                       |
| `POST /video/consultation/end`    | `endConsultation()`   | Finalizes the call, stops recording if necessary, computes duration, queues recording jobs.                                 |
| `POST /video/recording/start`     | `startRecording()`    | Launches recording, updates call metadata, queues processing.                                                               |
| `POST /video/recording/stop`      | `stopRecording()`     | Finalizes recording, stores recording URL and metadata in cache.                                                            |
| `GET /video/consultation/history` | `getHistory()`        | Returns cached/persisted video calls filtered by user/time slot.                                                            |

Every entry point uses the shared `ValidationPipe` configuration, `@ApiResponse`
decorators, and the clinic/role guards so callers only see a single
authenticated interface.

## 3. Timeslot → Video integration

`appointments/plugins/video/clinic-video.plugin.ts` is the conduit between
scheduled time slots and video operations:

- When an appointment reaches the video phase, the plugin calls
  `videoService.generateMeetingToken()` (pass appointmentId, userId, role, and
  the user’s displayName/email). The service checks `appointment` + `payment` +
  participant linkage before requesting an OpenVidu/Jitsi token.
- `startConsultationSession` and `endConsultationSession` in the plugin map
  directly to `videoService.startConsultation()`/`endConsultation()`, ensuring
  the time slot lifecycle is mirrored inside the video call (status updates,
  bookkeeping, and analytics events).
- Real-time tracking hooks (initialize tracking, participant joined/left,
  quality updates, recording status, etc.) live in the same plugin and call
  `VideoConsultationTracker`, so timeslot metrics stay aligned with in-call
  telemetry.
- Any appointment metadata that the appointments service already manages
  (clinicId, doctorId, patientId, scheduled slot) is re-used inside
  `VideoService` to validate access, enforce HIPAA-like logging, and tie videos
  to appointments in the database via `getVideoConsultationDelegate`.

`AnalyticsService` reuses the same unified video/appointment data via
`AppointmentAnalyticsService.getTimeSlotAnalytics()` when building service
utilization dashboards. That call happens inside `getServiceUtilization()`,
mapping time slot usage directly back to video-driven interactions.

## 4. Provider selection, health checks, and caching

- `VideoProviderFactory` reads `VIDEO_PROVIDER` (default `openvidu`) and
  `VIDEO_ENABLED`. It injects both providers and exposes
  `getProvider()`/`getFallbackProvider()` plus `getProviderWithFallback()` for
  resilient operations.
- `VideoService.onModuleInit()` fetches a provider via
  `providerFactory.getProviderWithFallback()`. If the primary provider is
  unhealthy, warning logs are emitted (OpenVidu → fallback to Jitsi), but the
  API keeps running so core healthcare traffic stays up.
- Cache keys:
  - `video_session:<appointmentId>` stores the live session metadata
    (participants, technical issues, recording URL). TTL:
    `MEETING_CACHE_TTL = 3600` seconds (1h).
  - `videocall:<videoCall.id>` stores a stringified `VideoCall` snapshot
    (session history + metadata). TTL: `VIDEO_CACHE_TTL = 1800` seconds (30m).
    `CALL_CACHE_TTL = 300` seconds (5m) is used when per-call information needs
    a tighter window.
  - When technical issues or recording URLs are updated, the cache entry is
    re-written with the same key/TTL so dashboard queries see the latest
    diagnostics.
- Cached entries are used by analytics endpoints (e.g.,
  `VideoController.getConsultationStatus`) before falling back to the database,
  which keeps timeslot dashboards responsive.
- Recording jobs are queued via `QueueService` (`VIDEO_RECORDING` job type) so
  media processing happens asynchronously; caching ensures that even if the job
  is still running, clients see the pending recording URL.

## 5. Token generation & edge cases

1. Client (doctor/patient) hits `POST /video/token` as soon as the time slot is
   about to start.
2. `VideoService.generateMeetingToken()`:
   - Validates the appointment exists, belongs to the requested clinic/time
     slot, and that the requester is a participant.
   - Calls `CacheService` to store session metadata (roomId, roomName,
     meetingUrl, participant info) under `video_session:<appointmentId>` so
     `reportTechnicalIssue()` and `getConsultationStatus()` can find it fast.
   - Picks a provider via `VideoProviderFactory`. If the primary provider health
     check fails, it logs the warning, tries the fallback, but returns whichever
     provider is currently acting as “best effort”.
   - Emits `eventService.emitEnterprise('video.token.generated', …)` so
     analytics/telemetry layers (and timeslot dashboards) can watch spike
     events.
   - Returns `VideoTokenResponse` with roomId/name, token, meeting URL,
     encryption key, and expirations. The response is mapped into
     `VideoTokenResponseDto`.

3. `startConsultation()`/`endConsultation()` update `VideoCall` records in the
   database via `getVideoConsultationDelegate`, which persists the
   appointment/time slot connection. Each update also refreshes the
   `videocall:<id>` cache.
4. Recording lifecycle:
   - `startRecording()` initiates provider-side recording and updates the cached
     call with `recordingUrl`.
   - `.processRecording()` queues a job; the queue worker calls
     `executeProcessRecording()` which patches the cached session
     (`video_session:<appointmentId>`) with the final recording URL.
   - TTLs prevent stale sessions; once a call is marked `completed`, cached
     entries are either covered by shorter TTLs or overwritten with `null`.

Edge cases covered:

- **Multiple providers**: `VideoProviderFactory` automatically switches between
  OpenVidu and Jitsi based on `VIDEO_PROVIDER`, and `getProviderWithFallback()`
  carries a fallback health check while still returning a provider reference
  (OpenVidu preferred, Jitsi fallback). All token/recording calls flow through
  the same provider instance to keep audit logs consistent.
- **Cache invalidation**: `reportTechnicalIssue()` and
  `executeProcessRecording()` always refresh the `video_session` cache;
  `updateVideoCall()` and `storeVideoCall()` refresh the `videocall` cache with
  the latest state. TTLs are aligned with the expected lifetime of the data
  (meetings: 1h, calls: 30m, technical details: 1h).
- **Token generation & timeslot validation**: tokens cannot be issued if the
  appointment is missing or the requester is not associated with the scheduled
  time slot, so frontend flows (timeslot pages, real-time consult views) either
  get a valid token or a descriptive `HealthcareError`.
- **Event surfaces**: `ClinicVideoPlugin` plus `VideoController` emit enterprise
  events for `video.token.generated`, `video.call.started`, etc., which the
  analytics stack uses for timeslot dashboards and queue monitoring.

## 6. Monitoring & Analytics tie-back

- `AnalyticsService.getServiceUtilization()` reuses
  `AppointmentAnalyticsService.getTimeSlotAnalytics()` to show how video-enabled
  slots perform (paired with `CacheService` for faster lookups).
- `VideoConsultationTracker` operations (initialize/track/end) are invoked by
  the appointments plugin, ensuring every timeslot action can later be
  correlated with video telemetry (joined/leaving times, quality votes,
  recording state).
- The single API means any timeslot change (start/end/recording) is logged via
  `LoggingService` at `LogType.APPOINTMENT` or `LogType.BUSINESS`, and the data
  flows into enterprise events and queue jobs for processors to act on.

## Environment toggles

- Feature flags live in `.env`: `VIDEO_ENABLED=true` and
  `VIDEO_PROVIDER=openvidu` (or `jitsi`). When video is disabled the factory
  throws a descriptive error so callers can gracefully degrade to audio or
  in-person flows.
- Cache TTLs and queue priorities are defined in `VideoService` constants
  (`VIDEO_CACHE_TTL`, `CALL_CACHE_TTL`, `MEETING_CACHE_TTL`) so adjustments can
  be made centrally if timeslot retention requirements change.

This documentation should be updated alongside any future enhancements to the
unified video API or the appointment timeslot plugin to ensure the single
surface stays synchronized with downstream analytics.
