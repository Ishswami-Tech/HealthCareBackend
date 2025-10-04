import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { AsyncLocalStorage } from "async_hooks";

export interface ClinicContext {
  clinicId: string;
  clinicName: string;
  locationId?: string;
  locationName?: string;
  userId: string;
  userRole: string;
  permissions: string[];
  metadata: {
    requestId: string;
    timestamp: Date;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  };
}

export interface ClinicInfo {
  id: string;
  name: string;
  code: string;
  type: "hospital" | "clinic" | "diagnostic" | "specialty";
  status: "active" | "inactive" | "suspended";
  locations: ClinicLocation[];
  settings: ClinicSettings;
  subscription: {
    plan: "basic" | "professional" | "enterprise";
    maxUsers: number;
    maxPatients: number;
    expiresAt: Date;
  };
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    ownerId: string;
    timezone: string;
    locale: string;
  };
}

export interface ClinicLocation {
  id: string;
  name: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  contact: {
    phone: string;
    email: string;
    website?: string;
  };
  operatingHours: {
    [key: string]: {
      // day of week
      open: string; // HH:mm
      close: string; // HH:mm
      isOpen: boolean;
    };
  };
  services: string[];
  capacity: {
    maxAppointments: number;
    maxConcurrent: number;
  };
}

export interface ClinicSettings {
  appointmentSettings: {
    defaultDuration: number;
    bufferTime: number;
    maxAdvanceBooking: number; // days
    allowOnlineBooking: boolean;
    requireApproval: boolean;
  };
  notificationSettings: {
    emailEnabled: boolean;
    smsEnabled: boolean;
    reminderHours: number[];
  };
  billingSettings: {
    currency: string;
    taxRate: number;
    paymentMethods: string[];
    invoicePrefix: string;
  };
  securitySettings: {
    mfaRequired: boolean;
    sessionTimeout: number; // minutes
    passwordPolicy: {
      minLength: number;
      requireSpecialChars: boolean;
      requireNumbers: boolean;
      expirationDays: number;
    };
  };
  integrationSettings: {
    enabledIntegrations: string[];
    webhookUrl?: string;
    apiKeys: Record<string, string>;
  };
}

export interface UserClinicAssociation {
  userId: string;
  clinicId: string;
  role: string;
  permissions: string[];
  locations: string[]; // Location IDs user has access to
  restrictions: {
    timeRestricted: boolean;
    ipRestricted: boolean;
    allowedIPs: string[];
    workingHours: {
      start: string; // HH:mm
      end: string; // HH:mm
      days: number[]; // 0-6, Sunday = 0
    };
  };
  status: "active" | "inactive" | "suspended";
  metadata: {
    assignedAt: Date;
    assignedBy: string;
    lastLogin?: Date;
  };
}

@Injectable()
export class ClinicContextService {
  private readonly logger = new Logger(ClinicContextService.name);
  private readonly contextStore = new AsyncLocalStorage<ClinicContext>();

  // In-memory cache for clinic data (in production, this would be Redis/Database)
  private clinicCache = new Map<string, ClinicInfo>();
  private userClinicCache = new Map<string, UserClinicAssociation[]>();

  constructor() {
    this.initializeDefaultClinics();
  }

  private initializeDefaultClinics(): void {
    // Initialize sample clinic data for development
    const sampleClinic: ClinicInfo = {
      id: "clinic-1",
      name: "HealthCare Plus",
      code: "HCP001",
      type: "clinic",
      status: "active",
      locations: [
        {
          id: "loc-1",
          name: "Main Branch",
          address: {
            street: "123 Healthcare Street",
            city: "Medical City",
            state: "Health State",
            zipCode: "12345",
            country: "India",
          },
          contact: {
            phone: "+91-9876543210",
            email: "contact@healthcareplus.com",
          },
          operatingHours: {
            monday: { open: "09:00", close: "18:00", isOpen: true },
            tuesday: { open: "09:00", close: "18:00", isOpen: true },
            wednesday: { open: "09:00", close: "18:00", isOpen: true },
            thursday: { open: "09:00", close: "18:00", isOpen: true },
            friday: { open: "09:00", close: "18:00", isOpen: true },
            saturday: { open: "09:00", close: "14:00", isOpen: true },
            sunday: { open: "10:00", close: "14:00", isOpen: false },
          },
          services: ["general-consultation", "diagnostics", "pharmacy"],
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
          currency: "INR",
          taxRate: 18,
          paymentMethods: ["cash", "card", "upi", "netbanking"],
          invoicePrefix: "HCP",
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
          enabledIntegrations: ["email", "sms"],
          apiKeys: {},
        },
      },
      subscription: {
        plan: "professional",
        maxUsers: 50,
        maxPatients: 10000,
        expiresAt: new Date("2025-12-31"),
      },
      metadata: {
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date(),
        ownerId: "owner-1",
        timezone: "Asia/Kolkata",
        locale: "en-IN",
      },
    };

    this.clinicCache.set(sampleClinic.id, sampleClinic);
    this.logger.log("📋 Initialized sample clinic data");
  }

