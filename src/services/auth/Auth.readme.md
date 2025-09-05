# Authentication System Documentation

## Overview

The authentication system is built on a **plugin-based architecture** that supports multiple domains (Healthcare/Clinic and Fashion) with shared authentication capabilities. This system is designed to handle **10 lakhs (1 million) users** with high scalability, security, and domain-specific features.

## Architecture

### Plugin-Based Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Auth Module                              │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │  Plugin Manager │  │  Base Auth      │  │  Session     │ │
│  │     Service     │  │   Service       │  │  Service     │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    Domain Plugins                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │  Clinic Auth    │  │  Fashion Auth   │  │  Shared Auth │ │
│  │    Plugin       │  │    Plugin       │  │   Plugin     │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

1. **PluginManagerService**: Orchestrates all authentication plugins
2. **BaseAuthService**: Provides common authentication utilities
3. **Domain Plugins**: Handle domain-specific authentication logic
4. **SessionService**: Manages user sessions and device tracking

## Domain-Specific Features

### Healthcare/Clinic Domain
- **HIPAA Compliance**: Audit logging, data encryption
- **Role-Based Access**: Comprehensive medical roles
  - **Administrative**: SUPER_ADMIN, SYSTEM_ADMIN, CLINIC_ADMIN, SUPPORT
  - **Medical Staff**: DOCTOR, NURSE, PHARMACIST, LAB_TECHNICIAN, RADIOLOGIST, PHYSIOTHERAPIST, NUTRITIONIST, PSYCHOLOGIST
  - **Support Staff**: RECEPTIONIST, MEDICAL_ASSISTANT, BILLING_SPECIALIST, INSURANCE_COORDINATOR
  - **Compliance**: AUDITOR, COMPLIANCE_OFFICER, DATA_ANALYST
  - **Patients**: PATIENT
- **Multi-Tenant**: Clinic-based user isolation
- **Security**: Strict password policies, session management
- **OTP Authentication**: Medical staff verification

### Fashion Domain
- **Social Authentication**: Google, Facebook, Apple integration
- **Loyalty System**: Points-based rewards
- **Role-Based Access**: Fashion industry specific roles
  - **Studio Management**: STUDIO_ADMIN, STUDIO_MANAGER, STUDIO_RECEPTIONIST
  - **Design & Production**: DESIGNER, TAILOR, CUTTER, CHECKER, PATTERN_MAKER, EMBROIDERER, FINISHER
  - **Consultation**: FASHION_CONSULTANT
  - **Operations**: FABRIC_MANAGER, QUALITY_CONTROLLER
  - **Customers**: CUSTOMER, GUEST
- **Style Preferences**: User fashion preferences
- **Studio Management**: Multi-studio support
- **Mobile-First**: OTP and biometric authentication

## Role-Based Access Control (RBAC)

### Healthcare/Clinic Roles

#### Administrative Roles

##### SUPER_ADMIN
- **Description**: Full system access across all clinics
- **Permissions**: 
  - `manage_system`: Complete system administration
  - `manage_clinics`: Create, update, delete clinics
  - `manage_users`: Manage all users across domains
  - `view_analytics`: Access to all analytics
  - `audit_logs`: View all audit logs
- **Use Cases**: System administrators, platform owners
- **Security Level**: Highest

##### SYSTEM_ADMIN
- **Description**: System-level administration
- **Permissions**:
  - `manage_system_config`: System configuration
  - `manage_infrastructure`: Database and infrastructure
  - `view_system_analytics`: System-wide analytics
- **Use Cases**: IT administrators, DevOps teams
- **Security Level**: Very High

##### CLINIC_ADMIN
- **Description**: Individual clinic management
- **Permissions**:
  - `manage_clinic_staff`: Hire, fire, manage clinic staff
  - `manage_clinic_settings`: Clinic configuration
  - `view_clinic_analytics`: Clinic-specific analytics
  - `manage_appointments`: Oversee appointment system
  - `manage_inventory`: Medical inventory management
- **Use Cases**: Clinic owners, practice managers
- **Security Level**: High

##### SUPPORT
- **Description**: Technical support and troubleshooting
- **Permissions**:
  - `view_user_issues`: Access to user support tickets
  - `basic_troubleshooting`: System troubleshooting
  - `escalate_issues`: Escalate to higher authorities
- **Use Cases**: Customer support, technical support
- **Security Level**: Medium

#### Medical Staff Roles

##### DOCTOR
- **Description**: Medical consultations and treatments
- **Permissions**:
  - `manage_patients`: Patient record management
  - `create_prescriptions`: Prescription creation
  - `view_medical_records`: Access to medical records
  - `manage_appointments`: Schedule and manage appointments
  - `view_lab_results`: Laboratory results access
- **Use Cases**: Physicians, specialists, consultants
- **Security Level**: High

##### NURSE
- **Description**: Patient care and support
- **Permissions**:
  - `view_patients`: Patient information access
  - `update_patient_status`: Update patient conditions
  - `view_appointments`: Appointment information
  - `basic_medical_records`: Basic medical record access
- **Use Cases**: Registered nurses, nurse practitioners
- **Security Level**: Medium-High

