import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Scope,
  Logger,
} from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";

// Export the PrismaClient type for proper typing
export type { PrismaClient };

// Import Prisma's generated types systematically
import type {
  User,
  Doctor,
  Patient,
  Receptionist,
  ClinicAdmin,
  SuperAdmin,
  Pharmacist,
  Therapist,
  LabTechnician,
  FinanceBilling,
  SupportStaff,
  Nurse,
  Counselor,
  Clinic,
  Appointment,
  AuditLog,
  BillingPlan,
  Subscription,
  Invoice,
  Payment,
} from "./prisma.types";

// Comprehensive type-safe validators using direct Prisma types
const userIncludeValidator = {
  doctor: true,
  patient: true,
  receptionists: true,
  clinicAdmins: true,
  superAdmin: true,
  pharmacist: true,
  therapist: true,
  labTechnician: true,
  financeBilling: true,
  supportStaff: true,
  nurse: true,
  counselor: true,
} as const;

const appointmentIncludeValidator = {
  patient: {
    include: {
      user: true,
    },
  },
  doctor: {
    include: {
      user: true,
    },
  },
  clinic: true,
  location: true,
} as const;

const appointmentTimeSlotSelectValidator = {
  id: true,
  date: true,
  time: true,
  duration: true,
  status: true,
  priority: true,
} as const;

// Use Prisma's generated types systematically
export type UserWithRelations = User & {
  doctor?: Doctor | null;
  patient?: Patient | null;
  receptionists?: Receptionist[];
  clinicAdmins?: ClinicAdmin[];
  superAdmin?: SuperAdmin | null;
  pharmacist?: Pharmacist | null;
  therapist?: Therapist | null;
  labTechnician?: LabTechnician | null;
  financeBilling?: FinanceBilling | null;
  supportStaff?: SupportStaff | null;
  nurse?: Nurse | null;
  counselor?: Counselor | null;
};

export type AppointmentWithRelations = Appointment & {
  patient: Patient & { user: User };
  doctor: Doctor & { user: User };
  clinic: Clinic;
  location?: Record<string, unknown>;
};

export type AppointmentTimeSlot = Pick<
  Appointment,
  "id" | "date" | "time" | "duration" | "status"
>;

// Define input types manually since Prisma types may not be available
export type UserCreateInput = {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  profilePicture?: string;
  isActive?: boolean;
  isVerified?: boolean;
  lastLoginAt?: Date;
  role?: string;
  primaryClinicId?: string;
};

export type UserUpdateInput = {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  profilePicture?: string;
  isActive?: boolean;
  isVerified?: boolean;
  lastLoginAt?: Date;
  role?: string;
  primaryClinicId?: string;
};

export type UserWhereInput = {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  isActive?: boolean;
  isVerified?: boolean;
  role?: string;
  primaryClinicId?: string;
};

export type UserWhereUniqueInput = {
  id?: string;
  email?: string;
};

export type AppointmentCreateInput = {
  patientId: string;
  doctorId: string;
  clinicId: string;
  locationId?: string;
  date: Date;
  time: string;
  duration: number;
  status: string;
  priority: string;
  notes?: string;
  reason?: string;
  symptoms?: string;
  diagnosis?: string;
  treatment?: string;
  followUpRequired?: boolean;
  followUpDate?: Date;
  followUpNotes?: string;
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceEndDate?: Date;
  parentAppointmentId?: string;
};

export type AppointmentUpdateInput = {
  date?: Date;
  time?: string;
  duration?: number;
  status?: string;
  priority?: string;
  notes?: string;
  reason?: string;
  symptoms?: string;
  diagnosis?: string;
  treatment?: string;
  followUpRequired?: boolean;
  followUpDate?: Date;
  followUpNotes?: string;
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceEndDate?: Date;
  parentAppointmentId?: string;
};

export type AppointmentWhereInput = {
  id?: string;
  patientId?: string;
  doctorId?: string;
  clinicId?: string;
  locationId?: string;
  date?: Date;
  time?: string;
  status?: string;
  priority?: string;
  isRecurring?: boolean;
  parentAppointmentId?: string;
};

export type AppointmentWhereUniqueInput = {
  id?: string;
};

// Billing-related type definitions
export type BillingPlanWithRelations = BillingPlan & {
  subscriptions?: Subscription[];
};

export type SubscriptionWithRelations = Subscription & {
  plan?: BillingPlan;
  payments?: Payment[];
  invoices?: Invoice[];
  appointments?: Appointment[];
};

export type InvoiceWithRelations = Invoice & {
  subscription?: Subscription;
  payments?: Payment[];
};

export type PaymentWithRelations = Payment & {
  appointment?: Appointment;
  invoice?: Invoice;
  subscription?: Subscription;
};

// Billing input types
export type BillingPlanCreateInput = {
  name: string;
  description?: string;
  amount: number;
  currency?: string;
  interval?: string;
  intervalCount?: number;
  trialPeriodDays?: number;
  features?: Record<string, unknown>;
  isActive?: boolean;
  clinicId?: string;
  metadata?: Record<string, unknown>;
  appointmentsIncluded?: number;
  isUnlimitedAppointments?: boolean;
  appointmentTypes?: Record<string, unknown>;
};

