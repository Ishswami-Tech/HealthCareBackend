# Frontend Default Clinic ID & Location-Based Access Implementation

## Overview

This document provides a **practical implementation guide** for:
1. **Frontend Default Clinic ID**: Frontend automatically sets and sends clinic ID in all requests
2. **Clinic-Specific User Registration**: Users registered to a single clinic only
3. **Location-Based Role Access**: Staff roles tied to locations, patients clinic-wide
4. **Location Management**: Only clinic admin/super admin can change locations
5. **Location Head Role**: New role for location management

---

## 🎯 Architecture Principles

### 1. Frontend Default Clinic ID
- **Frontend** automatically includes `X-Clinic-ID` header in all requests
- **Backend** validates clinic ID is present (already enforced by `ClinicGuard`)
- **No multi-clinic switching** for regular users (only clinic admin/super admin)

### 2. User Registration
- **Single Clinic**: Users registered to ONE clinic only (`primaryClinicId`)
- **No Multi-Clinic**: Users cannot belong to multiple clinics (except super admin)
- **Clinic Assignment**: During registration, user is assigned to the clinic from frontend

### 3. Location-Based Access
- **Staff Roles**: All staff (doctor, receptionist, etc.) assigned to specific locations
- **Patients**: Clinic-wide, can book appointments at any location
- **Location Changes**: Only clinic admin or super admin can change staff locations

### 4. Location Head Role
- **New Role**: `LOCATION_HEAD` for managing a specific location
- **Permissions**: Manage staff at their location, view location reports
- **Scope**: Limited to their assigned location

---

## 📋 Implementation Plan

### Phase 1: Frontend Default Clinic ID

#### Frontend Implementation

```typescript
// frontend/src/config/clinic.config.ts
export const CLINIC_CONFIG = {
  clinicId: process.env.NEXT_PUBLIC_CLINIC_ID || 'default-clinic-id',
  clinicName: process.env.NEXT_PUBLIC_CLINIC_NAME || 'Default Clinic',
};

// frontend/src/libs/api/client.ts
import axios from 'axios';
import { CLINIC_CONFIG } from '@/config/clinic.config';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

// Add clinic ID to all requests
apiClient.interceptors.request.use((config) => {
  // Add X-Clinic-ID header to all requests
  config.headers['X-Clinic-ID'] = CLINIC_CONFIG.clinicId;
  
  // Optionally add location ID if available in context
  const locationId = getLocationFromContext(); // Your context/store
  if (locationId) {
    config.headers['X-Location-ID'] = locationId;
  }
  
  return config;
});

export default apiClient;
```

#### Backend Validation (Already Implemented)

✅ **ClinicGuard** already enforces `clinicId` is COMPULSORY
✅ **ClinicGuard** extracts `clinicId` from `X-Clinic-ID` header (PRIORITY 1)

**File**: `src/libs/core/guards/clinic.guard.ts`

---

### Phase 2: Clinic-Specific User Registration

#### Update Registration Flow

**Current**: Users can register without clinic or with optional clinic
**New**: Users MUST be registered to clinic from frontend

```typescript
// src/libs/dtos/auth.dto.ts
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsUUID('4')
  @IsNotEmpty()  // CHANGED: Now REQUIRED
  clinicId!: string;  // Frontend must provide clinic ID

  @IsEnum(Role)
  @IsOptional()
  role?: Role = Role.PATIENT;
}
```

#### Update AuthService Registration

```typescript
// src/services/auth/auth.service.ts
async register(registerDto: RegisterDto): Promise<AuthResponse> {
  // ... existing validation ...

  // CHANGED: clinicId is now REQUIRED
  if (!registerDto.clinicId) {
    throw this.errors.badRequest(
      'Clinic ID is required for registration',
      'AuthService.register'
    );
  }

  // Validate clinic exists and is active
  const clinic = await this.databaseService.findClinicByIdSafe(registerDto.clinicId);
  if (!clinic || !clinic.isActive) {
    throw this.errors.badRequest(
      'Invalid or inactive clinic',
      'AuthService.register'
    );
  }

  // Create user with primaryClinicId
  const user = await this.databaseService.createUserSafe({
    email: registerDto.email,
    password: hashedPassword,
    firstName: registerDto.firstName,
    lastName: registerDto.lastName,
    role: registerDto.role || Role.PATIENT,
    primaryClinicId: registerDto.clinicId,  // Set primary clinic
    // DO NOT add to clinics[] - single clinic only
  });

  // For PATIENT role, create Patient record
  if (registerDto.role === Role.PATIENT) {
    await this.clinicService.registerPatientToClinic({
      userId: user.id,
      clinicId: registerDto.clinicId,
    });
  }

  // ... rest of registration flow ...
}
```