##### PHARMACIST
- **Description**: Medication management
- **Permissions**:
  - `manage_medications`: Medication inventory
  - `view_prescriptions`: Prescription access
  - `dispense_medications`: Medication dispensing
  - `drug_interactions`: Drug interaction checking
- **Use Cases**: Pharmacists, pharmacy technicians
- **Security Level**: Medium-High

##### LAB_TECHNICIAN
- **Description**: Laboratory services
- **Permissions**:
  - `manage_lab_tests`: Laboratory test management
  - `update_lab_results`: Update test results
  - `view_patient_samples`: Sample tracking
- **Use Cases**: Medical laboratory technicians
- **Security Level**: Medium

##### RADIOLOGIST
- **Description**: Imaging and diagnostics
- **Permissions**:
  - `view_imaging`: Access to imaging studies
  - `create_reports`: Radiology reports
  - `manage_imaging_queue`: Imaging workflow
- **Use Cases**: Radiologists, imaging specialists
- **Security Level**: High

##### PHYSIOTHERAPIST
- **Description**: Physical therapy
- **Permissions**:
  - `manage_therapy_sessions`: Therapy session management
  - `view_patient_progress`: Patient progress tracking
  - `create_exercise_plans`: Exercise plan creation
- **Use Cases**: Physical therapists, rehabilitation specialists
- **Security Level**: Medium

##### NUTRITIONIST
- **Description**: Dietary consultation
- **Permissions**:
  - `create_diet_plans`: Diet plan creation
  - `view_nutrition_history`: Nutrition history access
  - `manage_supplements`: Supplement recommendations
- **Use Cases**: Nutritionists, dietitians
- **Security Level**: Medium

##### PSYCHOLOGIST
- **Description**: Mental health services
- **Permissions**:
  - `manage_psychology_sessions`: Psychology session management
  - `view_mental_health_records`: Mental health records
  - `create_treatment_plans`: Treatment plan creation
- **Use Cases**: Psychologists, psychiatrists
- **Security Level**: High

#### Support Staff Roles

##### RECEPTIONIST
- **Description**: Front desk and scheduling
- **Permissions**:
  - `manage_appointments`: Appointment scheduling
  - `register_patients`: Patient registration
  - `manage_queue`: Patient queue management
  - `basic_patient_info`: Basic patient information
- **Use Cases**: Front desk staff, receptionists
- **Security Level**: Low-Medium

##### MEDICAL_ASSISTANT
- **Description**: Clinical support
- **Permissions**:
  - `assist_medical_procedures`: Medical procedure assistance
  - `update_patient_vitals`: Vital signs recording
  - `prepare_patients`: Patient preparation
- **Use Cases**: Medical assistants, clinical support staff
- **Security Level**: Medium

##### BILLING_SPECIALIST
- **Description**: Financial management
- **Permissions**:
  - `manage_billing`: Billing and invoicing
  - `view_payment_history`: Payment history access
  - `process_insurance`: Insurance processing
- **Use Cases**: Billing specialists, financial staff
- **Security Level**: Medium

##### INSURANCE_COORDINATOR
- **Description**: Insurance processing
- **Permissions**:
  - `manage_insurance_claims`: Insurance claim processing
  - `verify_coverage`: Insurance coverage verification
  - `coordinate_benefits`: Benefit coordination
- **Use Cases**: Insurance coordinators, claims processors
- **Security Level**: Medium

#### Compliance Roles

##### AUDITOR
- **Description**: Compliance and audit functions
- **Permissions**:
  - `view_audit_logs`: Audit log access
  - `generate_compliance_reports`: Compliance reporting
  - `review_policies`: Policy review access
- **Use Cases**: Internal auditors, compliance officers
- **Security Level**: High

##### COMPLIANCE_OFFICER
- **Description**: Regulatory compliance
- **Permissions**:
  - `manage_compliance_policies`: Compliance policy management
  - `monitor_regulations`: Regulatory monitoring
  - `conduct_training`: Compliance training
- **Use Cases**: Compliance officers, regulatory specialists
- **Security Level**: High

##### DATA_ANALYST
- **Description**: Analytics and reporting
- **Permissions**:
  - `view_analytics`: Analytics access
  - `generate_reports`: Report generation
  - `export_data`: Data export capabilities
- **Use Cases**: Data analysts, business intelligence
- **Security Level**: Medium-High

#### Patient Role

##### PATIENT
- **Description**: Personal health data and appointments
- **Permissions**:
  - `view_own_profile`: Personal profile access
  - `view_own_appointments`: Personal appointments
  - `view_own_medical_records`: Personal medical records
  - `book_appointments`: Appointment booking
  - `view_prescriptions`: Personal prescriptions
- **Use Cases**: Patients, family members
- **Security Level**: Low

### Fashion/Studio Roles

#### Studio Management Roles

##### STUDIO_ADMIN
- **Description**: Full studio management
- **Permissions**:
  - `manage_studio`: Complete studio administration
  - `manage_studio_staff`: Staff management
  - `view_studio_analytics`: Studio analytics
  - `manage_finances`: Financial management
  - `manage_inventory`: Inventory management