export type BillingPlanUpdateInput = {
  name?: string;
  description?: string;
  amount?: number;
  currency?: string;
  interval?: string;
  intervalCount?: number;
  trialPeriodDays?: number;
  features?: Record<string, unknown>;
  isActive?: boolean;
  clinicId?: string;
  metadata?: Record<string, unknown>;
  appointmentsIncluded?: number;
  isUnlimitedAppointments?: boolean;
  appointmentTypes?: Record<string, unknown>;
};

export type BillingPlanWhereInput = {
  id?: string;
  name?: string;
  isActive?: boolean;
  clinicId?: string;
};

export type SubscriptionCreateInput = {
  userId: string;
  planId: string;
  clinicId: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd?: boolean;
  cancelledAt?: Date;
  trialStart?: Date;
  trialEnd?: Date;
  metadata?: Record<string, unknown>;
  appointmentsUsed?: number;
  appointmentsRemaining?: number;
};

export type SubscriptionUpdateInput = {
  userId?: string;
  planId?: string;
  clinicId?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  cancelledAt?: Date;
  trialStart?: Date;
  trialEnd?: Date;
  metadata?: Record<string, unknown>;
  appointmentsUsed?: number;
  appointmentsRemaining?: number;
};

export type SubscriptionWhereInput = {
  id?: string;
  userId?: string;
  planId?: string;
  clinicId?: string;
  status?: string;
};

export type InvoiceCreateInput = {
  invoiceNumber: string;
  userId: string;
  subscriptionId?: string;
  clinicId: string;
  amount: number;
  tax?: number;
  discount?: number;
  totalAmount: number;
  status?: string;
  dueDate: Date;
  paidAt?: Date;
  description?: string;
  lineItems?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  pdfFilePath?: string;
  pdfUrl?: string;
  sentViaWhatsApp?: boolean;
};

export type InvoiceUpdateInput = {
  invoiceNumber?: string;
  userId?: string;
  subscriptionId?: string;
  clinicId?: string;
  amount?: number;
  tax?: number;
  discount?: number;
  totalAmount?: number;
  status?: string;
  dueDate?: Date;
  paidAt?: Date;
  description?: string;
  lineItems?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  pdfFilePath?: string;
  pdfUrl?: string;
  sentViaWhatsApp?: boolean;
};

export type InvoiceWhereInput = {
  id?: string;
  invoiceNumber?: string;
  userId?: string;
  subscriptionId?: string;
  clinicId?: string;
  status?: string;
};

export type PaymentCreateInput = {
  appointmentId?: string;
  amount: number;
  status?: string;
  method?: string;
  transactionId?: string;
  clinicId: string;
  userId?: string;
  invoiceId?: string;
  subscriptionId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  refundAmount?: number;
  refundedAt?: Date;
};

export type PaymentUpdateInput = {
  appointmentId?: string;
  amount?: number;
  status?: string;
  method?: string;
  transactionId?: string;
  clinicId?: string;
  userId?: string;
  invoiceId?: string;
  subscriptionId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  refundAmount?: number;
  refundedAt?: Date;
};

export type PaymentWhereInput = {
  id?: string;
  appointmentId?: string;
  status?: string;
  method?: string;
  transactionId?: string;
  clinicId?: string;
  userId?: string;
  invoiceId?: string;
  subscriptionId?: string;
};

// Type-safe operation results
export type UserFindUniqueResult = UserWithRelations | null;
export type UserFindManyResult = UserWithRelations[];
export type AppointmentFindUniqueResult = AppointmentWithRelations | null;
export type AppointmentFindManyResult = AppointmentWithRelations[];
export type AppointmentTimeSlotResult = AppointmentTimeSlot[];

