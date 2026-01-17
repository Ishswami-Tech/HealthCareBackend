import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import type {
  ClinicContext,
  ClinicInfo,
  ClinicLocation,
  ClinicSettings,
  UserClinicAssociation,
} from '@core/types/clinic.types';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

// Re-export types for backward compatibility
export type { ClinicContext, ClinicInfo, ClinicLocation, ClinicSettings, UserClinicAssociation };

@Injectable()
export class ClinicContextService {
  private readonly contextStore = new AsyncLocalStorage<ClinicContext>();

  // In-memory cache for clinic data (in production, this would be Redis/Database)
  private clinicCache = new Map<string, ClinicInfo>();
  private userClinicCache = new Map<string, UserClinicAssociation[]>();

  constructor(private readonly loggingService: LoggingService) {
    this.initializeDefaultClinics();
  }

  private initializeDefaultClinics(): void {
    // Initialize sample clinic data for development
    const sampleClinic: ClinicInfo = {
      id: 'clinic-1',
      name: 'HealthCare Plus',
      appName: 'HealthCare Plus',
      isActive: true,
      createdAt: new Date('2024-01-01'),
      code: 'HCP001',
      type: 'clinic',
      status: 'active',
      locations: [
        {
          id: 'loc-1',
          locationId: 'loc-1',
          name: 'Main Branch',
          address: '123 Healthcare Street, Medical City, Health State, 12345, India',
          city: 'Medical City',
          state: 'Health State',
          country: 'India',
          zipCode: '12345',
          phone: '+91-9876543210',
          email: 'contact@healthcareplus.com',
          timezone: 'Asia/Kolkata',
          isActive: true,
          operatingHours: {
            monday: { open: '09:00', close: '18:00', isOpen: true },
            tuesday: { open: '09:00', close: '18:00', isOpen: true },
            wednesday: { open: '09:00', close: '18:00', isOpen: true },
            thursday: { open: '09:00', close: '18:00', isOpen: true },
            friday: { open: '09:00', close: '18:00', isOpen: true },
            saturday: { open: '09:00', close: '14:00', isOpen: true },
            sunday: { open: '10:00', close: '14:00', isOpen: false },
          },
          capacity: {
            maxAppointments: 100,
            maxConcurrent: 20,
          },
        },
      ],
      settings: {
        appointmentSettings: {
          defaultDuration: 30,
          bufferTime: 15,
          maxAdvanceBooking: 30,
          allowOnlineBooking: true,
          requireApproval: false,
        },
        notificationSettings: {
          emailEnabled: true,
          smsEnabled: true,
          reminderHours: [24, 2],
        },
        billingSettings: {
          currency: 'INR',
          taxRate: 18,
          paymentMethods: ['cash', 'card', 'upi', 'netbanking'],
          invoicePrefix: 'HCP',
        },
        securitySettings: {
          mfaRequired: false,
          sessionTimeout: 480, // 8 hours
          passwordPolicy: {
            minLength: 8,
            requireSpecialChars: true,
            requireNumbers: true,
            expirationDays: 90,
          },
        },
        integrationSettings: {
          enabledIntegrations: ['email', 'sms'],
          apiKeys: {},
        },
      },
      subscription: {
        plan: 'professional',
        maxUsers: 50,
        maxPatients: 10000,
        expiresAt: new Date('2026-12-31'), // Sample: keep in future for 2026 dev/tests
      },
      metadata: {
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
        ownerId: 'owner-1',
        timezone: 'Asia/Kolkata',
        locale: 'en-IN',
      },
    };

    this.clinicCache.set(sampleClinic.id, sampleClinic);
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Initialized sample clinic data',
      'ClinicContextService',
      { clinicId: sampleClinic.id, clinicName: sampleClinic.name }
    );
  }

  // Context Management

  async setContext(context: ClinicContext): Promise<void> {
    // Validate context
    await this.validateContext(context);

    // Store context in AsyncLocalStorage
    this.contextStore.enterWith(context);

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.DEBUG,
      'Set clinic context',
      'ClinicContextService',
      { clinicId: context.clinicId, userId: context.userId }
    );
  }

  getContext(): ClinicContext | undefined {
    return this.contextStore.getStore();
  }

  getCurrentClinicId(): string {
    const context = this.getContext();
    if (!context) {
      throw new BadRequestException('Clinic context not available');
    }
    return context.clinicId;
  }

  getCurrentUserId(): string {
    const context = this.getContext();
    if (!context || !context.userId) {
      throw new BadRequestException('User context not available');
    }
    return context.userId;
  }

  getCurrentUserRole(): string {
    const context = this.getContext();
    if (!context || !context.userRole) {
      throw new BadRequestException('User role context not available');
    }
    return context.userRole;
  }

  hasPermission(permission: string): boolean {
    const context = this.getContext();
    if (!context || !context.permissions) return false;
    return context.permissions.includes(permission);
  }

  async runWithContext<T>(context: ClinicContext, fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      void this.contextStore.run(context, async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (_error) {
          reject(_error instanceof Error ? _error : new Error(String(_error)));
        }
      });
    });
  }

  // Clinic Management

  getClinicInfo(clinicId: string): Promise<ClinicInfo> {
    const clinic = this.clinicCache.get(clinicId);
    if (!clinic) {
      throw new BadRequestException(`Clinic ${clinicId} not found`);
    }
    return Promise.resolve(clinic);
  }

  getUserClinics(userId: string): Promise<UserClinicAssociation[]> {
    const associations = this.userClinicCache.get(userId) || [];
    return Promise.resolve(associations.filter(assoc => assoc.status === 'active'));
  }

  async addUserToClinic(
    userId: string,
    clinicId: string,
    role: string,
    permissions: string[],
    assignedBy: string,
    options: {
      locations?: string[];
      restrictions?: Partial<UserClinicAssociation['restrictions']>;
    } = {}
  ): Promise<UserClinicAssociation> {
    // Validate clinic exists
    await this.getClinicInfo(clinicId);

    const association: UserClinicAssociation = {
      userId,
      clinicId,
      role,
      permissions,
      locations: options.locations || [],
      restrictions: {
        timeRestricted: false,
        ipRestricted: false,
        allowedIPs: [],
        workingHours: {
          start: '09:00',
          end: '18:00',
          days: [1, 2, 3, 4, 5], // Monday to Friday
        },
        ...options.restrictions,
      },
      status: 'active',
      metadata: {
        assignedAt: new Date(),
        assignedBy,
      },
    };

    // Get existing associations
    const existingAssociations = this.userClinicCache.get(userId) || [];

    // Check if association already exists
    const existingIndex = existingAssociations.findIndex(assoc => assoc.clinicId === clinicId);

    if (existingIndex >= 0) {
      // Update existing association
      existingAssociations[existingIndex] = association;
    } else {
      // Add new association
      existingAssociations.push(association);
    }

    this.userClinicCache.set(userId, existingAssociations);

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Added user to clinic',
      'ClinicContextService',
      { userId, clinicId, role, assignedBy }
    );

    return association;
  }

  removeUserFromClinic(userId: string, clinicId: string): Promise<boolean> {
    const associations = this.userClinicCache.get(userId) || [];
    const updatedAssociations = associations.filter(assoc => assoc.clinicId !== clinicId);

    if (updatedAssociations.length < associations.length) {
      this.userClinicCache.set(userId, updatedAssociations);
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Removed user from clinic',
        'ClinicContextService',
        { userId, clinicId }
      );
      return Promise.resolve(true);
    }

    return Promise.resolve(false);
  }

  // Access Control and Validation

  async validateUserAccess(
    userId: string,
    clinicId: string,
    requiredPermissions: string[] = []
  ): Promise<{
    hasAccess: boolean;
    association?: UserClinicAssociation;
    restrictions: string[];
  }> {
    const userClinics = await this.getUserClinics(userId);
    const association = userClinics.find(assoc => assoc.clinicId === clinicId);

    if (!association) {
      return {
        hasAccess: false,
        restrictions: ['User not associated with clinic'],
      };
    }

    const restrictions: string[] = [];

    // Check permissions
    const missingPermissions = requiredPermissions.filter(
      perm => !association.permissions.includes(perm)
    );

    if (missingPermissions.length > 0) {
      restrictions.push(`Missing permissions: ${missingPermissions.join(', ')}`);
    }

    // Check time restrictions
    if (association.restrictions.timeRestricted) {
      const now = new Date();
      const currentDay = now.getDay();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      const workingHours = association.restrictions.workingHours;

      if (!workingHours.days.includes(currentDay)) {
        restrictions.push('Access not allowed on current day');
      } else if (currentTime < workingHours.start || currentTime > workingHours.end) {
        restrictions.push(
          `Access only allowed between ${workingHours.start} and ${workingHours.end}`
        );
      }
    }

    return {
      hasAccess: restrictions.length === 0,
      association,
      restrictions,
    };
  }

  async validateContext(context: ClinicContext): Promise<void> {
    // Validate clinic exists
    const clinic = await this.getClinicInfo(context.clinicId);

    if (clinic.status !== 'active') {
      throw new ForbiddenException(`Clinic ${context.clinicId} is not active`);
    }

    // Validate user access
    const requiredPermissions = context.permissions || [];
    const userId = context.userId;
    if (!userId) {
      throw new BadRequestException('User ID is required in context');
    }
    const accessResult = await this.validateUserAccess(
      userId,
      context.clinicId,
      requiredPermissions
    );

    if (!accessResult.hasAccess) {
      throw new ForbiddenException(`User access denied: ${accessResult.restrictions.join(', ')}`);
    }

    // Validate location if specified
    if (context.locationId) {
      if (!clinic.locations || clinic.locations.length === 0) {
        throw new BadRequestException(`Clinic ${context.clinicId} has no locations`);
      }
      const location = clinic.locations.find(loc => loc.id === context.locationId);
      if (!location) {
        throw new BadRequestException(
          `Location ${context.locationId} not found in clinic ${context.clinicId}`
        );
      }

      // Check if user has access to location
      if (
        accessResult.association!.locations.length > 0 &&
        !accessResult.association!.locations.includes(context.locationId)
      ) {
        throw new ForbiddenException(`User does not have access to location ${context.locationId}`);
      }
    }
  }

  // Data Isolation Helpers

  addClinicFilter<T extends Record<string, unknown>>(filter: T): T & { clinicId: string } {
    const clinicId = this.getCurrentClinicId();
    return { ...filter, clinicId };
  }

  addLocationFilter<T extends Record<string, unknown>>(
    filter: T
  ): T & { clinicId: string; locationId?: string } {
    const context = this.getContext();
    if (!context) {
      throw new BadRequestException('Context not available for location filtering');
    }

    const result: T & { clinicId: string; locationId?: string } = {
      ...filter,
      clinicId: context.clinicId,
    };

    if (context.locationId) {
      result.locationId = context.locationId;
    }

    return result;
  }

  // Clinic Settings

  async getClinicSettings(clinicId?: string): Promise<ClinicSettings> {
    const targetClinicId = clinicId || this.getCurrentClinicId();
    const clinic = await this.getClinicInfo(targetClinicId);
    if (!clinic.settings) {
      throw new BadRequestException(`Clinic ${targetClinicId} has no settings configured`);
    }
    return clinic.settings;
  }

  async updateClinicSettings(
    settings: Partial<ClinicSettings>,
    clinicId?: string
  ): Promise<ClinicSettings> {
    const targetClinicId = clinicId || this.getCurrentClinicId();
    const clinic = await this.getClinicInfo(targetClinicId);

    if (!clinic.settings) {
      throw new BadRequestException(`Clinic ${targetClinicId} has no settings to update`);
    }

    // Deep merge settings
    const updatedSettings = {
      ...clinic.settings,
      ...settings,
      appointmentSettings: {
        ...clinic.settings.appointmentSettings,
        ...(settings.appointmentSettings || {}),
      },
      notificationSettings: {
        ...clinic.settings.notificationSettings,
        ...(settings.notificationSettings || {}),
      },
      billingSettings: {
        ...clinic.settings.billingSettings,
        ...(settings.billingSettings || {}),
      },
      securitySettings: {
        ...clinic.settings.securitySettings,
        ...(settings.securitySettings || {}),
        passwordPolicy: {
          ...clinic.settings.securitySettings.passwordPolicy,
          ...(settings.securitySettings?.passwordPolicy || {}),
        },
      },
      integrationSettings: {
        ...clinic.settings.integrationSettings,
        ...(settings.integrationSettings || {}),
        apiKeys: {
          ...clinic.settings.integrationSettings.apiKeys,
          ...(settings.integrationSettings?.apiKeys || {}),
        },
      },
    };

    // Update clinic in cache
    const existingMetadata = clinic.metadata || {
      createdAt: new Date(),
      updatedAt: new Date(),
      ownerId: '',
      timezone: 'UTC',
      locale: 'en',
    };
    const updatedClinic = {
      ...clinic,
      settings: updatedSettings,
      metadata: {
        ...existingMetadata,
        updatedAt: new Date(),
      },
    };

    this.clinicCache.set(targetClinicId, updatedClinic);

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Updated clinic settings',
      'ClinicContextService',
      { clinicId: targetClinicId }
    );

    return updatedSettings;
  }

  // Statistics and Monitoring

  getContextStats(): {
    activeClinics: number;
    totalUsers: number;
    contextHits: number;
    cacheSize: number;
  } {
    const activeClinics = Array.from(this.clinicCache.values()).filter(
      clinic => clinic.status === 'active'
    ).length;

    const totalUsers = Array.from(this.userClinicCache.values()).reduce(
      (total, associations) => total + associations.length,
      0
    );

    return {
      activeClinics,
      totalUsers,
      contextHits: 0, // Would be tracked from actual usage
      cacheSize: this.clinicCache.size,
    };
  }

  clearCache(clinicId?: string): void {
    if (clinicId) {
      this.clinicCache.delete(clinicId);
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Cleared cache for clinic',
        'ClinicContextService',
        { clinicId }
      );
    } else {
      this.clinicCache.clear();
      this.userClinicCache.clear();
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Cleared all clinic context cache',
        'ClinicContextService',
        {}
      );
    }
  }

  // Helper methods for business logic

  isWithinOperatingHours(clinicId?: string, locationId?: string): boolean {
    const targetClinicId = clinicId || this.getCurrentClinicId();
    const clinic = this.clinicCache.get(targetClinicId);

    if (!clinic || !clinic.locations || clinic.locations.length === 0) return false;

    const location = locationId
      ? clinic.locations.find(loc => loc.id === locationId)
      : clinic.locations[0];

    if (!location || !location.operatingHours) return false;

    const now = new Date();
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
      now.getDay()
    ];
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const daySchedule = location.operatingHours[dayName as keyof typeof location.operatingHours];

    return !!(
      daySchedule &&
      daySchedule.isOpen &&
      currentTime >= daySchedule.open &&
      currentTime <= daySchedule.close
    );
  }

  async getClinicCapacity(
    clinicId?: string,
    locationId?: string
  ): Promise<{
    maxAppointments: number;
    maxConcurrent: number;
    currentLoad: number;
    utilizationRate: number;
  }> {
    const targetClinicId = clinicId || this.getCurrentClinicId();
    const clinic = await this.getClinicInfo(targetClinicId);

    if (!clinic.locations || clinic.locations.length === 0) {
      throw new BadRequestException('No locations found for clinic');
    }

    const location = locationId
      ? clinic.locations.find(loc => loc.id === locationId)
      : clinic.locations[0];

    if (!location) {
      throw new BadRequestException('Location not found');
    }

    // Default capacity if not specified
    const defaultCapacity = {
      maxAppointments: 100,
      maxConcurrent: 20,
    };

    const capacity = location.capacity || defaultCapacity;

    // This would integrate with actual appointment data to get current load
    const currentLoad = 0; // Placeholder

    return {
      maxAppointments: capacity.maxAppointments,
      maxConcurrent: capacity.maxConcurrent,
      currentLoad,
      utilizationRate:
        capacity.maxAppointments > 0 ? (currentLoad / capacity.maxAppointments) * 100 : 0,
    };
  }
}