- **Use Cases**: Studio owners, business managers
- **Security Level**: High

##### STUDIO_MANAGER
- **Description**: Operational management
- **Permissions**:
  - `manage_operations`: Day-to-day operations
  - `manage_schedule`: Schedule management
  - `view_studio_stats`: Studio statistics
  - `manage_customer_relations`: Customer relationship management
- **Use Cases**: Studio managers, operations managers
- **Security Level**: Medium-High

##### STUDIO_RECEPTIONIST
- **Description**: Customer service and scheduling
- **Permissions**:
  - `manage_bookings`: Booking management
  - `customer_service`: Customer service functions
  - `basic_studio_info`: Basic studio information
- **Use Cases**: Receptionists, customer service representatives
- **Security Level**: Low-Medium

#### Design & Production Roles

##### DESIGNER
- **Description**: Fashion design and consultation
- **Permissions**:
  - `create_designs`: Design creation
  - `manage_portfolio`: Portfolio management
  - `consult_customers`: Customer consultation
  - `view_trends`: Fashion trend access
- **Use Cases**: Fashion designers, creative directors
- **Security Level**: Medium-High

##### TAILOR
- **Description**: Garment construction
- **Permissions**:
  - `manage_garments`: Garment management
  - `update_production_status`: Production status updates
  - `view_patterns`: Pattern access
- **Use Cases**: Tailors, seamstresses
- **Security Level**: Medium

##### CUTTER
- **Description**: Fabric cutting and preparation
- **Permissions**:
  - `manage_fabric_cutting`: Fabric cutting operations
  - `update_inventory`: Inventory updates
  - `view_cutting_orders`: Cutting order access
- **Use Cases**: Cutters, fabric specialists
- **Security Level**: Medium

##### CHECKER
- **Description**: Quality control
- **Permissions**:
  - `quality_control`: Quality control functions
  - `update_quality_status`: Quality status updates
  - `view_quality_reports`: Quality report access
- **Use Cases**: Quality controllers, inspectors
- **Security Level**: Medium

##### PATTERN_MAKER
- **Description**: Pattern creation
- **Permissions**:
  - `create_patterns`: Pattern creation
  - `manage_pattern_library`: Pattern library management
  - `view_design_specs`: Design specification access
- **Use Cases**: Pattern makers, technical designers
- **Security Level**: Medium

##### EMBROIDERER
- **Description**: Embroidery work
- **Permissions**:
  - `manage_embroidery`: Embroidery operations
  - `update_embroidery_status`: Embroidery status updates
  - `view_embroidery_designs`: Embroidery design access
- **Use Cases**: Embroiderers, embellishment specialists
- **Security Level**: Medium

##### FINISHER
- **Description**: Final garment finishing
- **Permissions**:
  - `manage_finishing`: Finishing operations
  - `update_finishing_status`: Finishing status updates
  - `quality_final_check`: Final quality checks
- **Use Cases**: Finishers, quality assurance specialists
- **Security Level**: Medium

#### Consultation & Operations Roles

##### FASHION_CONSULTANT
- **Description**: Style consultation
- **Permissions**:
  - `provide_consultation`: Style consultation services
  - `manage_client_profiles`: Client profile management
  - `view_fashion_trends`: Fashion trend access
  - `create_style_recommendations`: Style recommendations
- **Use Cases**: Fashion consultants, stylists
- **Security Level**: Medium

##### FABRIC_MANAGER
- **Description**: Inventory management
- **Permissions**:
  - `manage_fabric_inventory`: Fabric inventory management
  - `track_fabric_usage`: Fabric usage tracking
  - `manage_suppliers`: Supplier management
- **Use Cases**: Fabric managers, inventory specialists
- **Security Level**: Medium

##### QUALITY_CONTROLLER
- **Description**: Quality assurance
- **Permissions**:
  - `quality_assurance`: Quality assurance functions
  - `manage_quality_standards`: Quality standard management
  - `generate_quality_reports`: Quality report generation
- **Use Cases**: Quality controllers, QA specialists
- **Security Level**: Medium

#### Customer Roles

##### CUSTOMER
- **Description**: Shopping and order management
- **Permissions**:
  - `view_own_profile`: Personal profile access
  - `manage_orders`: Order management
  - `view_catalog`: Product catalog access
  - `book_appointments`: Appointment booking
  - `manage_preferences`: Preference management
- **Use Cases**: Regular customers, clients
- **Security Level**: Low

##### GUEST
- **Description**: Limited access for browsing
- **Permissions**:
  - `view_public_catalog`: Public catalog access
  - `basic_browsing`: Basic browsing functions
  - `contact_studio`: Studio contact information
- **Use Cases**: Prospective customers, visitors
- **Security Level**: Very Low

## Role Validation Integration

### Role Constants Integration

The authentication system uses centralized role constants from `@infrastructure/database/prisma/constants` to ensure type safety and consistency across all modules.

#### Role Validation Pipe

The system includes a comprehensive `RoleValidationPipe` that integrates with the existing validation infrastructure:

