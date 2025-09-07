# Healthcare Backend API Documentation

This folder contains all API-related documentation and testing resources for the Healthcare Backend system.

## 📁 Contents

### 🧪 Testing Resources
- **[Postman Collection](postman_collection.json)** - Complete API collection with all endpoints
- **[Postman Environment](postman_environment.json)** - Environment variables for testing
- **[WhatsApp Integration](WHATSAPP_INTEGRATION.md)** - WhatsApp Business API setup guide

### 📚 API Documentation
- **[Swagger/OpenAPI Documentation](http://localhost:8088/api)** - Interactive API documentation (when server is running)

## 🚀 Quick Start with Postman

### 1. Import Collection
1. Open Postman
2. Click "Import" button
3. Select `postman_collection.json` from this folder
4. Import `postman_environment.json` as environment

### 2. Set Environment Variables
The environment file includes:
- `baseUrl`: http://localhost:8088
- `accessToken`: (set after authentication)
- `refreshToken`: (set after authentication)
- `userId`: (set after login)
- `clinicId`: (set for multi-clinic testing)

### 3. Start Testing
1. Start the development server: `npm run start:dev`
2. Use the "Authentication" folder to login and get JWT token
3. Set the JWT token in environment variables
4. Test other endpoints

## 🌐 API Endpoints

### Authentication Endpoints (`/auth`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/register` | User registration | No |
| POST | `/auth/login` | User login (password/OTP) | No |
| POST | `/auth/refresh` | Refresh JWT token | No |
| POST | `/auth/logout` | Logout user | Yes |
| POST | `/auth/request-otp` | Request OTP (email/SMS/WhatsApp) | No |
| POST | `/auth/verify-otp` | Verify OTP | No |
| POST | `/auth/forgot-password` | Request password reset | No |
| POST | `/auth/reset-password` | Reset password | No |
| GET | `/auth/sessions` | Get user sessions | Yes |
| POST | `/auth/revoke-session` | Revoke specific session | Yes |

### User Management (`/users`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/users` | Get all users (admin) | Yes |
| GET | `/users/:id` | Get user by ID | Yes |
| GET | `/users/profile` | Get current user profile | Yes |
| PUT | `/users/profile` | Update user profile | Yes |
| GET | `/users/patients` | Get all patients | Yes |
| GET | `/users/doctors` | Get all doctors | Yes |
| GET | `/users/receptionists` | Get all receptionists | Yes |
| GET | `/users/clinic-admins` | Get all clinic admins | Yes |

### Appointment Management (`/appointments`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/appointments` | List appointments | Yes |
| POST | `/appointments` | Create appointment | Yes |
| GET | `/appointments/:id` | Get appointment by ID | Yes |
| PUT | `/appointments/:id` | Update appointment | Yes |
| DELETE | `/appointments/:id` | Cancel appointment | Yes |
| GET | `/appointments/doctor/:doctorId/availability` | Check doctor availability | Yes |
| GET | `/appointments/user/:userId/upcoming` | Get user's upcoming appointments | Yes |

### Clinic Management (`/clinics`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/clinics` | List clinics | Yes |
| POST | `/clinics` | Create clinic (admin) | Yes |
| GET | `/clinics/:id` | Get clinic details | Yes |
| PUT | `/clinics/:id` | Update clinic | Yes |
| DELETE | `/clinics/:id` | Delete clinic (admin) | Yes |
| GET | `/clinics/:id/doctors` | List clinic doctors | Yes |
| GET | `/clinics/:id/patients` | List clinic patients | Yes |
| GET | `/clinics/my-clinic` | Get current user's clinic | Yes |

### Health Monitoring (`/health`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/health` | Basic health check | No |
| GET | `/health/detailed` | Detailed system health | No |
| GET | `/health/api` | API-specific health | No |

### Cache Management (`/cache`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/cache` | Get cache information | Yes |
| DELETE | `/cache` | Clear cache entries | Yes |
| POST | `/cache/config` | Configure cache settings | Yes |
| GET | `/cache/benchmark` | Benchmark cache performance | Yes |

### Logging & Monitoring (`/logger`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/logger` | Logging dashboard | Yes |
| GET | `/logger/logs/data` | Get log data | Yes |
| GET | `/logger/events/data` | Get event data | Yes |
| POST | `/logger/logs/clear` | Clear logs | Yes |
| POST | `/logger/events/clear` | Clear events | Yes |

## 🔐 Authentication

### JWT Token Authentication
Most endpoints require a JWT token in the Authorization header:

```http
Authorization: Bearer <your-jwt-token>
```

### Multi-Clinic Support
For multi-clinic operations, include the clinic ID in headers:

```http
X-Clinic-ID: <clinic-id>
```

## 📝 Request/Response Examples

### Login Request
```json
POST /auth/login
{
  "email": "doctor@clinic.com",
  "password": "password123"
}
```

### Login Response
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "doctor@clinic.com",
    "role": "DOCTOR",
    "clinicId": "clinic-001"
  }
}
```

### Create Appointment Request
```json
POST /appointments
{
  "patientId": "patient-uuid",
  "doctorId": "doctor-uuid",
  "date": "2025-09-10T10:00:00Z",
  "type": "CONSULTATION",
  "notes": "Regular checkup"
}
```

### OTP Request
```json
POST /auth/request-otp
{
  "identifier": "user@example.com",
  "deliveryMethod": "whatsapp"
}
```

## 🧪 Testing Scenarios

### 1. Authentication Flow
1. Register a new user
2. Login with credentials
3. Use JWT token for authenticated requests
4. Refresh token when needed

### 2. Multi-Clinic Testing
1. Set different clinic IDs in headers
2. Verify data isolation between clinics
3. Test clinic-specific endpoints

### 3. Role-Based Access
1. Test with different user roles (DOCTOR, PATIENT, ADMIN)
2. Verify permission-based access control
3. Test RBAC restrictions

### 4. Error Handling
1. Test with invalid tokens
2. Test with missing required fields
3. Test with invalid clinic IDs
4. Verify proper error responses

## 🔧 Environment Variables

### Development Environment
```json
{
  "baseUrl": "http://localhost:8088",
  "apiUrl": "http://localhost:8088/api",
  "swaggerUrl": "http://localhost:8088/api",
  "jwtSecret": "your-secret-key"
}
```

### Production Environment
```json
{
  "baseUrl": "https://api.healthcare.com",
  "apiUrl": "https://api.healthcare.com/api",
  "swaggerUrl": "https://api.healthcare.com/api"
}
```

## 📊 API Performance

### Expected Response Times
- Authentication: < 200ms
- User operations: < 100ms
- Appointment operations: < 150ms
- Clinic operations: < 200ms
- Health checks: < 50ms

### Rate Limits
- Authentication: 5 requests/minute
- API calls: 100 requests/minute
- File uploads: 10 requests/minute

## 🚨 Error Codes

| Code | Description | Solution |
|------|-------------|----------|
| 400 | Bad Request | Check request format and required fields |
| 401 | Unauthorized | Provide valid JWT token |
| 403 | Forbidden | Check user permissions and role |
| 404 | Not Found | Verify endpoint URL and resource ID |
| 409 | Conflict | Check for duplicate data or conflicts |
| 429 | Too Many Requests | Implement rate limiting |
| 500 | Internal Server Error | Check server logs and contact support |

## 🔐 Security Features

### Authentication Methods
- **Password-based**: Traditional email/password login
- **OTP-based**: One-time password via email, SMS, or WhatsApp
- **Social Login**: Google, Facebook, Apple integration
- **Magic Link**: Passwordless authentication

### Security Headers
- **Authorization**: Bearer token for JWT authentication
- **X-Clinic-ID**: Clinic identifier for multi-tenant operations
- **X-Request-ID**: Request correlation ID for tracing

## 📞 Support

### API Issues
- Check the [Developer Guide](../DEVELOPER_GUIDE.md) for technical details
- Review error logs and response messages
- Contact the development team for API-specific issues

### Testing Issues
- Verify environment variables are set correctly
- Check that the server is running on the correct port
- Ensure JWT tokens are valid and not expired

---

**Note**: This API documentation is automatically generated and updated. For the most current information, always refer to the live Swagger documentation at `/api` when the server is running.