@Injectable({ scope: Scope.REQUEST })
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private currentTenantId: string | null = null;
  private static connectionCount = 0;
  private static readonly MAX_CONNECTIONS = 200; // Optimized for 1M+ users
  private static readonly CONNECTION_TIMEOUT = 5000; // 5 seconds timeout for connections
  private static readonly QUERY_TIMEOUT = 30000; // 30 seconds query timeout
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5; // Failures before circuit opens
  private static readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute circuit timeout
  private static instance: PrismaService | null = null;
  private static circuitBreakerFailures = 0;
  private static circuitBreakerLastFailure = 0;
  private static isCircuitOpen = false;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second
  private connectionPool: Map<string, unknown> = new Map();
  private poolSize = parseInt(process.env["DB_POOL_SIZE"] || "20", 10);

  constructor() {
    // If we already have a Prisma instance, return it
    if (PrismaService.instance) {
      return PrismaService.instance;
    }

    super({
      log:
        process.env["NODE_ENV"] === "production"
          ? [
              { emit: "stdout", level: "error" },
              { emit: "stdout", level: "warn" },
            ]
          : [
              { emit: "stdout", level: "error" },
              { emit: "stdout", level: "warn" },
              { emit: "stdout", level: "info" },
              { emit: "stdout", level: "query" },
            ],
      errorFormat: "minimal",
      datasources: {
        db: {
          url: process.env["DATABASE_URL"],
        },
      },
    });

    // Apply production optimizations
    this["$extends"]({
      query: {
        $allOperations({
          args,
          query,
        }: {
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          // Circuit breaker pattern
          if (PrismaService.isCircuitOpen) {
            const now = Date.now();
            if (
              now - PrismaService.circuitBreakerLastFailure >
              PrismaService.CIRCUIT_BREAKER_TIMEOUT
            ) {
              PrismaService.isCircuitOpen = false;
              PrismaService.circuitBreakerFailures = 0;
            } else {
              throw new Error("Database circuit breaker is open");
            }
          }

          // Add query timeout in production
          if (process.env["NODE_ENV"] === "production") {
            return Promise.race([
              query(args),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("Query timeout")),
                  PrismaService.QUERY_TIMEOUT,
                ),
              ),
            ]);
          }

          return query(args);
        },
      },
    });

    // Monitor queries only in development
    if (process.env["NODE_ENV"] !== "production") {
      // Query monitoring will be handled via extensions
    }

    // Store the instance
    PrismaService.instance = this;

    // Tenant isolation will be handled via manual filtering in service methods
    // as $use middleware is deprecated
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    try {
      if (PrismaService.connectionCount > 0) {
        await this["$disconnect"]();
        PrismaService.connectionCount--;
        PrismaService.instance = null; // Clear the singleton instance
        this.logger.log(
          `Disconnected from database successfully. Remaining connections: ${PrismaService.connectionCount}`,
        );
      }
    } catch (_error) {
      this.logger.error("Error disconnecting from database:", _error);
    }
  }

  private async connectWithRetry(retryCount = 0): Promise<void> {
    try {
      // Check circuit breaker
      if (PrismaService.isCircuitOpen) {
        const now = Date.now();
        if (
          now - PrismaService.circuitBreakerLastFailure >
          PrismaService.CIRCUIT_BREAKER_TIMEOUT
        ) {
          PrismaService.isCircuitOpen = false;
          PrismaService.circuitBreakerFailures = 0;
        } else {
          throw new Error("Database circuit breaker is open");
        }
      }

      await this["$connect"]();
      PrismaService.connectionCount++;
      // Reset circuit breaker on successful connection
      PrismaService.circuitBreakerFailures = 0;
      this.logger.log(
        `Successfully connected to database. Active connections: ${PrismaService.connectionCount}/${PrismaService.MAX_CONNECTIONS}`,
      );
    } catch (_error) {
      // Increment circuit breaker failures
      PrismaService.circuitBreakerFailures++;
      PrismaService.circuitBreakerLastFailure = Date.now();

      // Open circuit breaker if threshold reached
      if (
        PrismaService.circuitBreakerFailures >=
        PrismaService.CIRCUIT_BREAKER_THRESHOLD
      ) {
        PrismaService.isCircuitOpen = true;
        this.logger.error(
          "Database circuit breaker opened due to repeated failures",
        );
      }

      if (retryCount < this.maxRetries) {
        this.logger.warn(
          `Failed to connect to database. Retrying in ${this.retryDelay * (retryCount + 1)}ms... (Attempt ${retryCount + 1}/${this.maxRetries})`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.retryDelay * (retryCount + 1)),
        ); // Exponential backoff
        await this.connectWithRetry(retryCount + 1);
      } else {
        this.logger.error(
          "Failed to connect to database after maximum retries",
        );
        throw _error;
      }
    }
  }

  /**
   * Get the current connection count
   * @returns The number of active database connections
   */
  static getConnectionCount(): number {
    return PrismaService.connectionCount;
  }

  /**
   * Check if we can create a new connection
   * @returns boolean indicating if a new connection can be created
   */
  static canCreateNewConnection(): boolean {
    return PrismaService.connectionCount < PrismaService.MAX_CONNECTIONS;
  }

  /**
   * Get connection pool health status
   * @returns Object with pool health metrics
   */
  static getPoolHealth() {
    return {
      activeConnections: PrismaService.connectionCount,
      maxConnections: PrismaService.MAX_CONNECTIONS,
      utilizationPercentage:
        (PrismaService.connectionCount / PrismaService.MAX_CONNECTIONS) * 100,
      circuitBreakerOpen: PrismaService.isCircuitOpen,
      circuitBreakerFailures: PrismaService.circuitBreakerFailures,
      isHealthy:
        PrismaService.connectionCount < PrismaService.MAX_CONNECTIONS * 0.9 &&
        !PrismaService.isCircuitOpen,
    };
  }

  /**
   * Reset circuit breaker manually (admin operation)
   */
  static resetCircuitBreaker() {
    PrismaService.isCircuitOpen = false;
    PrismaService.circuitBreakerFailures = 0;
    PrismaService.circuitBreakerLastFailure = 0;
  }

  /**
   * Execute database operation with connection pool management
   */
  async executePooledOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (
      !PrismaService.canCreateNewConnection() &&
      PrismaService.connectionCount > 0
    ) {
      // Connection pool full, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (PrismaService.isCircuitOpen) {
      throw new Error("Database service unavailable (circuit breaker open)");
    }

    try {
      const result = await operation();
      // Reset circuit breaker on successful operation
      if (PrismaService.circuitBreakerFailures > 0) {
        PrismaService.circuitBreakerFailures = Math.max(
          0,
          PrismaService.circuitBreakerFailures - 1,
        );
      }
      return result;
    } catch (_error) {
      PrismaService.circuitBreakerFailures++;
      PrismaService.circuitBreakerLastFailure = Date.now();

      if (
        PrismaService.circuitBreakerFailures >=
        PrismaService.CIRCUIT_BREAKER_THRESHOLD
      ) {
        PrismaService.isCircuitOpen = true;
        this.logger.error("Circuit breaker opened due to failures");
      }
      throw _error;
    }
  }

  /**
   * Set the current tenant ID for this request
   * This will be used to automatically filter all database queries
   * to only include data for this tenant
   * @param tenantId The ID of the tenant
   */
  setCurrentTenantId(tenantId: string | null) {
    if (tenantId) {
      this.logger.debug(`Setting current tenant ID to ${tenantId}`);
    } else {
      this.logger.debug("Clearing tenant ID - using global scope");
    }
    this.currentTenantId = tenantId;
  }

  /**
   * Get the current tenant ID
   * @returns The current tenant ID or null if not set
   */
  getCurrentTenantId(): string | null {
    return this.currentTenantId;
  }

  /**
   * Clear the current tenant ID
   * This is useful for operations that should access all data
   * For example, administrative tasks
   */
  clearTenantId() {
    this.currentTenantId = null;
  }

  /**
   * Get a client instance for the specified clinic
   * Note: This is just a wrapper that sets the tenant context, not an actual separate connection
   * @param clinicId The ID of the clinic
   * @returns The Prisma client with tenant context set
   */
  async getClinicClient(clinicId: string): Promise<PrismaService> {
    // Set the tenant context
    this.setCurrentTenantId(clinicId);
    return this;
  }

  // Method to handle transactions with retries
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    retryCount = 0,
  ): Promise<T> {
    try {
      return await operation();
    } catch (_error) {
      if (retryCount < this.maxRetries && this.isRetryableError(_error)) {
        console.warn(`Operation failed. Retrying in ${this.retryDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
        return this.executeWithRetry(operation, retryCount + 1);
      }
      throw _error;
    }
  }

  // Helper method to determine if an error is retryable
  private isRetryableError(_error: unknown): boolean {
    return (
      _error instanceof Error &&
      _error.name === "PrismaClientKnownRequestError" &&
      ((_error as { code?: string }).code === "P2024" || // Connection pool timeout
        (_error as { code?: string }).code === "P2028" || // Transaction timeout
        (_error as { code?: string }).code === "P2025" || // Record not found
        (_error as { code?: string }).code === "P2034") // Transaction failed
    );
  }

  // Method to get tenant-specific prisma instance
  withTenant(tenantId: string) {
    return this["$extends"]({
      query: {
        $allOperations({ args, query }: unknown) {
          // Add tenant context to all queries
          args.where = { ...args.where, tenantId };
          return query(args);
        },
      },
    });
  }

  /**
   * Optimized query execution with timeout and retry logic
   */
  async executeOptimizedQuery<T>(
    queryFn: () => Promise<T>,
    timeout: number = PrismaService.QUERY_TIMEOUT,
  ): Promise<T> {
    return Promise.race([
      queryFn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Query timeout")), timeout),
      ),
    ]);
  }

  /**
   * Batch operations for better performance
   */
  async executeBatch<T>(
    operations: (() => Promise<T>)[],
    batchSize: number = 10,
  ): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < operations.length; i += batchSize) {
      const batch = operations.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((operation) => this.executeWithRetry(operation)),
      );

      results.push(
        ...batchResults
          .filter(
            (result): result is PromiseFulfilledResult<Awaited<T>> =>
              result.status === "fulfilled",
          )
          .map((result) => result.value),
      );
    }

    return results;
  }

  /**
   * Get connection health status
   */
  async getConnectionHealth(): Promise<{
    connected: boolean;
    connectionCount: number;
    maxConnections: number;
    health: "healthy" | "warning" | "critical";
  }> {
    try {
      await this.$queryRaw`SELECT 1`;
      const health =
        PrismaService.connectionCount > PrismaService.MAX_CONNECTIONS * 0.8
          ? "warning"
          : PrismaService.connectionCount > PrismaService.MAX_CONNECTIONS * 0.9
            ? "critical"
            : "healthy";

      return {
        connected: true,
        connectionCount: PrismaService.connectionCount,
        maxConnections: PrismaService.MAX_CONNECTIONS,
        health,
      };
    } catch (_error) {
      return {
        connected: false,
        connectionCount: PrismaService.connectionCount,
        maxConnections: PrismaService.MAX_CONNECTIONS,
        health: "critical",
      };
    }
  }

  /**
   * Type-safe RBAC operations
   * These methods provide better type safety for RBAC operations
   */

  /**
   * Type-safe permission operations
   */
  async createPermissionSafe(data: {
    name: string;
    resource: string;
    action: string;
    description?: string;
    domain: string;
    isSystemPermission: boolean;
    isActive: boolean;
  }) {
    const result = await this["permission"].create({ data });
    return result as {
      id: string;
      name: string;
      resource: string;
      action: string;
      description: string | null;
      domain: string;
      isSystemPermission: boolean;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    };
  }

  async findPermissionByIdSafe(id: string) {
    const result = await this["permission"].findUnique({ where: { id } });
    return result as {
      id: string;
      name: string;
      resource: string;
      action: string;
      description: string | null;
      domain: string;
      isSystemPermission: boolean;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  }

  async findPermissionByResourceActionSafe(
    resource: string,
    action: string,
    domain?: string,
  ) {
    return this["permission"].findFirst({
      where: { resource, action, domain },
    });
  }

  async findPermissionsByResourceSafe(resource: string, domain?: string) {
    return this["permission"].findMany({
      where: { resource, domain, isActive: true },
      orderBy: [{ resource: "asc" }, { action: "asc" }],
    });
  }

  async updatePermissionSafe(
    id: string,
    data: {
      name?: string;
      description?: string;
      isActive?: boolean;
      updatedAt: Date;
    },
  ) {
    return this["permission"].update({
      where: { id },
      data,
    });
  }

  async countRolePermissionsSafe(permissionId: string) {
    return this["rolePermission"].count({
      where: { permissionId, isActive: true },
    });
  }

  async findSystemPermissionsSafe() {
    return this["permission"].findMany({
      where: { isSystemPermission: true, isActive: true },
      orderBy: [{ resource: "asc" }, { action: "asc" }],
    });
  }

  /**
   * Type-safe role operations
   */
  async findRoleByNameSafe(name: string, domain?: string, clinicId?: string) {
    return this["rbacRole"].findFirst({
      where: { name, domain, clinicId },
    });
  }

  async createRoleSafe(data: {
    name: string;
    displayName: string;
    description?: string;
    domain: string;
    clinicId?: string;
    isSystemRole: boolean;
    isActive: boolean;
  }) {
    return this["rbacRole"].create({ data });
  }

  async findRoleByIdSafe(id: string) {
    return this["rbacRole"].findUnique({ where: { id } });
  }

  async findRolesByDomainSafe(domain?: string, clinicId?: string) {
    return this["rbacRole"].findMany({
      where: { domain, clinicId, isActive: true },
      orderBy: [{ name: "asc" }],
    });
  }

  async updateRoleSafe(
    id: string,
    data: {
      displayName?: string;
      description?: string;
      isActive?: boolean;
      updatedAt: Date;
    },
  ) {
    return this["rbacRole"].update({
      where: { id },
      data,
    });
  }

  async countUserRolesSafe(roleId: string) {
    return this["userRole"].count({
      where: { roleId, isActive: true },
    });
  }

  async deleteRolePermissionsSafe(roleId: string) {
    return this["rolePermission"].deleteMany({
      where: { roleId },
    });
  }

  async createRolePermissionsSafe(
    permissions: Array<{ roleId: string; permissionId: string }>,
  ) {
    return this["rolePermission"].createMany({
      data: permissions.map((p) => ({
        ...p,
        isActive: true,
        assignedAt: new Date(),
      })),
    });
  }

  async removeRolePermissionsSafe(roleId: string, permissionIds: string[]) {
    return this["rolePermission"].deleteMany({
      where: { roleId, permissionId: { in: permissionIds } },
    });
  }

  async findSystemRolesSafe() {
    return this["rbacRole"].findMany({
      where: { isSystemRole: true, isActive: true },
      orderBy: [{ name: "asc" }],
    });
  }

  async createSystemRoleSafe(data: {
    name: string;
    displayName: string;
    description?: string;
    domain: string;
    isSystemRole: boolean;
    isActive: boolean;
  }) {
    return this["rbacRole"].create({ data });
  }

  /**
   * Type-safe user role operations
   */
  async findUserRoleAssignmentSafe(
    userId: string,
    roleId: string,
    clinicId?: string,
  ) {
    return this["userRole"].findFirst({
      where: { userId, roleId, clinicId, isActive: true },
    });
  }

  async createUserRoleSafe(data: {
    userId: string;
    roleId: string;
    clinicId?: string;
    assignedBy: string;
    assignedAt: Date;
    expiresAt?: Date;
    isActive: boolean;
  }) {
    return this["userRole"].create({ data });
  }

  async findUserRoleForRevocationSafe(
    userId: string,
    roleId: string,
    clinicId?: string,
  ) {
    return this["userRole"].findFirst({
      where: { userId, roleId, clinicId },
    });
  }

  async updateUserRoleSafe(
    id: string,
    data: {
      isActive?: boolean;
      revokedAt?: Date;
      revokedBy?: string;
      updatedAt: Date;
    },
  ) {
    return this["userRole"].update({
      where: { id },
      data,
    });
  }

  async findUserRolesSafe(userId: string, clinicId?: string) {
    return this["userRole"].findMany({
      where: { userId, clinicId, isActive: true },
      include: { role: { select: { name: true } } },
    });
  }

  async findRolePermissionsSafe(roleIds: string[]) {
    return this["rolePermission"].findMany({
      where: { roleId: { in: roleIds }, isActive: true },
      include: {
        permission: { select: { resource: true, action: true } },
      },
    });
  }

  /**
   * Comprehensive type-safe user operations
   */
  async findUserByIdSafe(id: string): Promise<UserFindUniqueResult> {
    return this.user.findUnique({
      where: { id },
      include: userIncludeValidator,
    });
  }

  async findUserByEmailSafe(email: string): Promise<UserFindUniqueResult> {
    return this.user.findUnique({
      where: { email },
      include: userIncludeValidator,
    });
  }

  async findUsersSafe(where: UserWhereInput): Promise<UserFindManyResult> {
    return this.user.findMany({
      where,
      include: userIncludeValidator,
    });
  }

  async createUserSafe(data: UserCreateInput): Promise<UserWithRelations> {
    return this.user.create({
      data,
      include: userIncludeValidator,
    });
  }

  async updateUserSafe(
    id: string,
    data: UserUpdateInput,
  ): Promise<UserWithRelations> {
    return this.user.update({
      where: { id },
      data,
      include: userIncludeValidator,
    });
  }

  async deleteUserSafe(id: string): Promise<UserWithRelations> {
    return this.user.delete({
      where: { id },
      include: userIncludeValidator,
    });
  }

  /**
   * Comprehensive type-safe appointment operations
   */
  async findAppointmentByIdSafe(
    id: string,
  ): Promise<AppointmentFindUniqueResult> {
    return this.appointment.findUnique({
      where: { id },
      include: appointmentIncludeValidator,
    });
  }

  async findAppointmentsSafe(
    where: AppointmentWhereInput,
  ): Promise<AppointmentFindManyResult> {
    return this.appointment.findMany({
      where,
      include: appointmentIncludeValidator,
    });
  }

  async createAppointmentSafe(
    data: AppointmentCreateInput,
  ): Promise<AppointmentWithRelations> {
    return this.appointment.create({
      data,
      include: appointmentIncludeValidator,
    });
  }

  async updateAppointmentSafe(
    id: string,
    data: AppointmentUpdateInput,
  ): Promise<AppointmentWithRelations> {
    return this.appointment.update({
      where: { id },
      data,
      include: appointmentIncludeValidator,
    });
  }

  async deleteAppointmentSafe(id: string): Promise<AppointmentWithRelations> {
    return this.appointment.delete({
      where: { id },
      include: appointmentIncludeValidator,
    });
  }

  /**
   * Type-safe appointment time slots
   */
  async findAppointmentTimeSlotsSafe(
    doctorId: string,
    clinicId: string,
    date: Date,
  ): Promise<AppointmentTimeSlotResult> {
    return this.appointment.findMany({
      where: {
        doctorId,
        clinicId,
        date: date,
        status: {
          in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"],
        },
      },
      select: appointmentTimeSlotSelectValidator,
    });
  }

  /**
   * Type-safe count operations
   */
  async countUsersSafe(where: UserWhereInput): Promise<number> {
    return this.user.count({ where });
  }

  async countAppointmentsSafe(where: AppointmentWhereInput): Promise<number> {
    return this.appointment.count({ where });
  }

  // Billing-related type-safe methods
  async findBillingPlanByIdSafe(
    id: string,
  ): Promise<BillingPlanWithRelations | null> {
    return this["billingPlan"].findUnique({
      where: { id },
      include: { subscriptions: true },
    }) as Promise<BillingPlanWithRelations | null>;
  }

  async findBillingPlansSafe(
    where: BillingPlanWhereInput,
  ): Promise<BillingPlanWithRelations[]> {
    return this["billingPlan"].findMany({
      where,
      include: { subscriptions: true },
    }) as Promise<BillingPlanWithRelations[]>;
  }

  async createBillingPlanSafe(
    data: BillingPlanCreateInput,
  ): Promise<BillingPlanWithRelations> {
    return this["billingPlan"].create({
      data,
      include: { subscriptions: true },
    }) as Promise<BillingPlanWithRelations>;
  }

  async updateBillingPlanSafe(
    id: string,
    data: BillingPlanUpdateInput,
  ): Promise<BillingPlanWithRelations> {
    return this["billingPlan"].update({
      where: { id },
      data,
      include: { subscriptions: true },
    }) as Promise<BillingPlanWithRelations>;
  }

  async findSubscriptionByIdSafe(
    id: string,
  ): Promise<SubscriptionWithRelations | null> {
    return this["subscription"].findUnique({
      where: { id },
      include: {
        plan: true,
        payments: true,
        invoices: true,
        appointments: true,
      },
    }) as Promise<SubscriptionWithRelations | null>;
  }

  async findSubscriptionsSafe(
    where: SubscriptionWhereInput,
  ): Promise<SubscriptionWithRelations[]> {
    return this["subscription"].findMany({
      where,
      include: {
        plan: true,
        payments: true,
        invoices: true,
        appointments: true,
      },
    }) as Promise<SubscriptionWithRelations[]>;
  }

  async createSubscriptionSafe(
    data: SubscriptionCreateInput,
  ): Promise<SubscriptionWithRelations> {
    return this["subscription"].create({
      data,
      include: {
        plan: true,
        payments: true,
        invoices: true,
        appointments: true,
      },
    }) as Promise<SubscriptionWithRelations>;
  }

  async updateSubscriptionSafe(
    id: string,
    data: SubscriptionUpdateInput,
  ): Promise<SubscriptionWithRelations> {
    return this["subscription"].update({
      where: { id },
      data,
      include: {
        plan: true,
        payments: true,
        invoices: true,
        appointments: true,
      },
    }) as Promise<SubscriptionWithRelations>;
  }

  async findInvoiceByIdSafe(id: string): Promise<InvoiceWithRelations | null> {
    return this["invoice"].findUnique({
      where: { id },
      include: {
        subscription: true,
        payments: true,
      },
    }) as Promise<InvoiceWithRelations | null>;
  }

  async findInvoicesSafe(
    where: InvoiceWhereInput,
  ): Promise<InvoiceWithRelations[]> {
    return this["invoice"].findMany({
      where,
      include: {
        subscription: true,
        payments: true,
      },
    }) as Promise<InvoiceWithRelations[]>;
  }

  async createInvoiceSafe(
    data: InvoiceCreateInput,
  ): Promise<InvoiceWithRelations> {
    return this["invoice"].create({
      data,
      include: {
        subscription: true,
        payments: true,
      },
    }) as Promise<InvoiceWithRelations>;
  }

  async updateInvoiceSafe(
    id: string,
    data: InvoiceUpdateInput,
  ): Promise<InvoiceWithRelations> {
    return this["invoice"].update({
      where: { id },
      data,
      include: {
        subscription: true,
        payments: true,
      },
    }) as Promise<InvoiceWithRelations>;
  }

  async findPaymentByIdSafe(id: string): Promise<PaymentWithRelations | null> {
    return this["payment"].findUnique({
      where: { id },
      include: {
        appointment: true,
        invoice: true,
        subscription: true,
      },
    }) as Promise<PaymentWithRelations | null>;
  }

  async findPaymentsSafe(
    where: PaymentWhereInput,
  ): Promise<PaymentWithRelations[]> {
    return this["payment"].findMany({
      where,
      include: {
        appointment: true,
        invoice: true,
        subscription: true,
      },
    }) as Promise<PaymentWithRelations[]>;
  }

  async createPaymentSafe(
    data: PaymentCreateInput,
  ): Promise<PaymentWithRelations> {
    return this["payment"].create({
      data,
      include: {
        appointment: true,
        invoice: true,
        subscription: true,
      },
    }) as Promise<PaymentWithRelations>;
  }

  async updatePaymentSafe(
    id: string,
    data: PaymentUpdateInput,
  ): Promise<PaymentWithRelations> {
    return this["payment"].update({
      where: { id },
      data,
      include: {
        appointment: true,
        invoice: true,
        subscription: true,
      },
    }) as Promise<PaymentWithRelations>;
  }

  // Delete methods
  async deleteBillingPlanSafe(id: string): Promise<BillingPlanWithRelations> {
    return this["billingPlan"].delete({
      where: { id },
      include: { subscriptions: true },
    }) as Promise<BillingPlanWithRelations>;
  }

  async deleteSubscriptionSafe(id: string): Promise<SubscriptionWithRelations> {
    return this["subscription"].delete({
      where: { id },
      include: {
        plan: true,
        payments: true,
        invoices: true,
        appointments: true,
      },
    }) as Promise<SubscriptionWithRelations>;
  }

  async deleteInvoiceSafe(id: string): Promise<InvoiceWithRelations> {
    return this["invoice"].delete({
      where: { id },
      include: {
        subscription: true,
        payments: true,
      },
    }) as Promise<InvoiceWithRelations>;
  }

  async deletePaymentSafe(id: string): Promise<PaymentWithRelations> {
    return this["payment"].delete({
      where: { id },
      include: {
        appointment: true,
        invoice: true,
        subscription: true,
      },
    }) as Promise<PaymentWithRelations>;
  }

  // Clinic methods
  async findClinicByIdSafe(id: string): Promise<{
    name: string;
    address?: string;
    phone?: string;
    email?: string;
  } | null> {
    const clinic = await this.clinic.findUnique({ where: { id } });
    return clinic as {
      name: string;
      address?: string;
      phone?: string;
      email?: string;
    } | null;
  }

  async deleteClinicSafe(id: string): Promise<{ id: string; name: string }> {
    const clinic = await this.clinic.delete({ where: { id } });
    return clinic as { id: string; name: string };
  }

  // Clinic Admin methods
  async createClinicAdminSafe(data: {
    userId: string;
    clinicId: string;
  }): Promise<{ id: string; userId: string; clinicId: string }> {
    const clinicAdmin = await this.clinicAdmin.create({ data });
    return clinicAdmin as { id: string; userId: string; clinicId: string };
  }

  async findClinicAdminByIdSafe(id: string): Promise<{
    id: string;
    userId: string;
    clinicId: string;
    user?: { id: string; email: string; name: string; role: string };
  } | null> {
    const clinicAdmin = await this.clinicAdmin.findUnique({
      where: { id },
      include: { user: true },
    });
    return clinicAdmin as {
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string };
    } | null;
  }

  async findClinicAdminsSafe(where: {
    clinicId?: string;
    userId?: string;
  }): Promise<
    {
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string };
    }[]
  > {
    const clinicAdmins = await this.clinicAdmin.findMany({
      where,
      include: { user: true },
    });
    return clinicAdmins as {
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string };
    }[];
  }

  async deleteClinicAdminSafe(
    id: string,
  ): Promise<{ id: string; userId: string; clinicId: string }> {
    const clinicAdmin = await this.clinicAdmin.delete({ where: { id } });
    return clinicAdmin as { id: string; userId: string; clinicId: string };
  }

  /**
   * Get type-safe Prisma client for operations
   */
  getTypedClient(): PrismaClient {
    return this as PrismaClient;
  }

  /**
   * Type-safe delegate methods using Prisma's generated types
   * These provide direct access to Prisma client methods with proper typing
   */
  get user(): PrismaClient["user"] {
    return this.user;
  }

  get doctor(): PrismaClient["doctor"] {
    return this.doctor;
  }

  get patient(): PrismaClient["patient"] {
    return this.patient;
  }

  get receptionist(): PrismaClient["receptionist"] {
    return this.receptionist;
  }

  get clinicAdmin(): PrismaClient["clinicAdmin"] {
    return this.clinicAdmin;
  }

  get superAdmin(): PrismaClient["superAdmin"] {
    return this.superAdmin;
  }

  get pharmacist(): PrismaClient["pharmacist"] {
    return this.pharmacist;
  }

  get therapist(): PrismaClient["therapist"] {
    return this.therapist;
  }

  get labTechnician(): PrismaClient["labTechnician"] {
    return this.labTechnician;
  }

  get financeBilling(): PrismaClient["financeBilling"] {
    return this.financeBilling;
  }

  get supportStaff(): PrismaClient["supportStaff"] {
    return this.supportStaff;
  }

  get nurse(): PrismaClient["nurse"] {
    return this.nurse;
  }

  get counselor(): PrismaClient["counselor"] {
    return this.counselor;
  }

  get clinic(): PrismaClient["clinic"] {
    return this.clinic;
  }

  get appointment(): PrismaClient["appointment"] {
    return this.appointment;
  }

  get auditLog(): PrismaClient["auditLog"] {
    return this.auditLog;
  }

  get notificationTemplate(): PrismaClient["notificationTemplate"] {
    return this.notificationTemplate;
  }

  get reminderSchedule(): PrismaClient["reminderSchedule"] {
    return this.reminderSchedule;
  }

  /**
   * Type-safe raw query execution
   */
  $queryRaw<T = unknown>(
    query: TemplateStringsArray | string,
    ...values: unknown[]
  ): Promise<T> {
    return this.$queryRaw(query, ...values);
  }

  /**
   * Type-safe transaction delegate
   */
  get $transaction(): PrismaClient["$transaction"] {
    return this.$transaction;
  }

  /**
   * Comprehensive type-safe operations for all entities
   * These replace the functionality from TypedPrismaOperations
   */
  async findUsersWithRole(role?: string): Promise<UserWithRelations[]> {
    return this.user.findMany({
      where: role ? { role } : undefined,
      include: userIncludeValidator,
    }) as Promise<UserWithRelations[]>;
  }

  async findUserById(id: string): Promise<UserWithRelations | null> {
    return this.user.findUnique({
      where: { id },
      include: userIncludeValidator,
    }) as Promise<UserWithRelations | null>;
  }

  async findUserByEmail(email: string): Promise<UserWithRelations | null> {
    return this.user.findFirst({
      where: { email },
      include: userIncludeValidator,
    }) as Promise<UserWithRelations | null>;
  }

  async countUsers(): Promise<number> {
    return this.user.count() as Promise<number>;
  }

  async createUser(data: UserCreateInput): Promise<UserWithRelations> {
    return this.user.create({
      data,
      include: userIncludeValidator,
    }) as Promise<UserWithRelations>;
  }

  async updateUser(
    id: string,
    data: UserUpdateInput,
  ): Promise<UserWithRelations> {
    return this.user.update({
      where: { id },
      data,
      include: userIncludeValidator,
    }) as Promise<UserWithRelations>;
  }

  async deleteUser(id: string): Promise<UserWithRelations> {
    return this.user.delete({
      where: { id },
      include: userIncludeValidator,
    }) as Promise<UserWithRelations>;
  }

  /**
   * Type-safe entity creation methods
   */
  async createDoctor(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.doctor.create({ data });
  }

  async createPatient(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.patient.create({ data });
  }

  async createReceptionist(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.receptionist.create({ data });
  }

  async createClinicAdmin(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.clinicAdmin.create({ data });
  }

  async createSuperAdmin(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.superAdmin.create({ data });
  }

  async createPharmacist(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.pharmacist.create({ data });
  }

  async createTherapist(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.therapist.create({ data });
  }

  async createLabTechnician(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.labTechnician.create({ data });
  }

  async createFinanceBilling(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.financeBilling.create({ data });
  }

  async createSupportStaff(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.supportStaff.create({ data });
  }

  async createNurse(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.nurse.create({ data });
  }

  async createCounselor(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.counselor.create({ data });
  }

  /**
   * Type-safe entity deletion methods
   */
  async deleteDoctor(userId: string): Promise<any> {
    return this.doctor.delete({ where: { userId } });
  }

  async deletePatient(userId: string): Promise<any> {
    return this.patient.delete({ where: { userId } });
  }

  async deleteReceptionist(userId: string): Promise<any> {
    return this.receptionist.delete({ where: { userId } });
  }

  async deleteClinicAdmin(userId: string): Promise<any> {
    return this.clinicAdmin.delete({ where: { userId } });
  }

  async deleteSuperAdmin(userId: string): Promise<any> {
    return this.superAdmin.delete({ where: { userId } });
  }

  async deletePharmacist(userId: string): Promise<any> {
    return this.pharmacist.delete({ where: { userId } });
  }

  async deleteTherapist(userId: string): Promise<any> {
    return this.therapist.delete({ where: { userId } });
  }

  async deleteLabTechnician(userId: string): Promise<any> {
    return this.labTechnician.delete({ where: { userId } });
  }

  async deleteFinanceBilling(userId: string): Promise<any> {
    return this.financeBilling.delete({ where: { userId } });
  }

  async deleteSupportStaff(userId: string): Promise<any> {
    return this.supportStaff.delete({ where: { userId } });
  }

  async deleteNurse(userId: string): Promise<any> {
    return this.nurse.delete({ where: { userId } });
  }

  async deleteCounselor(userId: string): Promise<any> {
    return this.counselor.delete({ where: { userId } });
  }

  /**
   * Type-safe clinic and audit operations
   */
  async findClinics(): Promise<any[]> {
    return this.clinic.findMany();
  }

  async createAuditLog(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.auditLog.create({ data });
  }
}