```typescript
// libs/validations/pipes/role-validation.pipe.ts
import { Roles } from '@infrastructure/database/prisma/constants';

export class RoleValidationPipe implements PipeTransform<any> {
  // Domain-specific role validation
  // Role hierarchy enforcement
  // Type safety with constants
}
```

#### Usage Examples

```typescript
// Basic role validation
@UsePipes(createRoleValidationPipe({ domain: 'healthcare' }))

// Role validation with hierarchy
@UsePipes(createRoleValidationPipe({
  domain: 'healthcare',
  requireHierarchy: true,
  creatorRole: 'CLINIC_ADMIN'
}))

// Multiple roles validation
@UsePipes(createRoleValidationPipe({
  domain: 'fashion',
  allowMultiple: true
}))
```

### Auth Plugin Updates

All auth plugins now use `Roles` constants instead of hardcoded strings:

```typescript
// libs/services/auth/plugins/clinic-auth.plugin.ts
import { Roles } from '@infrastructure/database/prisma/constants';

const accessRules = {
  'patient_records': {
    'read': [Roles.DOCTOR, Roles.NURSE, Roles.CLINIC_ADMIN],
    'write': [Roles.DOCTOR, Roles.CLINIC_ADMIN],
    'delete': [Roles.CLINIC_ADMIN],
  },
  'appointment': {
    'create': [Roles.PATIENT, Roles.DOCTOR, Roles.NURSE, Roles.CLINIC_ADMIN],
    'read': [Roles.PATIENT, Roles.DOCTOR, Roles.NURSE, Roles.CLINIC_ADMIN],
    'update': [Roles.DOCTOR, Roles.NURSE, Roles.CLINIC_ADMIN],
    'cancel': [Roles.PATIENT, Roles.DOCTOR, Roles.CLINIC_ADMIN],
  },
};
```

### Controller Integration

```typescript
// apps/clinic/src/clinic.controller.ts
import { RoleValidationPipe, createRoleValidationPipe } from '@validations';

@Controller('clinic/auth')
export class ClinicAuthController {
  
  @Post('register')
  @UsePipes(
    createRoleValidationPipe({
      domain: 'healthcare',
      requireHierarchy: true,
      creatorRole: 'CLINIC_ADMIN'
    })
  )
  async register(@Body() registerDto: RegisterUserDto) {
    return this.authService.register(registerDto);
  }
}
```

### Global Validation Setup

```typescript
// apps/clinic/src/main.ts
import { RoleValidationPipe, createRoleValidationPipe } from '@validations';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Global role validation pipe for healthcare domain
  app.useGlobalPipes(
    createRoleValidationPipe({
      domain: 'healthcare',
      requireHierarchy: true
    })
  );
  
  await app.listen(3000);
}
```

### Role Hierarchy & Security

#### Role Assignment Rules

```typescript
const roleHierarchy = {
  [Roles.SUPER_ADMIN]: Object.values(Roles),
  [Roles.SYSTEM_ADMIN]: [Roles.CLINIC_ADMIN, Roles.STUDIO_ADMIN, Roles.SUPPORT],
  [Roles.CLINIC_ADMIN]: [Roles.DOCTOR, Roles.NURSE, Roles.RECEPTIONIST, Roles.PATIENT],
  [Roles.STUDIO_ADMIN]: [Roles.DESIGNER, Roles.TAILOR, Roles.CUSTOMER],
};
```

#### Security Features

1. **Role Escalation Prevention**: Users can't assign higher roles than their own
2. **Domain Isolation**: Prevents cross-domain role usage
3. **Audit Logging**: Logs all role changes and validations
4. **Input Validation**: Validates role strings against constants
5. **Rate Limiting**: Prevents role enumeration attacks

## Permissions Integration

### Centralized Permission Management

The auth system integrates with the centralized `@permissions/` service for comprehensive access control:

#### Permission Service Integration

```typescript
// Auth plugins use PermissionService for access validation
async validateAccess(userId: string, resource: string, action: string, context: AuthPluginContext): Promise<boolean> {
  return await this.permissionService.hasPermission({
    userId,
    action: action as any,
    resourceType: resource as any,
    resourceId: context.clinicId || context.studioId || '',
  });
}
```

#### Permission Decorators in Controllers

```typescript
// Use permission decorators for route-level access control
@Get('profile')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission('view_users')
async getProfile(@Request() req): Promise<any> {
  // Only users with 'view_users' permission can access
}
```

#### Permission-Based User Management

```typescript
// Get user permissions from centralized service
async getUserRolesAndPermissions(userId: string, context: AuthPluginContext): Promise<{ roles: string[]; permissions: string[] }> {
  const permissions = await this.permissionService.getUserPermissions(userId);
  // ... get roles from user data
  return { roles, permissions };
}
```

### Benefits of Permissions Integration

1. **Centralized Control**: All permission logic in one place
2. **Consistent Validation**: Same permission checks across all modules
3. **Type Safety**: Strongly typed permission definitions
4. **Audit Trail**: Centralized logging of permission checks
5. **Scalability**: Efficient permission caching and validation
6. **Domain Separation**: Healthcare and fashion permissions isolated

## Integration Guide

### 1. Module Registration