---

### Phase 3: Location-Based Role Access

#### Staff Role Assignment to Locations

**Current**: Staff roles have `locationId` field
**Enhancement**: Enforce location assignment during role creation

```typescript
// src/services/users/users.service.ts
async updateUserRole(
  userId: string,
  roleData: UpdateUserRoleDto,
  currentUserId: string,
  clinicId: string
): Promise<User> {
  // ... existing validation ...

  // For staff roles (non-PATIENT), locationId is REQUIRED
  const staffRoles = [
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.PHARMACIST,
    Role.THERAPIST,
    Role.LAB_TECHNICIAN,
    Role.FINANCE_BILLING,
    Role.SUPPORT_STAFF,
    Role.NURSE,
    Role.COUNSELOR,
    Role.LOCATION_HEAD,  // New role
  ];

  if (staffRoles.includes(roleData.role as Role) && !roleData.locationId) {
    throw this.errors.badRequest(
      `Location ID is required for ${roleData.role} role`,
      'UsersService.updateUserRole'
    );
  }

  // Validate location belongs to clinic
  if (roleData.locationId) {
    const location = await this.databaseService.findClinicLocationByIdSafe(
      roleData.locationId
    );
    if (!location || location.clinicId !== clinicId) {
      throw this.errors.badRequest(
        'Location does not belong to clinic',
        'UsersService.updateUserRole'
      );
    }
  }

  // ... create role record with locationId ...
}
```

#### Patient Location Access

**Patients**: Can book appointments at any location within their clinic

```typescript
// src/services/appointments/appointments.service.ts
async createAppointment(data: CreateAppointmentDto, clinicId: string): Promise<Appointment> {
  // ... existing validation ...

  // For PATIENT role: Validate location belongs to clinic
  if (data.locationId) {
    const location = await this.databaseService.findClinicLocationByIdSafe(data.locationId);
    if (!location || location.clinicId !== clinicId) {
      throw this.errors.badRequest(
        'Location does not belong to clinic',
        'AppointmentsService.createAppointment'
      );
    }
  }

  // ... create appointment ...
}
```

---

### Phase 4: Location Change Restrictions

#### Add Location Change Permission

```typescript
// src/libs/core/rbac/rbac.service.ts
// Add to CLINIC_ADMIN and SUPER_ADMIN permissions
const CLINIC_ADMIN_PERMISSIONS = [
  // ... existing permissions ...
  'locations:update',      // Update location details
  'locations:assign',      // Assign staff to locations
  'locations:reassign',   // Reassign staff between locations
  'users:change-location', // Change user's location
];

const SUPER_ADMIN_PERMISSIONS = [
  '*',  // All permissions
];
```

#### Create Location Change Service

```typescript
// src/services/users/services/location-management.service.ts
@Injectable()
export class LocationManagementService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly rbacService: RbacService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Change user's location (only clinic admin/super admin)
   */
  async changeUserLocation(
    userId: string,
    newLocationId: string,
    currentUserId: string,
    clinicId: string
  ): Promise<void> {
    // Check permission
    const permissionCheck = await this.rbacService.checkPermission({
      userId: currentUserId,
      clinicId,
      resource: 'users',
      action: 'change-location',
    });

    if (!permissionCheck.hasPermission) {
      throw new ForbiddenException('Only clinic admin or super admin can change locations');
    }

    // Get user's current role
    const user = await this.databaseService.findUserByIdSafe(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validate user belongs to clinic
    if (user.primaryClinicId !== clinicId) {
      throw new ForbiddenException('User does not belong to clinic');
    }

    // Validate new location belongs to clinic
    const location = await this.databaseService.findClinicLocationByIdSafe(newLocationId);
    if (!location || location.clinicId !== clinicId) {
      throw new BadRequestException('Location does not belong to clinic');
    }

    // Update location for staff roles
    const staffRoles = [
      Role.DOCTOR,
      Role.RECEPTIONIST,
      Role.PHARMACIST,
      Role.THERAPIST,
      Role.LAB_TECHNICIAN,
      Role.FINANCE_BILLING,
      Role.SUPPORT_STAFF,
      Role.NURSE,
      Role.COUNSELOR,
      Role.LOCATION_HEAD,
    ];

    if (!staffRoles.includes(user.role as Role)) {
      throw new BadRequestException('Only staff roles can have locations changed');
    }

    // Update location in role-specific table
    await this.updateRoleLocation(userId, user.role, newLocationId, clinicId);

    // Log location change
    await this.loggingService.log(
      LogType.AUDIT,
      LogLevel.INFO,
      `User location changed`,
      'LocationManagementService',
      {
        userId,
        oldLocationId: 'previous-location', // Get from current record
        newLocationId,
        changedBy: currentUserId,
        clinicId,
      }
    );
  }

  private async updateRoleLocation(
    userId: string,
    role: string,
    locationId: string,
    clinicId: string
  ): Promise<void> {
    // Update location in appropriate role table
    switch (role) {
      case Role.DOCTOR:
        await this.databaseService.executeHealthcareWrite(async client => {
          await client.doctorClinic.updateMany({
            where: { userId, clinicId },
            data: { locationId },
          });
        });
        break;
      case Role.RECEPTIONIST:
        await this.databaseService.executeHealthcareWrite(async client => {
          await client.receptionist.updateMany({
            where: { userId, clinicId },
            data: { locationId },
          });
        });
        break;
      // ... other roles ...
    }
  }
}
```