  // Context Management

  async setContext(context: ClinicContext): Promise<void> {
    // Validate context
    await this.validateContext(context);

    // Store context in AsyncLocalStorage
    this.contextStore.enterWith(context);

    this.logger.debug(
      `🏥 Set clinic context: ${context.clinicId} for user ${context.userId}`,
    );
  }

  getContext(): ClinicContext | undefined {
    return this.contextStore.getStore();
  }

  getCurrentClinicId(): string {
    const context = this.getContext();
    if (!context) {
      throw new BadRequestException("Clinic context not available");
    }
    return context.clinicId;
  }

  getCurrentUserId(): string {
    const context = this.getContext();
    if (!context) {
      throw new BadRequestException("User context not available");
    }
    return context.userId;
  }

  getCurrentUserRole(): string {
    const context = this.getContext();
    if (!context) {
      throw new BadRequestException("User role context not available");
    }
    return context.userRole;
  }

  hasPermission(permission: string): boolean {
    const context = this.getContext();
    if (!context) return false;
    return context.permissions.includes(permission);
  }

  async runWithContext<T>(
    context: ClinicContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.contextStore.run(context, async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (_error) {
          reject(_error);
        }
      });
    });
  }

  // Clinic Management

  async getClinicInfo(clinicId: string): Promise<ClinicInfo> {
    const clinic = this.clinicCache.get(clinicId);
    if (!clinic) {
      throw new BadRequestException(`Clinic ${clinicId} not found`);
    }
    return clinic;
  }

  async getUserClinics(userId: string): Promise<UserClinicAssociation[]> {
    const associations = this.userClinicCache.get(userId) || [];
    return associations.filter((assoc) => assoc.status === "active");
  }

  async addUserToClinic(
    userId: string,
    clinicId: string,
    role: string,
    permissions: string[],
    assignedBy: string,
    options: {
      locations?: string[];
      restrictions?: Partial<UserClinicAssociation["restrictions"]>;
    } = {},
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
          start: "09:00",
          end: "18:00",
          days: [1, 2, 3, 4, 5], // Monday to Friday
        },
        ...options.restrictions,
      },
      status: "active",
      metadata: {
        assignedAt: new Date(),
        assignedBy,
      },
    };

    // Get existing associations
    const existingAssociations = this.userClinicCache.get(userId) || [];

    // Check if association already exists
    const existingIndex = existingAssociations.findIndex(
      (assoc) => assoc.clinicId === clinicId,
    );

    if (existingIndex >= 0) {
      // Update existing association
      existingAssociations[existingIndex] = association;
    } else {
      // Add new association
      existingAssociations.push(association);
    }

    this.userClinicCache.set(userId, existingAssociations);

    this.logger.log(
      `👤 Added user ${userId} to clinic ${clinicId} with role ${role}`,
    );

    return association;
  }

  async removeUserFromClinic(
    userId: string,
    clinicId: string,
  ): Promise<boolean> {
    const associations = this.userClinicCache.get(userId) || [];
    const updatedAssociations = associations.filter(
      (assoc) => assoc.clinicId !== clinicId,
    );

    if (updatedAssociations.length < associations.length) {
      this.userClinicCache.set(userId, updatedAssociations);
      this.logger.log(`👤 Removed user ${userId} from clinic ${clinicId}`);
      return true;
    }

    return false;
  }

  // Access Control and Validation

  async validateUserAccess(
    userId: string,
    clinicId: string,
    requiredPermissions: string[] = [],
  ): Promise<{
    hasAccess: boolean;
    association?: UserClinicAssociation;
    restrictions: string[];
  }> {
    const userClinics = await this.getUserClinics(userId);
    const association = userClinics.find(
      (assoc) => assoc.clinicId === clinicId,
    );

    if (!association) {
      return {
        hasAccess: false,
        restrictions: ["User not associated with clinic"],
      };
    }

    const restrictions: string[] = [];

    // Check permissions
    const missingPermissions = requiredPermissions.filter(
      (perm) => !association.permissions.includes(perm),
    );

    if (missingPermissions.length > 0) {
      restrictions.push(
        `Missing permissions: ${missingPermissions.join(", ")}`,
      );
    }

    // Check time restrictions
    if (association.restrictions.timeRestricted) {
      const now = new Date();
      const currentDay = now.getDay();
      const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

      const workingHours = association.restrictions.workingHours;

      if (!workingHours.days.includes(currentDay)) {
        restrictions.push("Access not allowed on current day");
      } else if (
        currentTime < workingHours.start ||
        currentTime > workingHours.end
      ) {
        restrictions.push(
          `Access only allowed between ${workingHours.start} and ${workingHours.end}`,
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

    if (clinic.status !== "active") {
      throw new ForbiddenException(`Clinic ${context.clinicId} is not active`);
    }

    // Validate user access
    const accessResult = await this.validateUserAccess(
      context.userId,
      context.clinicId,
      context.permissions,
    );

    if (!accessResult.hasAccess) {
      throw new ForbiddenException(
        `User access denied: ${accessResult.restrictions.join(", ")}`,
      );
    }

    // Validate location if specified
    if (context.locationId) {
      const location = clinic.locations.find(
        (loc) => loc.id === context.locationId,
      );
      if (!location) {
        throw new BadRequestException(
          `Location ${context.locationId} not found in clinic ${context.clinicId}`,
        );
      }

      // Check if user has access to location
      if (
        accessResult.association!.locations.length > 0 &&
        !accessResult.association!.locations.includes(context.locationId)
      ) {
        throw new ForbiddenException(
          `User does not have access to location ${context.locationId}`,
        );
      }
    }
  }

  // Data Isolation Helpers

  addClinicFilter<T extends Record<string, unknown>>(
    filter: T,
  ): T & { clinicId: string } {
    const clinicId = this.getCurrentClinicId();
    return { ...filter, clinicId };
  }

  addLocationFilter<T extends Record<string, unknown>>(
    filter: T,
  ): T & { clinicId: string; locationId?: string } {
    const context = this.getContext();
    if (!context) {
      throw new BadRequestException(
        "Context not available for location filtering",
      );
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
    return clinic.settings;
  }

  async updateClinicSettings(
    settings: Partial<ClinicSettings>,
    clinicId?: string,
  ): Promise<ClinicSettings> {
    const targetClinicId = clinicId || this.getCurrentClinicId();
    const clinic = await this.getClinicInfo(targetClinicId);

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
    const updatedClinic = {
      ...clinic,
      settings: updatedSettings,
      metadata: {
        ...((clinic as any).metadata || {}),
        updatedAt: new Date(),
      },
    };

    this.clinicCache.set(targetClinicId, updatedClinic);

    this.logger.log(`⚙️ Updated settings for clinic ${targetClinicId}`);

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
      (clinic) => clinic.status === "active",
    ).length;

    const totalUsers = Array.from(this.userClinicCache.values()).reduce(
      (total, associations) => total + associations.length,
      0,
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
      this.logger.log(`🧹 Cleared cache for clinic ${clinicId}`);
    } else {
      this.clinicCache.clear();
      this.userClinicCache.clear();
      this.logger.log("🧹 Cleared all clinic context cache");
    }
  }

  // Helper methods for business logic

  isWithinOperatingHours(clinicId?: string, locationId?: string): boolean {
    const targetClinicId = clinicId || this.getCurrentClinicId();
    const clinic = this.clinicCache.get(targetClinicId);

    if (!clinic) return false;

    const location = locationId
      ? clinic.locations.find((loc) => loc.id === locationId)
      : clinic.locations[0];

    if (!location) return false;

    const now = new Date();
    const dayName = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ][now.getDay()];
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    const daySchedule = location.operatingHours[dayName];

    return (
      daySchedule &&
      daySchedule.isOpen &&
      currentTime >= daySchedule.open &&
      currentTime <= daySchedule.close
    );
  }

  async getClinicCapacity(
    clinicId?: string,
    locationId?: string,
  ): Promise<{
    maxAppointments: number;
    maxConcurrent: number;
    currentLoad: number;
    utilizationRate: number;
  }> {
    const targetClinicId = clinicId || this.getCurrentClinicId();
    const clinic = await this.getClinicInfo(targetClinicId);

    const location = locationId
      ? clinic.locations.find((loc) => loc.id === locationId)
      : clinic.locations[0];

    if (!location) {
      throw new BadRequestException("Location not found");
    }

    // This would integrate with actual appointment data to get current load
    const currentLoad = 0; // Placeholder

    return {
      maxAppointments: location.capacity.maxAppointments,
      maxConcurrent: location.capacity.maxConcurrent,
      currentLoad,
      utilizationRate: (currentLoad / location.capacity.maxAppointments) * 100,
    };
  }
}
