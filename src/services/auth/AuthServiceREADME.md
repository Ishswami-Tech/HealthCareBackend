# Authentication Service

## Overview
The Authentication Service provides a complete solution for user authentication, authorization, and account management in the Healthcare Application. It handles user registration, login (with multiple authentication methods), password reset, session management, and security features.

## Login Workflow

The application supports multiple authentication methods, each with its own workflow:

### 1. Password-Based Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│             │     │             │     │             │     │             │
│    User     │────▶│  Frontend   │────▶│  Backend    │────▶│   Redis     │
│             │     │             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                  │                   │                   │
       │  Enter Email     │                   │                   │
       │  & Password      │                   │                   │
       │─────────────────▶│                   │                   │
       │                  │  POST /auth/login │                   │
       │                  │  (email, password)│                   │
       │                  │──────────────────▶│                   │
       │                  │                   │  Validate User    │
       │                  │                   │─────────────────  │
       │                  │                   │                   │
       │                  │                   │  Store Session    │
       │                  │                   │──────────────────▶│
       │                  │                   │                   │
       │                  │  Return Tokens    │                   │
       │                  │◀──────────────────│                   │
       │  Login Success   │                   │                   │
       │◀─────────────────│                   │                   │
       │                  │                   │                   │
```

### 2. Enhanced OTP-Based Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│             │     │             │     │             │     │             │     │             │     │             │
│    User     │────▶│  Frontend   │────▶│  Backend    │────▶│   Redis     │────▶│  WhatsApp/  │────▶│   Email     │
│             │     │             │     │             │     │             │     │  SMS Service│     │   Service   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                  │                   │                   │                   │                   │
       │  Enter Email     │                   │                   │                   │                   │
       │─────────────────▶│                   │                   │                   │                   │
       │                  │  POST /auth/      │                   │                   │                   │
       │                  │  request-otp      │                   │                   │                   │
       │                  │──────────────────▶│                   │                   │
       │                  │                   │  Generate OTP     │                   │                   │
       │                  │                   │─────────────────  │                   │                   │
       │                  │                   │                   │                   │                   │
       │                  │                   │  Store Hashed OTP │                   │                   │
       │                  │                   │──────────────────▶│                   │                   │
       │                  │                   │                   │                   │                   │
       │                  │                   │  Try Primary      │                   │                   │
       │                  │                   │  Delivery Method  │                   │                   │
       │                  │                   │──────────────────────────────────────▶│                   │
       │                  │                   │                   │                   │                   │
       │                  │                   │  If Failed,       │                   │                   │
       │                  │                   │  Try Fallback     │                   │                   │
       │                  │                   │  Methods          │                   │                   │
       │                  │                   │──────────────────────────────────────────────────────────▶│
       │                  │                   │                   │                   │                   │
       │                  │  Success Response │                   │                   │                   │
       │                  │  with Delivery    │                   │                   │                   │
       │                  │  Methods Used     │                   │                   │                   │
       │                  │◀──────────────────│                   │                   │                   │
       │                  │                   │                   │                   │                   │
       │  Receive OTP     │                   │                   │                   │                   │
       │◀─────────────────────────────────────────────────────────────────────────────────────────────────│
       │                  │                   │                   │                   │                   │
       │  Enter OTP       │                   │                   │                   │                   │
       │─────────────────▶│                   │                   │                   │                   │
       │                  │  POST /auth/      │                   │                   │                   │
       │                  │  verify-otp       │                   │                   │                   │
       │                  │──────────────────▶│                   │                   │                   │
       │                  │                   │  Verify OTP       │                   │                   │
       │                  │                   │──────────────────▶│                   │                   │
       │                  │                   │                   │                   │                   │
       │                  │                   │  Delete OTP       │                   │                   │
       │                  │                   │──────────────────▶│                   │                   │
       │                  │                   │                   │                   │                   │
       │                  │                   │  Store Session    │                   │                   │
       │                  │                   │──────────────────▶│                   │                   │
       │                  │                   │                   │                   │                   │
       │                  │  Return Tokens    │                   │                   │
       │                  │◀──────────────────│                   │                   │
       │  Login Success   │                   │                   │                   │                   │
       │◀─────────────────│                   │                   │                   │                   │
       │                  │                   │                   │                   │                   │
```

