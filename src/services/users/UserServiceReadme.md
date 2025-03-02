# User Service Documentation

## Table of Contents
- [Overview](#overview)
- [Authentication](#authentication)
  - [Registration](#registration)
  - [Login](#login)
  - [Logout](#logout)
- [User Roles and Permissions](#user-roles-and-permissions)
- [API Endpoints](#api-endpoints)
- [Data Models](#data-models)
- [Error Handling](#error-handling)
- [Security](#security)

## Overview
The User Service handles user management, authentication, and authorization in the Healthcare Backend system. It provides secure user registration, role-based access control, and session management using JWT tokens and Redis for session storage.

## Authentication

### Registration
**Endpoint:** `POST /users/register`

Register a new user with the following fields:

```json
{
  "email": "user@example.com",
  "password": "secure_password",
  "name": "Full Name",
  "age": 30,
  "firstName": "First",
  "lastName": "Last",
  "phone": "1234567890",
  "role": "PATIENT"
}
```

Optional fields:
- `profilePicture`: string (URL)
- `gender`: "MALE" | "FEMALE" | "OTHER"
- `dateOfBirth`: Date
- `address`: string
- `city`: string
- `state`: string
- `country`: string
- `zipCode`: string

Response (201 Created):
```json
{
  "id": "user_id",
  "email": "user@example.com",
  "name": "Full Name",
  "role": "PATIENT",
  "isVerified": false,
  "createdAt": "2025-03-01T00:00:00Z"
}
```

### Login
**Endpoint:** `POST /users/login`

```json
{
  "email": "user@example.com",
  "password": "secure_password"
}
```

Response (200 OK):
```json
{
  "access_token": "jwt_token",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "role": "PATIENT"
  }
}
```

### Logout
**Endpoint:** `POST /users/logout`
- Requires Authentication: Yes
- Description: Invalidates the current session
- Response: 200 OK

## User Roles and Permissions

### Available Roles
1. **SUPER_ADMIN**
   - Full system access
   - Can manage all users and clinics
   - Access to system configuration

2. **CLINIC_ADMIN**
   - Manage clinic staff
   - View clinic statistics
   - Manage clinic settings

3. **DOCTOR**
   - Access patient records
   - Manage appointments
   - Create prescriptions
   - Update health records

4. **PATIENT**
   - View personal health records
   - Book appointments
   - View prescriptions
   - Update personal profile

5. **RECEPTIONIST**
   - Manage appointments
   - Basic patient registration
   - Queue management
   - Basic record access

## API Endpoints

### Public Endpoints
- `POST /users/register` - Register new user
- `POST /users/login` - User login

### Protected Endpoints

#### Profile Management
- `GET /users/profile` - Get current user profile
- `PATCH /users/profile` - Update current user profile

#### User Management (Admin Only)
- `GET /users` - List all users (SUPER_ADMIN, CLINIC_ADMIN)
- `GET /users/:id` - Get user details
- `PATCH /users/:id` - Update user
- `DELETE /users/:id` - Delete user (SUPER_ADMIN)

#### Role-Based Endpoints
- `GET /users/patients` - List all patients
- `GET /users/doctors` - List all doctors
- `GET /users/receptionists` - List all receptionists
- `GET /users/clinic-admins` - List all clinic admins

## Data Models

### User Model
```typescript
interface User {
  id: string;
  email: string;
  password: string; // Hashed
  name: string;
  age: number;
  firstName: string;
  lastName: string;
  phone: string;
  role: Role;
  profilePicture?: string;
  gender?: Gender;
  dateOfBirth?: Date;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  isVerified: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

## Error Handling

### Common Error Responses
- 400 Bad Request - Invalid input data
- 401 Unauthorized - Invalid credentials or missing token
- 403 Forbidden - Insufficient permissions
- 404 Not Found - Resource not found
- 409 Conflict - Email already exists
- 500 Internal Server Error - Server error

Example error response:
```json
{
  "statusCode": 400,
  "message": "Email already exists",
  "error": "Bad Request"
}
```

## Security

### Password Requirements
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

### JWT Token
- Expires in 24 hours
- Must be included in Authorization header
- Format: `Bearer <token>`

### Session Management
- Sessions stored in Redis
- Session TTL: 24 hours
- Invalidated on logout
- One active session per user

### Rate Limiting
- Login attempts: 5 per minute
- Registration: 3 per hour per IP
- API calls: 100 per minute per token

## Implementation Examples

### Register a Doctor
```json
{
  "email": "doctor@clinic.com",
  "password": "SecurePass123!",
  "name": "Dr. John Smith",
  "age": 35,
  "firstName": "John",
  "lastName": "Smith",
  "phone": "1234567890",
  "role": "DOCTOR",
  "specialization": "Cardiology",
  "experience": 10,
  "consultationFee": 100.00
}
```

### Register a Patient
```json
{
  "email": "patient@example.com",
  "password": "SecurePass123!",
  "name": "Jane Doe",
  "age": 28,
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "9876543210",
  "role": "PATIENT",
  "gender": "FEMALE",
  "dateOfBirth": "1995-05-15"
}
```

## Best Practices
1. Always validate input data
2. Use strong passwords
3. Implement proper error handling
4. Follow role-based access control
5. Keep sessions secure
6. Regular security audits
7. Monitor failed login attempts
8. Implement proper logging

## Testing
```bash
# Run user service tests
npm run test:users

# Test authentication
npm run test:auth

# Test role-based access
npm run test:roles
```

## Troubleshooting

### Common Issues
1. Token expired
   - Solution: Re-login to get a new token

2. Invalid credentials
   - Check email and password
   - Verify account is not locked

3. Permission denied
   - Verify user role
   - Check required permissions

4. Session expired
   - Re-login to create new session

## Support
For technical support or questions about the user service:
- Email: support@healthcare.com
- Documentation: /api (Swagger UI)
- Internal Wiki: [link to internal documentation]