---

### Phase 5: Location Head Role

#### Add Location Head to Role Enum

```typescript
// src/libs/core/types/enums.types.ts
export enum Role {
  // ... existing roles ...
  LOCATION_HEAD = 'LOCATION_HEAD',
}
```

#### Add Location Head Permissions

```typescript
// src/libs/core/rbac/rbac.service.ts
const LOCATION_HEAD_PERMISSIONS = [
  // Location management
  'locations:read',           // View location details
  'locations:update',         // Update location settings
  'appointments:read',       // View appointments at location
  'appointments:update',      // Update appointments at location
  'queue:read',              // View queue at location
  'queue:manage',            // Manage queue at location
  'staff:read',              // View staff at location
  'staff:assign',            // Assign staff to location (limited to their location)
  'reports:read',            // View location reports
  'prescriptions:read',     // View prescriptions at location
  'inventory:read',          // View inventory at location
  'inventory:update',        // Update inventory at location
];
```

#### Create Location Head Model (if needed)

```prisma
// src/libs/infrastructure/database/prisma/schema.prisma
model LocationHead {
  id          String   @id @default(uuid())
  userId      String   @unique
  clinicId    String
  locationId  String?  // Assigned to specific location
  assignedAt  DateTime @default(now())
  assignedBy  String
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  clinic      Clinic   @relation(fields: [clinicId], references: [id])
  location    ClinicLocation? @relation(fields: [locationId], references: [id])

  @@unique([userId, clinicId, locationId])
  @@index([clinicId])
  @@index([locationId])
  @@index([isActive])
}
```

#### Update User Model

```prisma
// Add to User model
model User {
  // ... existing fields ...
  locationHead LocationHead?
}
```

---

## 🔐 Security & Access Control

### 1. Location Change Guard

```typescript
// src/libs/core/guards/location-change.guard.ts
@Injectable()
export class LocationChangeGuard implements CanActivate {
  constructor(
    private readonly rbacService: RbacService,
    private readonly loggingService: LoggingService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClinicRequest>();
    const user = request.user;
    const clinicId = request.clinicId;

    if (!user || !clinicId) {
      throw new UnauthorizedException('Authentication required');
    }

    // Check if user is clinic admin or super admin
    const permissionCheck = await this.rbacService.checkPermission({
      userId: user.id || user.sub || '',
      clinicId,
      resource: 'users',
      action: 'change-location',
    });

    if (!permissionCheck.hasPermission) {
      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'Location change attempt denied',
        'LocationChangeGuard',
        { userId: user.id, clinicId }
      );
      throw new ForbiddenException('Only clinic admin or super admin can change locations');
    }

    return true;
  }
}
```

### 2. Location-Based Data Filtering

```typescript
// src/services/appointments/appointments.service.ts
async getAppointments(clinicId: string, locationId?: string, userId?: string): Promise<Appointment[]> {
  const user = userId ? await this.databaseService.findUserByIdSafe(userId) : null;
  
  // For staff roles, filter by their location
  if (user && user.role !== Role.PATIENT && !locationId) {
    // Get user's location from role table
    const userLocation = await this.getUserLocation(user.id, user.role, clinicId);
    if (userLocation) {
      locationId = userLocation;
    }
  }

  return await this.databaseService.executeHealthcareRead(async client => {
    return await client.appointment.findMany({
      where: {
        clinicId,
        ...(locationId && { locationId }),  // Filter by location if provided
      },
    });
  });
}
```

---

## 📊 Database Schema Updates

### 1. Add Location Head Model

```prisma
model LocationHead {
  id          String   @id @default(uuid())
  userId      String   @unique
  clinicId    String
  locationId  String?
  assignedAt  DateTime @default(now())
  assignedBy  String
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  clinic      Clinic   @relation(fields: [clinicId], references: [id])
  location    ClinicLocation? @relation(fields: [locationId], references: [id])

  @@unique([userId, clinicId, locationId])
  @@index([clinicId])
  @@index([locationId])
  @@index([isActive])
}
```

