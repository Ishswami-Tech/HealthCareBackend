# Video Service

**Purpose:** Video consultation management (OpenVidu Pro)
**Location:** `src/services/video`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { VideoService } from '@services/video';

@Injectable()
export class MyService {
  constructor(private readonly videoService: VideoService) {}

  async startConsultation(appointmentId: string) {
    const token = await this.videoService.generateToken(appointmentId);
    return { token, sessionId: appointmentId };
  }
}
```

---

## Key Features

- ✅ **OpenVidu Pro Integration** - Enterprise video platform
- ✅ **Session Management** - Create, start, end consultations
- ✅ **Recording** - Session recording support
- ✅ **Screen Sharing** - Share screen during consultation
- ✅ **Participant Management** - Manage participants
- ✅ **Analytics** - Video quality metrics

---

## API Endpoints

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/video/token` | POST | PATIENT, DOCTOR | Generate video token |
| `/video/consultation/start` | POST | PATIENT, DOCTOR | Start consultation |
| `/video/consultation/end` | POST | PATIENT, DOCTOR | End consultation |
| `/video/recording/start` | POST | DOCTOR, CLINIC_ADMIN | Start recording |
| `/video/recording/stop` | POST | DOCTOR, CLINIC_ADMIN | Stop recording |

[Full API documentation](../../docs/api/README.md)

---

## Usage Examples

```typescript
// Generate token for video session
const { token, sessionId } = await this.videoService.generateToken(
  appointmentId,
  userId,
  role  // 'PUBLISHER' or 'SUBSCRIBER'
);

// Start consultation
await this.videoService.startConsultation(appointmentId);

// End consultation
await this.videoService.endConsultation(appointmentId);
```

---

## Related Documentation

- [Video Service Documentation](../../docs/VIDEO_SERVICE.md)
- [OpenVidu Pro Setup](../../docs/OPENVIDU_PRO_SETUP.md)
- [OpenVidu Custom Domain](../../docs/OPENVIDU_CUSTOM_DOMAIN_DEPLOYMENT.md)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