### 3. Magic Link Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│             │     │             │     │             │     │             │     │             │
│    User     │────▶│  Frontend   │────▶│  Backend    │────▶│   Redis     │────▶│   Email     │
│             │     │             │     │             │     │             │     │   Service   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                  │                   │                   │                   │
       │  Enter Email     │                   │                   │                   │
       │─────────────────▶│                   │                   │                   │
       │                  │  POST /auth/      │                   │                   │
       │                  │  magic-link       │                   │                   │
       │                  │──────────────────▶│                   │                   │
       │                  │                   │  Generate Token   │                   │
       │                  │                   │─────────────────  │                   │
       │                  │                   │                   │                   │
       │                  │                   │  Store Token      │                   │
       │                  │                   │──────────────────▶│                   │
       │                  │                   │                   │                   │
       │                  │                   │  Send Magic Link  │                   │
       │                  │                   │──────────────────────────────────────▶│
       │                  │                   │                   │                   │
       │                  │  Success Response │                   │                   │
       │                  │◀──────────────────│                   │                   │
       │                  │                   │                   │                   │
       │  Receive Email   │                   │                   │                   │
       │◀─────────────────────────────────────────────────────────────────────────────│
       │                  │                   │                   │                   │
       │  Click Link      │                   │                   │                   │
       │─────────────────▶│                   │                   │                   │
       │                  │  POST /auth/      │                   │                   │
       │                  │  verify-magic-link│                   │                   │
       │                  │──────────────────▶│                   │                   │
       │                  │                   │  Verify Token     │                   │
       │                  │                   │──────────────────▶│                   │
       │                  │                   │                   │                   │
       │                  │                   │  Delete Token     │                   │
       │                  │                   │──────────────────▶│                   │
       │                  │                   │                   │                   │
       │                  │                   │  Store Session    │                   │
       │                  │                   │──────────────────▶│                   │
       │                  │                   │                   │                   │
       │                  │  Return Tokens    │                   │                   │
       │                  │◀──────────────────│                   │                   │
       │  Auto-Redirect   │                   │                   │                   │
       │◀─────────────────│                   │                   │                   │
       │                  │                   │                   │                   │
```

### 4. Social Login Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│             │     │             │     │             │     │             │     │             │
│    User     │────▶│  Frontend   │────▶│  OAuth      │────▶│  Backend    │────▶│   Redis     │
│             │     │             │     │  Provider   │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                  │                   │                   │                   │
       │  Click Social    │                   │                   │                   │
       │  Login Button    │                   │                   │                   │
       │─────────────────▶│                   │                   │                   │
       │                  │  Redirect to      │                   │                   │
       │                  │  OAuth Provider   │                   │                   │
       │                  │──────────────────▶│                   │                   │
       │                  │                   │                   │                   │
       │  Authenticate    │                   │                   │                   │
       │  with Provider   │                   │                   │                   │
       │─────────────────▶│                   │                   │                   │
       │                  │                   │                   │                   │
       │                  │  Return OAuth     │                   │                   │
       │                  │  Token            │                   │                   │
       │                  │◀──────────────────│                   │                   │
       │                  │                   │                   │                   │
       │                  │  POST /auth/social│                   │                   │
       │                  │  /[provider]      │                   │                   │
       │                  │──────────────────────────────────────▶│                   │
       │                  │                   │                   │                   │
       │                  │                   │  Verify Token     │                   │
       │                  │                   │─────────────────  │                   │
       │                  │                   │                   │                   │
       │                  │                   │  Create/Update    │                   │
       │                  │                   │  User             │                   │
       │                  │                   │─────────────────  │                   │
       │                  │                   │                   │                   │
       │                  │                   │  Store Session    │                   │
       │                  │                   │──────────────────▶│                   │
       │                  │                   │                   │                   │
       │                  │  Return Tokens    │                   │                   │
       │                  │◀──────────────────│                   │                   │
       │  Login Success   │                   │                   │                   │
       │◀─────────────────│                   │                   │                   │
       │                  │                   │                   │                   │
```