### 2. Update ClinicLocation Model

```prisma
model ClinicLocation {
  // ... existing fields ...
  locationHeads LocationHead[]  // Add relation
}
```

---

## 🚀 Implementation Steps

### Step 1: Update Registration (Priority: HIGH)
1. ✅ Make `clinicId` REQUIRED in `RegisterDto`
2. ✅ Update `AuthService.register()` to validate clinic
3. ✅ Set `primaryClinicId` during registration
4. ✅ Remove multi-clinic support for regular users

### Step 2: Add Location Head Role (Priority: MEDIUM)
1. ✅ Add `LOCATION_HEAD` to `Role` enum
2. ✅ Create `LocationHead` model in schema
3. ✅ Add `LocationHead` permissions to RBAC
4. ✅ Update seed script to create location head users

### Step 3: Location Change Restrictions (Priority: HIGH)
1. ✅ Create `LocationManagementService`
2. ✅ Add `LocationChangeGuard`
3. ✅ Add `users:change-location` permission
4. ✅ Create API endpoint for location changes

### Step 4: Location-Based Filtering (Priority: MEDIUM)
1. ✅ Update services to filter by location for staff
2. ✅ Allow patients to access all locations
3. ✅ Add location context to queries

### Step 5: Frontend Integration (Priority: HIGH)
1. ✅ Configure default clinic ID in frontend
2. ✅ Add `X-Clinic-ID` header to all requests
3. ✅ Add location context management
4. ✅ Update registration form to include clinic ID

---

## 📝 API Endpoints

### Location Management

```typescript
// POST /api/v1/users/:userId/change-location
// Only CLINIC_ADMIN or SUPER_ADMIN
@Post(':userId/change-location')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, LocationChangeGuard, RbacGuard)
@Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
@RequireResourcePermission('users', 'change-location')
async changeUserLocation(
  @Param('userId') userId: string,
  @Body() dto: { locationId: string },
  @ClinicId() clinicId: string,
  @CurrentUser() user: AuthenticatedUser
): Promise<{ success: boolean }> {
  await this.locationManagementService.changeUserLocation(
    userId,
    dto.locationId,
    user.id || user.sub || '',
    clinicId
  );
  return { success: true };
}
```

### Get User's Location

```typescript
// GET /api/v1/users/:userId/location
@Get(':userId/location')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
async getUserLocation(
  @Param('userId') userId: string,
  @ClinicId() clinicId: string
): Promise<{ locationId: string | null; locationName: string | null }> {
  const user = await this.databaseService.findUserByIdSafe(userId);
  if (!user || user.primaryClinicId !== clinicId) {
    throw new NotFoundException('User not found');
  }

  const location = await this.getUserLocationFromRole(userId, user.role, clinicId);
  return {
    locationId: location?.id || null,
    locationName: location?.name || null,
  };
}
```

---

## ✅ Testing Checklist

### Registration
- [ ] User can register with clinic ID
- [ ] Registration fails without clinic ID
- [ ] User's `primaryClinicId` is set correctly
- [ ] Patient record created for PATIENT role

### Location Assignment
- [ ] Staff roles require location ID
- [ ] Location validation (belongs to clinic)
- [ ] Location head can be assigned to location

### Location Changes
- [ ] Only clinic admin can change locations
- [ ] Only super admin can change locations
- [ ] Regular users cannot change locations
- [ ] Location change is logged

### Data Access
- [ ] Staff see only their location's data
- [ ] Patients can access all locations
- [ ] Location head sees only their location

---

## 🎯 Best Practices

### 1. Frontend Clinic ID
- ✅ Store clinic ID in environment variables
- ✅ Add to all API requests automatically
- ✅ Validate clinic ID on app initialization

### 2. User Registration
- ✅ Always require clinic ID
- ✅ Validate clinic exists and is active
- ✅ Set primary clinic immediately

### 3. Location Management
- ✅ Enforce location for staff roles
- ✅ Allow location changes only by admins
- ✅ Log all location changes

### 4. Data Filtering
- ✅ Filter by location for staff automatically
- ✅ Allow patients to choose locations
- ✅ Validate location belongs to clinic

---

## 📚 Related Documentation

- [Location System Complete](./LOCATION_SYSTEM_COMPLETE.md) - Complete multi-clinic, multi-location system guide
- [Role Permissions](./../ROLE_PERMISSIONS_COMPLETE.md) - Complete RBAC and permissions guide
- [System Architecture](./SYSTEM_ARCHITECTURE.md) - Overall system architecture

---

**Last Updated**: 2024-12-16
**Status**: 📋 Implementation Plan - Ready for Development


