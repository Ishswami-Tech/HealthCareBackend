# Auth Service

**Purpose:** Authentication & authorization with JWT, OTP, and social auth
**Location:** `src/services/auth`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { AuthService } from '@services/auth';

@Injectable()
export class MyService {
  constructor(private readonly authService: AuthService) {}

  async login(email: string, password: string) {
    const result = await this.authService.login({ email, password });
    return result; // { accessToken, refreshToken, user }
  }
}
```

---

## Key Features

- ✅ **JWT Authentication** - Access & refresh tokens
- ✅ **Session Management** - Max 5 concurrent sessions per user
- ✅ **Progressive Lockout** - 10m → 25m → 45m → 1h → 6h
- ✅ **OTP-based 2FA** - Email/SMS OTP verification
- ✅ **Social Authentication** - Google OAuth integration
- ✅ **Password Management** - Forgot password, reset password, change password
- ✅ **Device Fingerprinting** - Track sessions by device
- ✅ **Rate Limiting** - Prevent brute force attacks

---

## API Endpoints

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/auth/register` | POST | Public | User registration |
| `/auth/login` | POST | Public | User login |
| `/auth/refresh` | POST | Public | Refresh access token |
| `/auth/logout` | POST | Authenticated | User logout |
| `/auth/forgot-password` | POST | Public | Request password reset |
| `/auth/reset-password` | POST | Public | Reset password with token |
| `/auth/change-password` | POST | Authenticated | Change password |
| `/auth/request-otp` | POST | Public | Request OTP |
| `/auth/verify-otp` | POST | Public | Verify OTP |
| `/auth/google` | POST | Public | Google OAuth login |
| `/auth/sessions` | GET | Authenticated | Get active sessions |

[Full API documentation](../../docs/api/README.md)
[API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Usage Examples

### Example 1: User Registration

```typescript
const result = await this.authService.register({
  email: 'user@example.com',
  password: 'SecurePass123!',
  name: 'John Doe',
  role: 'PATIENT',
});
// Returns: { user, accessToken, refreshToken }
```

### Example 2: Login with OTP

```typescript
// Step 1: Request OTP
await this.authService.requestOtp({ email: 'user@example.com' });

// Step 2: Verify OTP
const result = await this.authService.verifyOtp({
  email: 'user@example.com',
  otp: '123456',
});
// Returns: { accessToken, refreshToken, user }
```

### Example 3: Session Management

```typescript
// Get active sessions
const sessions = await this.authService.getSessions(userId);

// Logout from specific session
await this.authService.logout(userId, sessionId);

// Logout from all sessions
await this.authService.logoutAll(userId);
```

---

## Security Features

### Progressive Lockout
- 1st lockout: 10 minutes
- 2nd lockout: 25 minutes
- 3rd lockout: 45 minutes
- 4th lockout: 1 hour
- 5th+ lockout: 6 hours

### Session Management
- Maximum 5 concurrent sessions per user
- Automatic cleanup of oldest session when limit exceeded
- Device fingerprinting for session tracking
- Suspicious session detection every 30 minutes

### Rate Limiting
- Login: 10 attempts per 30 minutes
- OTP: 5 requests per 15 minutes
- Password reset: 3 requests per hour

---

## Configuration

```env
# JWT Configuration
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Session Configuration
MAX_CONCURRENT_SESSIONS=5
SESSION_INACTIVITY_THRESHOLD=15m

# OTP Configuration
OTP_EXPIRES_IN=5m

# Rate Limiting
AUTH_RATE_LIMIT_MAX_ATTEMPTS=10
AUTH_RATE_LIMIT_WINDOW=30m
```

[Full environment variables guide](../../docs/ENVIRONMENT_VARIABLES.md)

---

## Testing

```bash
# Run auth service tests
pnpm test auth
```

---

## Related Documentation

- [RBAC Implementation](../../docs/features/RBAC_COMPLETE_IMPLEMENTATION.md)
- [Developer Guide](../../docs/DEVELOPER_GUIDE.md)
- [API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Troubleshooting

**Issue 1: Token Expired**
- **Solution:** Use refresh token endpoint to get new access token

**Issue 2: Account Locked**
- **Solution:** Wait for lockout period to expire or contact admin

**Issue 3: OTP Not Received**
- **Solution:** Check email spam folder or request new OTP

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
