# Users Service

**Purpose:** User management with RBAC integration
**Location:** `src/services/users`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { UsersService } from '@services/users';

@Injectable()
export class MyService {
  constructor(private readonly usersService: UsersService) {}

  async getUser(userId: string) {
    return await this.usersService.findOne(userId);
  }
}
```

---

## Key Features

- ✅ **CRUD Operations** - Complete user management
- ✅ **Role Management** - 12 healthcare roles support
- ✅ **RBAC Integration** - Permission-based access control
- ✅ **Profile Management** - User profiles and preferences
- ✅ **Multi-Tenant** - Clinic-based user isolation

---

## API Endpoints

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/user/all` | GET | SUPER_ADMIN, CLINIC_ADMIN | Get all users |
| `/user/profile` | GET | All | Get own profile |
| `/user/:id` | GET | All | Get user by ID |
| `/user/:id` | PATCH | All | Update user (ownership) |
| `/user/:id` | DELETE | SUPER_ADMIN | Delete user |
| `/user/role/doctors` | GET | All | Get all doctors |
| `/user/:id/role` | PUT | SUPER_ADMIN | Update user role |

[Full API documentation](../../docs/api/README.md)

---

## Usage Examples

```typescript
// Get user profile
const profile = await this.usersService.getProfile(userId);

// Update user
await this.usersService.update(userId, { name: 'New Name' });

// Get doctors in clinic
const doctors = await this.usersService.findByRole('DOCTOR', clinicId);
```

---

## Related Documentation

- [RBAC Implementation](../../docs/features/RBAC_COMPLETE_IMPLEMENTATION.md)
- [API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