#### For Healthcare/Clinic App
```typescript
// apps/clinic/src/app.module.ts
import { ClinicAuthModule } from '@libs/services/auth';

@Module({
  imports: [
    ClinicAuthModule,
    // ... other modules
  ],
})
export class AppModule {}
```

#### For Fashion App
```typescript
// apps/fashion/src/app.module.ts
import { FashionAuthModule } from '@libs/services/auth';

@Module({
  imports: [
    FashionAuthModule,
    // ... other modules
  ],
})
export class AppModule {}
```

### 2. Environment Configuration

```env
# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# OTP Configuration
OTP_LENGTH=6
OTP_EXPIRES_IN_MINUTES=5
OTP_MAX_ATTEMPTS=3

# Session Configuration
SESSION_EXPIRES_IN_HOURS=24
MAX_CONCURRENT_SESSIONS=5

# Security Configuration
BCRYPT_SALT_ROUNDS=12
TOKEN_BLACKLIST_TTL=86400
PASSWORD_RESET_TTL=3600
MAGIC_LINK_TTL=600

# Domain-Specific Configuration
CLINIC_AUTH_CACHING=true
CLINIC_AUTH_RATE_LIMITING=true
CLINIC_AUTH_CIRCUIT_BREAKER=true

FASHION_AUTH_CACHING=true
FASHION_SOCIAL_AUTH=true
FASHION_LOYALTY_REWARDS=true
```

### 3. Service Injection

#### Healthcare/Clinic Service
```typescript
// apps/clinic/src/services/auth.service.ts
import { Injectable } from '@nestjs/common';
import { ClinicAuthService } from '@libs/services/auth';

@Injectable()
export class AuthService {
  constructor(
    private readonly clinicAuthService: ClinicAuthService,
  ) {}

  async login(email: string, password: string, clinicId: string) {
    return this.clinicAuthService.login({
      email,
      password,
      clinicId,
      userAgent: 'clinic-app',
      ipAddress: '192.168.1.1',
    });
  }

  async register(userData: any, clinicId: string) {
    return this.clinicAuthService.register({
      ...userData,
      clinicId,
      userAgent: 'clinic-app',
      ipAddress: '192.168.1.1',
    });
  }
}
```

#### Fashion Service
```typescript
// apps/fashion/src/services/auth.service.ts
import { Injectable } from '@nestjs/common';
import { FashionAuthService } from '@libs/services/auth';

@Injectable()
export class AuthService {
  constructor(
    private readonly fashionAuthService: FashionAuthService,
  ) {}

  async login(email: string, password: string, studioId: string) {
    return this.fashionAuthService.login({
      email,
      password,
      studioId,
      userAgent: 'fashion-app',
      ipAddress: '192.168.1.1',
    });
  }

  async socialLogin(provider: string, token: string, studioId: string) {
    switch (provider) {
      case 'google':
        return this.fashionAuthService.authenticateWithGoogle({
          token,
          studioId,
          userAgent: 'fashion-app',
          ipAddress: '192.168.1.1',
        });
      // ... other providers
    }
  }
}
```

## API Endpoints

### Healthcare/Clinic Endpoints

```typescript
// Base URL: /clinic/auth

POST /register          // Register new clinic user
POST /login             // Login with email/password
POST /google            // Google OAuth authentication
POST /login/otp         // Login with OTP
POST /verify-otp        // Verify OTP
POST /logout            // Logout user
POST /forgot-password   // Request password reset
POST /reset-password    // Reset password
GET  /profile           // Get user profile
POST /refresh-token     // Refresh JWT token
POST /change-password   // Change password
POST /request-otp       // Request OTP
GET  /sessions          // Get user sessions
DELETE /sessions/:id    // Revoke specific session
```

### Fashion Endpoints

```typescript
// Base URL: /fashion/auth

POST /register          // Register new fashion user
POST /login             // Login with email/password
POST /google            // Google OAuth authentication
POST /login/otp         // Login with OTP
POST /verify-otp        // Verify OTP
POST /logout            // Logout user
POST /forgot-password   // Request password reset
POST /reset-password    // Reset password
GET  /profile           // Get user profile
POST /refresh-token     // Refresh JWT token
POST /change-password   // Change password
POST /facebook-auth     // Facebook authentication
POST /apple-auth        // Apple authentication
GET  /loyalty-points    // Get loyalty points
POST /update-preferences // Update style preferences
```

## Usage Examples

### 1. User Registration

#### Healthcare User Registration
```typescript
// Doctor Registration
const doctorRegistration = {
  email: 'doctor@clinic.com',
  password: 'SecurePass123!',
  name: 'Dr. John Smith',
  phone: '+1234567890',
  role: 'DOCTOR',
  clinicId: 'clinic_123',
  metadata: {
    specialization: 'Cardiology',
    licenseNumber: 'MD123456',
    experience: 10,
    department: 'Cardiology',
  },
};

// Nurse Registration
const nurseRegistration = {
  email: 'nurse@clinic.com',
  password: 'SecurePass123!',
  name: 'Sarah Johnson',
  phone: '+1234567890',
  role: 'NURSE',
  clinicId: 'clinic_123',
  metadata: {
    department: 'Emergency',
    shift: 'Day',
  },
};

// Patient Registration
const patientRegistration = {
  email: 'patient@clinic.com',
  password: 'SecurePass123!',
  name: 'Mike Wilson',
  phone: '+1234567890',
  role: 'PATIENT',
  clinicId: 'clinic_123',
  metadata: {
    dateOfBirth: '1990-01-01',
    gender: 'Male',
    emergencyContact: '+1234567890',
  },
};

const result = await clinicAuthService.register(doctorRegistration);
```