## Features

### Authentication
- **Multiple Authentication Methods**: 
  - Password-based authentication
  - Enhanced OTP-based authentication with intelligent fallback
  - Magic Link authentication
  - Social Login (Google, Facebook, Apple)
- **JWT-based Authentication**: Secure token-based authentication with access and refresh tokens
- **Session Management**: Track and manage user sessions across devices
- **Automatic Session Invalidation**: Sessions are invalidated after password changes or manual logout

### Enhanced OTP System
- **Multi-Channel Delivery**: Send OTPs via WhatsApp, SMS, or Email
- **Intelligent Fallback**: Automatically try alternative delivery methods if the preferred method fails
- **Retry Logic**: Implement exponential backoff for failed delivery attempts
- **Delivery Confirmation**: Track which methods successfully delivered the OTP
- **Consistent OTP**: Use the same OTP across all delivery methods
- **Detailed Response**: API responses include information about which delivery methods were used

### Security
- **Password Strength Validation**: Ensures users create strong passwords
- **Rate Limiting**: Prevents brute force attacks (configurable)
- **Account Lockout**: Temporary lockout after multiple failed attempts
- **Secure Password Reset**: Two-step process with email verification
- **OTP Authentication**: Time-limited one-time passwords for passwordless login
- **Session Tracking**: Monitor active sessions with device information

### User Management
- **User Registration**: Create new user accounts with role-specific details
- **Email Verification**: Verify user email addresses
- **Password Management**: Reset and update passwords securely

## API Endpoints

### Registration and Login
- `POST /auth/register` - Register a new user
- `POST /auth/login` - Login with password or OTP
- `POST /auth/logout` - Logout and invalidate current session
- `POST /auth/refresh` - Refresh access token

### Enhanced OTP Authentication
- `POST /auth/request-otp` - Request an OTP with intelligent fallback between delivery methods
- `POST /auth/verify-otp` - Verify OTP and login
- `POST /auth/check-otp-status` - Check if user has an active OTP
- `POST /auth/invalidate-otp` - Invalidate an existing OTP

### Magic Link Authentication
- `POST /auth/magic-link` - Request a magic link for passwordless login
- `POST /auth/verify-magic-link` - Verify magic link and login

### Social Login
- `POST /auth/social/google` - Login with Google
- `POST /auth/social/facebook` - Login with Facebook
- `POST /auth/social/apple` - Login with Apple

### Password Management
- `POST /auth/forgot-password` - Initiate password reset process
- `POST /auth/reset-password` - Reset password with token

### Session Management
- `GET /auth/verify` - Verify current token
- `GET /auth/profile` - Get current user profile
- `GET /auth/sessions` - List active sessions
- `POST /auth/revoke-session` - Revoke a specific session

## Usage Examples

### Registration
```typescript
// Register a new user
const newUser = await axios.post('/auth/register', {
  email: 'user@example.com',
  password: 'SecurePassword123!',
  firstName: 'John',
  lastName: 'Doe',
  role: 'PATIENT',
  // Other user details
});
```

### Password Login
```typescript
// Login with password
const loginResponse = await axios.post('/auth/login', {
  email: 'user@example.com',
  password: 'SecurePassword123!'
});

// Store tokens
localStorage.setItem('accessToken', loginResponse.data.access_token);
localStorage.setItem('refreshToken', loginResponse.data.refresh_token);
```

