# Healthcare Error System

A simple, robust error handling system for healthcare applications.

## Quick Start

### 1. Import the Errors Module

```typescript
// app.module.ts
import { ErrorsModule } from './libs/core/errors/errors.module';

@Module({
  imports: [
    ErrorsModule, // Add this to make errors available globally
    // ... other modules
  ],
})
export class AppModule {}
```

### 2. Use in Services

```typescript
// user.service.ts
import { Injectable } from '@nestjs/common';
import { HealthcareErrorsService } from '../libs/core/errors';

@Injectable()
export class UserService {
  constructor(private readonly errors: HealthcareErrorsService) {}

  async findUser(userId: string) {
    const user = await this.userRepository.findById(userId);
    
    if (!user) {
      throw this.errors.userNotFound(userId, 'UserService.findUser');
    }
    
    return user;
  }

  async createUser(userData: CreateUserDto) {
    // Check if email already exists
    const existingUser = await this.userRepository.findByEmail(userData.email);
    if (existingUser) {
      throw this.errors.emailAlreadyExists(userData.email, 'UserService.createUser');
    }
    
    // Validate email format
    if (!this.isValidEmail(userData.email)) {
      throw this.errors.invalidEmail(userData.email, 'UserService.createUser');
    }
    
    return await this.userRepository.create(userData);
  }
}
```

### 3. Use in Controllers

```typescript
// appointments.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { HealthcareErrorsService } from '../libs/core/errors';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly errors: HealthcareErrorsService) {}

  @Get(':id')
  async getAppointment(@Param('id') id: string) {
    // Validate UUID
    if (!this.isValidUuid(id)) {
      throw this.errors.invalidUuid(id, 'AppointmentsController.getAppointment');
    }
    
    const appointment = await this.appointmentService.findById(id);
    
    if (!appointment) {
      throw this.errors.appointmentNotFound(id, 'AppointmentsController.getAppointment');
    }
    
    return appointment;
  }
}
```

## Available Error Methods

### Authentication & Authorization
- `invalidCredentials(context?)` - Invalid login credentials
- `tokenExpired(context?)` - JWT token expired
- `insufficientPermissions(context?)` - User lacks required permissions
- `accountLocked(context?)` - Account temporarily locked
- `otpInvalid(context?)` - Invalid OTP code

### User Management
- `userNotFound(userId?, context?)` - User not found
- `userAlreadyExists(email?, context?)` - User already exists
- `emailAlreadyExists(email, context?)` - Email already in use

### Clinic Management
- `clinicNotFound(clinicId?, context?)` - Clinic not found
- `clinicAccessDenied(clinicId?, context?)` - No access to clinic
- `clinicQuotaExceeded(clinicId?, context?)` - Clinic quota exceeded

### Appointments
- `appointmentNotFound(appointmentId?, context?)` - Appointment not found
- `appointmentConflict(appointmentId?, context?)` - Appointment conflict
- `appointmentSlotUnavailable(slot?, context?)` - Time slot unavailable
- `appointmentPastDate(context?)` - Cannot schedule in past

### Doctors & Staff
- `doctorNotFound(doctorId?, context?)` - Doctor not found
- `doctorUnavailable(doctorId?, context?)` - Doctor unavailable
- `staffNotFound(staffId?, context?)` - Staff member not found

### Patients
- `patientNotFound(patientId?, context?)` - Patient not found
- `patientConsentRequired(patientId?, context?)` - Patient consent required

### Validation
- `validationError(field, message?, context?)` - General validation error
- `invalidEmail(email?, context?)` - Invalid email format
- `invalidPhone(phone?, context?)` - Invalid phone format
- `invalidDate(date?, context?)` - Invalid date format
- `invalidUuid(id?, context?)` - Invalid UUID format

### Database
- `databaseError(operation?, context?)` - Database operation failed
- `recordNotFound(table?, context?)` - Database record not found
- `duplicateEntry(field?, context?)` - Duplicate database entry

### Communication Services
- `emailServiceError(context?)` - Email service failed
- `smsServiceError(context?)` - SMS service failed
- `whatsappServiceError(context?)` - WhatsApp service failed

### Files & Media
- `fileNotFound(filename?, context?)` - File not found
- `fileTooLarge(maxSize?, context?)` - File too large
- `invalidFileFormat(format?, context?)` - Invalid file format

### Security & Rate Limiting
- `rateLimitExceeded(limit?, context?)` - Rate limit exceeded
- `securityViolation(violation?, context?)` - Security violation
- `suspiciousActivity(activity?, context?)` - Suspicious activity detected

### Business Logic
- `businessRuleViolation(rule?, context?)` - Business rule violation
- `operationNotAllowed(operation?, context?)` - Operation not allowed
- `resourceLocked(resource?, context?)` - Resource locked

### System
- `internalServerError(context?)` - Internal server error
- `serviceUnavailable(service?, context?)` - Service unavailable
- `featureNotImplemented(feature?, context?)` - Feature not implemented

### HIPAA & Compliance
- `hipaaViolation(violation?, context?)` - HIPAA violation
- `phiAccessUnauthorized(patientId?, context?)` - Unauthorized PHI access
- `consentExpired(patientId?, context?)` - Patient consent expired

## Error Handling

The service automatically handles error logging based on severity:

- **Critical Errors** (500+): Logged as ERROR
- **Warning Errors** (400-499): Logged as WARN  
- **Info Errors** (200-399): Logged as LOG

## Best Practices

1. **Always provide context** - Include the method/class name where the error occurs
2. **Use specific error methods** - Choose the most specific error method available
3. **Include relevant metadata** - Pass IDs, emails, etc. for better debugging
4. **Handle errors at the right level** - Let the global error filter handle HTTP responses

## Example Error Response

```json
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "User not found. Please check the user ID and try again.",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```