#### Fashion User Registration
```typescript
// Designer Registration
const designerRegistration = {
  email: 'designer@fashion.com',
  password: 'FashionPass123!',
  name: 'Emma Designer',
  phone: '+1234567890',
  role: 'DESIGNER',
  studioId: 'studio_456',
  metadata: {
    specialization: 'Evening Wear',
    experience: 5,
    portfolio: 'https://portfolio.com/emma',
  },
};

// Customer Registration
const customerRegistration = {
  email: 'customer@fashion.com',
  password: 'FashionPass123!',
  name: 'Jane Customer',
  phone: '+1234567890',
  role: 'CUSTOMER',
  studioId: 'studio_456',
  metadata: {
    stylePreferences: ['casual', 'business'],
    size: 'M',
    budget: 'medium',
    occasionTypes: ['work', 'party'],
  },
};

// Studio Admin Registration
const adminRegistration = {
  email: 'admin@fashion.com',
  password: 'FashionPass123!',
  name: 'Admin User',
  phone: '+1234567890',
  role: 'STUDIO_ADMIN',
  studioId: 'studio_456',
  metadata: {
    permissions: ['manage_studio', 'manage_staff'],
  },
};

const result = await fashionAuthService.register(designerRegistration);
```

### 2. Authentication

#### Password Authentication
```typescript
const loginResult = await authService.login({
  email: 'user@example.com',
  password: 'password123',
  clinicId: 'clinic_123', // or studioId for fashion
});
```

#### OTP Authentication
```typescript
// Request OTP
await authService.requestOTP({
  identifier: 'user@example.com',
  purpose: 'login',
  clinicId: 'clinic_123',
});

// Verify OTP
const result = await authService.verifyOTP({
  identifier: 'user@example.com',
  otp: '123456',
  clinicId: 'clinic_123',
});
```

#### Social Authentication (Fashion)
```typescript
const googleResult = await fashionAuthService.authenticateWithGoogle({
  token: 'google_oauth_token',
  studioId: 'studio_456',
  deviceId: 'device_123',
});
```

#### Social Authentication (Clinic)
```typescript
const googleResult = await clinicAuthService.authenticateWithGoogle({
  token: 'google_oauth_token',
  clinicId: 'clinic_123',
  deviceId: 'device_123',
});
```

### 3. Session Management

```typescript
// Get user sessions
const sessions = await sessionService.getUserSessions(userId);

// Revoke specific session
await sessionService.revokeSession(sessionId, userId);

// Revoke all sessions except current
await sessionService.revokeAllSessions(userId, currentSessionId);
```

### 4. Token Management

```typescript
// Refresh tokens
const newTokens = await authService.refreshTokens({
  refreshToken: 'refresh_token_here',
  clinicId: 'clinic_123',
});

// Verify token
const payload = await authService.verifyToken(token, clinicId);
```

## Role-Based Access Control

### Healthcare/Clinic Roles

#### Administrative Roles
- **SUPER_ADMIN**: Full system access across all clinics
- **SYSTEM_ADMIN**: System-level administration
- **SUPPORT**: Technical support and troubleshooting
- **CLINIC_ADMIN**: Individual clinic management
- **AUDITOR**: Compliance and audit functions
- **COMPLIANCE_OFFICER**: Regulatory compliance
- **DATA_ANALYST**: Analytics and reporting

#### Medical Staff Roles
- **DOCTOR**: Medical consultations and treatments
- **NURSE**: Patient care and support
- **PHARMACIST**: Medication management
- **LAB_TECHNICIAN**: Laboratory services
- **RADIOLOGIST**: Imaging and diagnostics
- **PHYSIOTHERAPIST**: Physical therapy
- **NUTRITIONIST**: Dietary consultation
- **PSYCHOLOGIST**: Mental health services

#### Support Staff Roles
- **RECEPTIONIST**: Front desk and scheduling
- **MEDICAL_ASSISTANT**: Clinical support
- **BILLING_SPECIALIST**: Financial management
- **INSURANCE_COORDINATOR**: Insurance processing

#### Patient Role
- **PATIENT**: Personal health data and appointments

### Fashion/Studio Roles

#### Studio Management Roles
- **STUDIO_ADMIN**: Full studio management
- **STUDIO_MANAGER**: Operational management
- **STUDIO_RECEPTIONIST**: Customer service and scheduling

#### Design & Production Roles
- **DESIGNER**: Fashion design and consultation
- **TAILOR**: Garment construction
- **CUTTER**: Fabric cutting and preparation
- **CHECKER**: Quality control
- **PATTERN_MAKER**: Pattern creation
- **EMBROIDERER**: Embroidery work
- **FINISHER**: Final garment finishing