### Enhanced OTP Login
```typescript
// Step 1: Request OTP with preferred delivery method
const otpResponse = await axios.post('/auth/request-otp', {
  email: 'user@example.com',
  deliveryMethod: 'whatsapp' // 'email', 'sms', 'whatsapp', or 'both'
});

console.log(otpResponse.data);
// Example response:
// {
//   message: "OTP sent successfully via WhatsApp and email",
//   deliveredVia: ["WhatsApp", "email"]
// }

// Step 2: Verify OTP and login
const otpLoginResponse = await axios.post('/auth/verify-otp', {
  email: 'user@example.com',
  otp: '123456'
});

// Store tokens
localStorage.setItem('accessToken', otpLoginResponse.data.access_token);
localStorage.setItem('refreshToken', otpLoginResponse.data.refresh_token);
```

### Magic Link Login
```typescript
// Step 1: Request magic link
await axios.post('/auth/magic-link', {
  email: 'user@example.com'
});

// Step 2: User clicks link in email, then frontend verifies the token
const magicLinkResponse = await axios.post('/auth/verify-magic-link', {
  token: 'token-from-url-query-parameter'
});

// Store tokens
localStorage.setItem('accessToken', magicLinkResponse.data.access_token);
localStorage.setItem('refreshToken', magicLinkResponse.data.refresh_token);
```

### Social Login
```typescript
// Google Login
const googleLoginResponse = await axios.post('/auth/social/google', {
  token: 'google-oauth-token'
});

// Facebook Login
const facebookLoginResponse = await axios.post('/auth/social/facebook', {
  token: 'facebook-access-token'
});

// Apple Login
const appleLoginResponse = await axios.post('/auth/social/apple', {
  token: 'apple-id-token'
});
```

### Password Reset
```typescript
// Step 1: Request password reset
await axios.post('/auth/forgot-password', {
  email: 'user@example.com'
});

// Step 2: Reset password with token from email
await axios.post('/auth/reset-password', {
  token: 'reset-token-from-email',
  newPassword: 'NewSecurePassword123!'
});
```

## Configuration

The authentication service can be configured through environment variables:

```
JWT_SECRET=your-jwt-secret
JWT_EXPIRATION=1h
REFRESH_TOKEN_EXPIRATION=7d
OTP_EXPIRATION=10m
PASSWORD_RESET_EXPIRATION=1h
MAGIC_LINK_EXPIRATION=15m
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION=30m
SMS_PROVIDER_API_KEY=your-sms-api-key
SMS_PROVIDER_URL=https://api.sms-provider.com/send
SMS_SENDER_ID=HealthApp
WHATSAPP_API_KEY=your-whatsapp-api-key
WHATSAPP_PHONE_NUMBER_ID=your-whatsapp-phone-number-id
WHATSAPP_OTP_TEMPLATE_ID=otp_verification
GOOGLE_CLIENT_ID=your-google-client-id
FACEBOOK_APP_ID=your-facebook-app-id
APPLE_CLIENT_ID=your.app.bundle.id
```

## Security Considerations

- Always use HTTPS in production
- Store tokens securely (HttpOnly cookies recommended)
- Implement proper CORS configuration
- Consider adding additional security headers
- Regularly rotate JWT secrets in production
- Validate social login tokens on the server side
- OTPs are hashed before storage using bcrypt
- OTPs expire after 10 minutes
- Maximum of 5 failed attempts before the OTP is invalidated
- Rate limiting to prevent brute force attacks

## Dependencies

- NestJS
- Prisma ORM
- Redis (for token and session storage)
- NodeMailer (for email notifications)
- SMS Provider API (for SMS delivery)
- WhatsApp Business API (for WhatsApp messages)
- OAuth Providers (Google, Facebook, Apple)

## Error Handling

The service returns appropriate HTTP status codes:
- `200/201` - Success
- `400` - Bad request (validation errors)
- `401` - Unauthorized (invalid credentials)
- `403` - Forbidden (insufficient permissions)
- `429` - Too many requests (rate limiting)
- `500` - Server error

## Logging and Monitoring

All authentication events are logged for audit purposes:
- Login attempts (successful and failed)
- Password changes
- OTP requests and delivery status
- Magic link requests
- Social login events
- Session management events 