#### Consultation & Operations Roles
- **FASHION_CONSULTANT**: Style consultation
- **FABRIC_MANAGER**: Inventory management
- **QUALITY_CONTROLLER**: Quality assurance

#### Customer Roles
- **CUSTOMER**: Shopping and order management
- **GUEST**: Limited access for browsing

## Security Features

### 1. Rate Limiting
- **Healthcare**: Strict rate limiting for security
- **Fashion**: More lenient for better UX
- **Configurable**: Per operation and per user

### 2. Circuit Breaker
- **Automatic**: Prevents cascade failures
- **Configurable**: Threshold and timeout settings
- **Monitoring**: Real-time health checks

### 3. Audit Logging
- **Healthcare**: HIPAA-compliant audit trails with role-specific tracking
- **Fashion**: User activity tracking with loyalty and preference monitoring
- **Security Events**: Login attempts, failures, role changes, permission updates
- **Domain-Specific**: Medical procedures vs. fashion consultations

### 4. Session Management
- **Multi-Device**: Support for multiple devices per role
- **Device Tracking**: User agent and IP tracking with role context
- **Automatic Cleanup**: Inactive session removal
- **Role-Based Sessions**: Different session policies for different roles
  - **Healthcare**: Stricter session management for medical staff
  - **Fashion**: More flexible sessions for customers

## Monitoring and Metrics

### 1. Health Checks
```typescript
// Get service health
const health = await authService.getHealthStatus();

// Get plugin health
const pluginHealth = await pluginManager.getPluginHealth();
```

### 2. Metrics
```typescript
// Get authentication metrics
const metrics = await authService.getMetrics();

// Get performance metrics
const performance = await authService.getPerformanceMetrics();
```

### 3. Circuit Breaker Status
```typescript
// Get circuit breaker state
const cbState = await circuitBreakerService.getState('auth.plugin.clinic.login');
```

## Error Handling

### Common Error Types
```typescript
// Authentication errors
class ClinicAuthValidationError extends BadRequestException
class ClinicAuthRateLimitError extends BadRequestException
class PluginExecutionError extends Error
class PluginNotFoundError extends Error
class RateLimitExceededError extends Error
```

### Error Response Format
```typescript
{
  success: false,
  message: 'Authentication failed',
  error: {
    code: 'INVALID_CREDENTIALS',
    message: 'Email or password is incorrect',
    details: {
      field: 'email',
      reason: 'user_not_found'
    }
  }
}
```

## Database Integration

### Healthcare Database Schema
```sql
-- Users table with comprehensive role support
CREATE TABLE healthcare_users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  hashed_password VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  role_type VARCHAR(50) NOT NULL CHECK (
    role_type IN (
      'SUPER_ADMIN', 'SYSTEM_ADMIN', 'SUPPORT', 'CLINIC_ADMIN',
      'DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECHNICIAN', 'RADIOLOGIST',
      'PHYSIOTHERAPIST', 'NUTRITIONIST', 'PSYCHOLOGIST', 'PATIENT',
      'RECEPTIONIST', 'MEDICAL_ASSISTANT', 'BILLING_SPECIALIST',
      'INSURANCE_COORDINATOR', 'AUDITOR', 'COMPLIANCE_OFFICER', 'DATA_ANALYST'
    )
  ),
  clinic_id UUID NOT NULL,
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Role-specific tables
CREATE TABLE clinic_doctors (
  user_id UUID REFERENCES healthcare_users(id),
  clinic_id UUID NOT NULL,
  specialization VARCHAR(100),
  license_number VARCHAR(50),
  experience_years INTEGER,
  consultation_fee DECIMAL(10,2),
  is_active BOOLEAN DEFAULT true,
  PRIMARY KEY (user_id, clinic_id)
);

CREATE TABLE clinic_nurses (
  user_id UUID REFERENCES healthcare_users(id),
  clinic_id UUID NOT NULL,
  department VARCHAR(100),
  shift VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  PRIMARY KEY (user_id, clinic_id)
);

CREATE TABLE clinic_patients (
  user_id UUID REFERENCES healthcare_users(id),
  clinic_id UUID,
  patient_number VARCHAR(50) UNIQUE,
  date_of_birth DATE,
  gender VARCHAR(20),
  blood_group VARCHAR(10),
  emergency_contact VARCHAR(20),
  medical_history JSONB,
  is_active BOOLEAN DEFAULT true,
  PRIMARY KEY (user_id)
);
```

### Fashion Database Schema
```sql
-- Users table with fashion industry roles
CREATE TABLE fashion_users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  hashed_password VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  role_type VARCHAR(50) NOT NULL CHECK (
    role_type IN (
      'STUDIO_ADMIN', 'STUDIO_MANAGER', 'TAILOR', 'CUTTER', 'CHECKER',
      'DESIGNER', 'PATTERN_MAKER', 'EMBROIDERER', 'FINISHER',
      'STUDIO_RECEPTIONIST', 'FASHION_CONSULTANT', 'FABRIC_MANAGER',
      'QUALITY_CONTROLLER', 'CUSTOMER', 'GUEST'
    )
  ),
  studio_id UUID,
  loyalty_points INTEGER DEFAULT 0,
  preferences JSONB,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Role-specific tables
CREATE TABLE studio_designers (
  user_id UUID REFERENCES fashion_users(id),
  studio_id UUID NOT NULL,
  specialization VARCHAR(100),
  experience_years INTEGER,
  portfolio_url VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  PRIMARY KEY (user_id, studio_id)
);

CREATE TABLE fashion_customers (
  user_id UUID REFERENCES fashion_users(id),
  style_preferences JSONB,
  size_preferences JSONB,
  budget_range VARCHAR(50),
  loyalty_tier VARCHAR(20) DEFAULT 'BRONZE',
  referral_code VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  PRIMARY KEY (user_id)
);

-- Studio memberships
CREATE TABLE studio_memberships (
  user_id UUID REFERENCES fashion_users(id),
  studio_id UUID NOT NULL,
  role_type VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, studio_id)
);
```

## Caching Strategy

### Cache Keys
```typescript
// User sessions
`auth:session:${sessionId}`
`auth:user:${userId}:sessions`

// User data
`clinic:user:${userId}`
`fashion:user:${userId}`

// OTP storage
`auth:otp:${domain}:${identifier}`

// Token blacklist
`auth:blacklist:${tokenHash}`

// Rate limiting
`clinic:rate_limit:${operation}:${identifier}`
`fashion:rate_limit:${operation}:${identifier}`
```

### Cache Configuration
```typescript
// Session cache: 24 hours
// User cache: 10 minutes
// OTP cache: 5 minutes
// Token blacklist: 24 hours
// Rate limit: 15 minutes
```

## Testing

### Unit Tests
```typescript
describe('ClinicAuthService', () => {
  it('should register a new healthcare user', async () => {
    const result = await clinicAuthService.register({
      email: 'test@clinic.com',
      password: 'password123',
      name: 'Test User',
      clinicId: 'clinic_123',
    });

    expect(result.success).toBe(true);
    expect(result.data.user.role).toBe('patient');
  });
});
```

### Integration Tests
```typescript
describe('Auth Integration', () => {
  it('should handle complete auth flow', async () => {
    // 1. Register user
    const registerResult = await authService.register(userData);
    
    // 2. Login user
    const loginResult = await authService.login(credentials);
    
    // 3. Verify token
    const tokenPayload = await authService.verifyToken(loginResult.data.access_token);
    
    // 4. Refresh token
    const refreshResult = await authService.refreshTokens(loginResult.data.refresh_token);
    
    // 5. Logout
    await authService.logout(userId);
  });
});
```

## Deployment

### Docker Configuration
```dockerfile
# Multi-stage build for production
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine AS production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
```

### Environment Variables
```bash
# Production environment
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://host:6379
JWT_SECRET=super-secret-production-key
```

## Performance Optimization

### For 1M Users
1. **Database Indexing**: Composite indexes on frequently queried fields
2. **Connection Pooling**: PgBouncer for PostgreSQL
3. **Caching**: Redis cluster for session and user data
4. **Load Balancing**: Multiple application instances
5. **CDN**: Static assets and API responses
6. **Monitoring**: Real-time performance metrics

### Scaling Strategy
1. **Horizontal Scaling**: Multiple app instances
2. **Database Sharding**: By domain or geographic region
3. **Cache Distribution**: Redis cluster across regions
4. **Microservices**: Separate auth service deployment

## Troubleshooting

### Common Issues

1. **Plugin Not Found**
   ```typescript
   // Ensure plugin is registered
   await pluginManager.registerPlugin(clinicAuthPlugin);
   ```

2. **Rate Limit Exceeded**
   ```typescript
   // Check rate limit configuration
   const config = authService.getConfiguration();
   console.log(config.rateLimitMax);
   ```

3. **Session Expired**
   ```typescript
   // Refresh token automatically
   const newTokens = await authService.refreshTokens(refreshToken);
   ```

4. **Circuit Breaker Open**
   ```typescript
   // Check circuit breaker state
   const state = await circuitBreakerService.getState('auth.plugin.clinic.login');
   ```

## Support and Maintenance

### Logging
- **Structured Logging**: JSON format for easy parsing
- **Log Levels**: DEBUG, INFO, WARN, ERROR
- **Context**: User ID, domain, operation tracking

### Monitoring
- **Health Checks**: Regular service health monitoring
- **Metrics Collection**: Performance and usage metrics
- **Alerting**: Automated alerts for failures

### Updates
- **Plugin Updates**: Hot-swappable plugin architecture
- **Configuration**: Dynamic configuration updates
- **Backward Compatibility**: Maintained across versions

---

## Quick Start Checklist

- [ ] Configure environment variables
- [ ] Register appropriate auth module
- [ ] Inject auth service in your application
- [ ] Set up database connections
- [ ] Configure Redis for caching
- [ ] Set up monitoring and logging
- [ ] Test authentication flows
- [ ] Configure rate limiting
- [ ] Set up circuit breakers
- [ ] Deploy to production

For additional support, refer to the individual plugin documentation or contact the development team.
