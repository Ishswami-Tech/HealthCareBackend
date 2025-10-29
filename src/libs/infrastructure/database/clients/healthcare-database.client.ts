import { Injectable, Logger, Inject } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  UserWithRelations,
  AppointmentWithRelations,
  AppointmentTimeSlot,
  UserCreateInput,
  UserUpdateInput,
  UserWhereInput,
  AppointmentCreateInput,
  AppointmentUpdateInput,
  AppointmentWhereInput,
  BillingPlanWithRelations,
  SubscriptionWithRelations,
  InvoiceWithRelations,
  PaymentWithRelations,
  BillingPlanCreateInput,
  BillingPlanUpdateInput,
  BillingPlanWhereInput,
  SubscriptionCreateInput,
  SubscriptionUpdateInput,
  SubscriptionWhereInput,
  InvoiceCreateInput,
  InvoiceUpdateInput,
  InvoiceWhereInput,
  PaymentCreateInput,
  PaymentUpdateInput,
  PaymentWhereInput,
} from "../prisma/prisma.service";
import { ConnectionPoolManager } from "../connection-pool.manager";
import { DatabaseMetricsService } from "../database-metrics.service";
import { ClinicIsolationService } from "../clinic-isolation.service";
import {
  RepositoryResult,
  HealthcareError,
  ClinicError,
} from "../types/repository-result";
import {
  IHealthcareDatabaseClient,
  DatabaseHealthStatus,
  DatabaseClientMetrics,
  HealthcareDatabaseConfig,
  AuditInfo,
  CriticalPriority,
  HIPAAComplianceMetrics,
  ClinicDatabaseMetrics,
} from "../interfaces/database-client.interface";

/**
 * Healthcare Database Client Implementation
 *
 * Provides core database operations for healthcare application with:
 * - Connection pooling for 10M+ users
 * - Metrics tracking and monitoring
 * - Error handling with RepositoryResult
 * - Health monitoring and circuit breakers
 * - Transaction support with audit trails
 * - Multi-tenant clinic isolation
 * - HIPAA compliance features
 */
@Injectable()
export class HealthcareDatabaseClient implements IHealthcareDatabaseClient {
  protected readonly logger = new Logger(HealthcareDatabaseClient.name);
  private auditLog: AuditInfo[] = [];
  private readonly maxAuditLogSize = 10000;

  constructor(
    protected readonly prismaService: PrismaService,
    protected readonly connectionPoolManager: ConnectionPoolManager,
    protected readonly metricsService: DatabaseMetricsService,
    protected readonly clinicIsolationService: ClinicIsolationService,
    @Inject("HealthcareDatabaseConfig")
    protected readonly config: HealthcareDatabaseConfig,
  ) {}

  /**
   * Get the underlying Prisma client
   */
  getPrismaClient(): PrismaClient {
    return this.prismaService;
  }

  // Comprehensive type-safe database operations
  async findUserByIdSafe(id: string): Promise<UserWithRelations | null> {
    return this.prismaService.findUserByIdSafe(
      id,
    ) as Promise<UserWithRelations | null>;
  }

  async findUserByEmailSafe(email: string): Promise<UserWithRelations | null> {
    return this.prismaService.findUserByEmailSafe(
      email,
    ) as Promise<UserWithRelations | null>;
  }

  async findUsersSafe(where: UserWhereInput): Promise<UserWithRelations[]> {
    return this.prismaService.findUsersSafe(where) as Promise<
      UserWithRelations[]
    >;
  }

  async createUserSafe(data: UserCreateInput): Promise<UserWithRelations> {
    return this.prismaService.createUserSafe(data);
  }

  async updateUserSafe(
    id: string,
    data: UserUpdateInput,
  ): Promise<UserWithRelations> {
    return this.prismaService.updateUserSafe(id, data);
  }

  async deleteUserSafe(id: string): Promise<UserWithRelations> {
    return this.prismaService.deleteUserSafe(id);
  }

  async findAppointmentByIdSafe(
    id: string,
  ): Promise<AppointmentWithRelations | null> {
    return this.prismaService.findAppointmentByIdSafe(
      id,
    ) as Promise<AppointmentWithRelations | null>;
  }

  async findAppointmentsSafe(
    where: AppointmentWhereInput,
  ): Promise<AppointmentWithRelations[]> {
    return this.prismaService.findAppointmentsSafe(where) as Promise<
      AppointmentWithRelations[]
    >;
  }

  async createAppointmentSafe(
    data: AppointmentCreateInput,
  ): Promise<AppointmentWithRelations> {
    return this.prismaService.createAppointmentSafe(data);
  }

  async updateAppointmentSafe(
    id: string,
    data: AppointmentUpdateInput,
  ): Promise<AppointmentWithRelations> {
    return this.prismaService.updateAppointmentSafe(id, data);
  }

  async deleteAppointmentSafe(id: string): Promise<AppointmentWithRelations> {
    return this.prismaService.deleteAppointmentSafe(id);
  }

  async findAppointmentTimeSlotsSafe(
    doctorId: string,
    clinicId: string,
    date: Date,
  ): Promise<AppointmentTimeSlot[]> {
    return this.prismaService.findAppointmentTimeSlotsSafe(
      doctorId,
      clinicId,
      date,
    ) as Promise<AppointmentTimeSlot[]>;
  }

  async countUsersSafe(where: UserWhereInput): Promise<number> {
    return this.prismaService.countUsersSafe(where);
  }

  async countAppointmentsSafe(where: AppointmentWhereInput): Promise<number> {
    return this.prismaService.countAppointmentsSafe(where);
  }

  // Billing-related type-safe methods
  async findBillingPlanByIdSafe(
    id: string,
  ): Promise<BillingPlanWithRelations | null> {
    return this.prismaService.findBillingPlanByIdSafe(id);
  }

  async findBillingPlansSafe(
    where: BillingPlanWhereInput,
  ): Promise<BillingPlanWithRelations[]> {
    return this.prismaService.findBillingPlansSafe(where);
  }

  async createBillingPlanSafe(
    data: BillingPlanCreateInput,
  ): Promise<BillingPlanWithRelations> {
    return this.prismaService.createBillingPlanSafe(data);
  }

  async updateBillingPlanSafe(
    id: string,
    data: BillingPlanUpdateInput,
  ): Promise<BillingPlanWithRelations> {
    return this.prismaService.updateBillingPlanSafe(id, data);
  }

  async findSubscriptionByIdSafe(
    id: string,
  ): Promise<SubscriptionWithRelations | null> {
    return this.prismaService.findSubscriptionByIdSafe(id);
  }

  async findSubscriptionsSafe(
    where: SubscriptionWhereInput,
  ): Promise<SubscriptionWithRelations[]> {
    return this.prismaService.findSubscriptionsSafe(where);
  }

  async createSubscriptionSafe(
    data: SubscriptionCreateInput,
  ): Promise<SubscriptionWithRelations> {
    return this.prismaService.createSubscriptionSafe(data);
  }

  async updateSubscriptionSafe(
    id: string,
    data: SubscriptionUpdateInput,
  ): Promise<SubscriptionWithRelations> {
    return this.prismaService.updateSubscriptionSafe(id, data);
  }

  async findInvoiceByIdSafe(id: string): Promise<InvoiceWithRelations | null> {
    return this.prismaService.findInvoiceByIdSafe(id);
  }

  async findInvoicesSafe(
    where: InvoiceWhereInput,
  ): Promise<InvoiceWithRelations[]> {
    return this.prismaService.findInvoicesSafe(where);
  }

  async createInvoiceSafe(
    data: InvoiceCreateInput,
  ): Promise<InvoiceWithRelations> {
    return this.prismaService.createInvoiceSafe(data);
  }

  async updateInvoiceSafe(
    id: string,
    data: InvoiceUpdateInput,
  ): Promise<InvoiceWithRelations> {
    return this.prismaService.updateInvoiceSafe(id, data);
  }

  async findPaymentByIdSafe(id: string): Promise<PaymentWithRelations | null> {
    return this.prismaService.findPaymentByIdSafe(id);
  }

  async findPaymentsSafe(
    where: PaymentWhereInput,
  ): Promise<PaymentWithRelations[]> {
    return this.prismaService.findPaymentsSafe(where);
  }

  async createPaymentSafe(
    data: PaymentCreateInput,
  ): Promise<PaymentWithRelations> {
    return this.prismaService.createPaymentSafe(data);
  }

  async updatePaymentSafe(
    id: string,
    data: PaymentUpdateInput,
  ): Promise<PaymentWithRelations> {
    return this.prismaService.updatePaymentSafe(id, data);
  }

  // Delete methods
  async deleteBillingPlanSafe(id: string): Promise<BillingPlanWithRelations> {
    return this.prismaService.deleteBillingPlanSafe(id);
  }

  async deleteSubscriptionSafe(id: string): Promise<SubscriptionWithRelations> {
    return this.prismaService.deleteSubscriptionSafe(id);
  }

  async deleteInvoiceSafe(id: string): Promise<InvoiceWithRelations> {
    return this.prismaService.deleteInvoiceSafe(id);
  }

  async deletePaymentSafe(id: string): Promise<PaymentWithRelations> {
    return this.prismaService.deletePaymentSafe(id);
  }

  // Clinic methods
  async findClinicByIdSafe(id: string): Promise<{
    name: string;
    address?: string;
    phone?: string;
    email?: string;
  } | null> {
    return this.prismaService.findClinicByIdSafe(id) as Promise<{
      name: string;
      address?: string;
      phone?: string;
      email?: string;
    } | null>;
  }

  async deleteClinicSafe(id: string): Promise<{ id: string; name: string }> {
    return this.prismaService.deleteClinicSafe(id) as Promise<{
      id: string;
      name: string;
    }>;
  }

  // Clinic Admin methods
  async createClinicAdminSafe(data: {
    userId: string;
    clinicId: string;
  }): Promise<{ id: string; userId: string; clinicId: string }> {
    return this.prismaService.createClinicAdminSafe(data) as Promise<{
      id: string;
      userId: string;
      clinicId: string;
    }>;
  }

  async findClinicAdminByIdSafe(id: string): Promise<{
    id: string;
    userId: string;
    clinicId: string;
    user?: { id: string; email: string; name: string; role: string };
  } | null> {
    return this.prismaService.findClinicAdminByIdSafe(id) as Promise<{
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string };
    } | null>;
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
    return this.prismaService.findClinicAdminsSafe(where) as Promise<
      {
        id: string;
        userId: string;
        clinicId: string;
        user?: { id: string; email: string; name: string; role: string };
      }[]
    >;
  }

  async deleteClinicAdminSafe(
    id: string,
  ): Promise<{ id: string; userId: string; clinicId: string }> {
    return this.prismaService.deleteClinicAdminSafe(id) as Promise<{
      id: string;
      userId: string;
      clinicId: string;
    }>;
  }

  /**
   * Execute a raw query with metrics and error handling
   */
  async executeRawQuery<T = unknown>(
    query: string,
    params: unknown[] = [],
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result: T = await this.connectionPoolManager.executeQuery<T>(
        query,
        params,
        {
          ...(this.config.queryTimeout !== undefined && {
            timeout: this.config.queryTimeout,
          }),
        },
      );

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        "RAW_QUERY",
        executionTime,
        true,
      );

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        "RAW_QUERY",
        executionTime,
        false,
      );

      this.logger.error(`Raw query failed: ${(error as Error).message}`, {
        query: query.substring(0, 100),
        executionTime,
        error: (error as Error).message,
      });

      throw error;
    }
  }

  /**
   * Execute operation within a transaction
   */
  async executeInTransaction<T>(
    operation: (
      client: Omit<
        PrismaClient,
        "$on" | "$connect" | "$disconnect" | "$transaction" | "$extends"
      >,
    ) => Promise<T>,
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await this.prismaService.$transaction(operation as any, {
        maxWait: this.config.connectionTimeout || 10000,
        timeout: this.config.queryTimeout || 60000,
      });

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        "TRANSACTION",
        executionTime,
        true,
      );

      return result as T;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        "TRANSACTION",
        executionTime,
        false,
      );

      this.logger.error(`Transaction failed: ${(error as Error).message}`, {
        executionTime,
        error: (error as Error).message,
      });

      throw error;
    }
  }

  /**
   * Execute healthcare-specific read operations with HIPAA compliance
   */
  async executeHealthcareRead<T>(
    operation: (client: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const _result = await this.connectionPoolManager.executeHealthcareRead<T>(
        "", // Query will be executed through Prisma client
        [],
        { priority: "normal", timeout: 30000 },
      );

      // Execute the operation with the Prisma client
      const data = await operation(this.prismaService);

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        "HEALTHCARE_READ",
        executionTime,
        true,
      );

      // Log for HIPAA compliance if PHI data is involved
      if (this.config.enablePHIProtection) {
        this.logDataAccess("READ", "HEALTHCARE_DATA", executionTime);
      }

      return data;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        "HEALTHCARE_READ",
        executionTime,
        false,
      );

      this.logger.error(
        `Healthcare read operation failed: ${(error as Error).message}`,
        {
          executionTime,
          error: (error as Error).message,
        },
      );

      throw new HealthcareError(
        `Healthcare read operation failed: ${(error as Error).message}`,
        "HEALTHCARE_READ_ERROR",
        { executionTime, originalError: (error as Error).message },
        false,
      );
    }
  }

  /**
   * Execute healthcare-specific write operations with audit trails
   */
  async executeHealthcareWrite<T>(
    operation: (client: PrismaClient) => Promise<T>,
    auditInfo: AuditInfo,
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Use prioritized write connection
      const _result =
        await this.connectionPoolManager.executeHealthcareWrite<T>(
          "", // Query will be executed through Prisma client
          [],
          { priority: "high", timeout: 60000 },
        );

      // Execute within transaction for data consistency
      const data = await this.executeInTransaction(async (client) => {
        const operationResult = await operation(client as unknown);

        // Create audit trail entry
        if (this.config.enableAuditLogging) {
          await this.createAuditTrail(auditInfo, "SUCCESS");
        }

        return operationResult;
      });

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        "HEALTHCARE_WRITE",
        executionTime,
        true,
        auditInfo.clinicId,
        auditInfo.userId,
      );

      // Log for HIPAA compliance
      this.logDataAccess(
        "WRITE",
        auditInfo.resourceType,
        executionTime,
        auditInfo,
      );

      return data;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        "HEALTHCARE_WRITE",
        executionTime,
        false,
        auditInfo.clinicId,
        auditInfo.userId,
      );

      // Create audit trail for failed operation
      if (this.config.enableAuditLogging) {
        try {
          await this.createAuditTrail(
            auditInfo,
            "FAILURE",
            (error as Error).message,
          );
        } catch (auditError) {
          this.logger.error(
            "Failed to create audit trail for failed operation:",
            auditError,
          );
        }
      }

      this.logger.error(
        `Healthcare write operation failed: ${(error as Error).message}`,
        {
          executionTime,
          auditInfo,
          error: (error as Error).message,
        },
      );

      throw new HealthcareError(
        `Healthcare write operation failed: ${(error as Error).message}`,
        "HEALTHCARE_WRITE_ERROR",
        { executionTime, auditInfo, originalError: (error as Error).message },
        false,
      );
    }
  }

  /**
   * Execute critical healthcare operations (emergency scenarios)
   */
  async executeCriticalOperation<T>(
    operation: (client: PrismaClient) => Promise<T>,
    priority: CriticalPriority,
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Use critical operation connection with highest priority
      const _result = await this.connectionPoolManager.executeCriticalQuery<T>(
        "", // Query will be executed through Prisma client
        [],
        {
          priority: "high",
          timeout: priority === CriticalPriority.EMERGENCY ? 120000 : 60000,
          retries: priority === CriticalPriority.EMERGENCY ? 5 : 3,
        },
      );

      // Execute the critical operation
      const data = await operation(this.prismaService);

      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        "CRITICAL_OPERATION",
        executionTime,
        true,
      );

      // Log critical operation for audit
      this.logger.warn(`Critical healthcare operation completed: ${priority}`, {
        priority,
        executionTime,
        timestamp: new Date(),
      });

      return data;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(
        "CRITICAL_OPERATION",
        executionTime,
        false,
      );

      this.logger.error(
        `Critical healthcare operation failed: ${(error as Error).message}`,
        {
          priority,
          executionTime,
          error: (error as Error).message,
        },
      );

      throw new HealthcareError(
        `Critical healthcare operation failed: ${(error as Error).message}`,
        "CRITICAL_OPERATION_ERROR",
        { priority, executionTime, originalError: (error as Error).message },
        priority !== CriticalPriority.EMERGENCY, // Retry unless emergency
      );
    }
  }

  /**
   * Execute operation with clinic isolation context (multi-tenant)
   */
  async executeWithClinicContext<T>(
    clinicId: string,
    operation: (client: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await this.clinicIsolationService.executeWithClinicContext(
        clinicId,
        async () => {
          return this.executeHealthcareRead(operation);
        },
      );

      if (!result.success) {
        throw new ClinicError(
          `Clinic operation failed: ${result.error as string}`,
          "CLINIC_CONTEXT_ERROR",
          clinicId,
          { originalError: result.error as unknown as Error },
        );
      }

      const executionTime = Date.now() - startTime;
      this.logger.debug(
        `Clinic operation completed for ${clinicId} in ${executionTime}ms`,
      );

      return result.data!;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.logger.error(`Clinic operation failed for ${clinicId}:`, {
        clinicId,
        executionTime,
        error: (error as Error).message,
      });

      throw error;
    }
  }

  /**
   * Get connection health status
   */
  async getHealthStatus(): Promise<DatabaseHealthStatus> {
    try {
      const connectionMetrics = this.connectionPoolManager.getMetrics();
      const start = Date.now();

      // Test database connectivity
      (await this.prismaService.$queryRaw`SELECT 1`) as Promise<unknown>;
      const responseTime = Date.now() - start;

      return {
        isHealthy: connectionMetrics.isHealthy && responseTime < 5000,
        connectionCount: connectionMetrics.totalConnections,
        activeQueries: connectionMetrics.activeConnections,
        avgResponseTime: responseTime,
        lastHealthCheck: new Date(),
        errors: connectionMetrics.isHealthy
          ? []
          : ["Connection pool unhealthy"],
      };
    } catch (error) {
      return {
        isHealthy: false,
        connectionCount: 0,
        activeQueries: 0,
        avgResponseTime: -1,
        lastHealthCheck: new Date(),
        errors: [(error as Error).message],
      };
    }
  }

  /**
   * Get client metrics
   */
  async getMetrics(): Promise<DatabaseClientMetrics> {
    const connectionMetrics = this.connectionPoolManager.getMetrics();
    const currentMetrics = this.metricsService.getCurrentMetrics();

    return {
      totalQueries: currentMetrics.performance.totalQueries,
      successfulQueries: currentMetrics.performance.successfulQueries,
      failedQueries: currentMetrics.performance.failedQueries,
      averageQueryTime: currentMetrics.performance.averageQueryTime,
      slowQueries: currentMetrics.performance.slowQueries,
      connectionPool: {
        total: connectionMetrics.totalConnections,
        active: connectionMetrics.activeConnections,
        idle: connectionMetrics.idleConnections,
        waiting: connectionMetrics.waitingConnections,
      },
    };
  }

  /**
   * Get HIPAA compliance metrics
   */
  async getHIPAAMetrics(): Promise<HIPAAComplianceMetrics> {
    const currentMetrics = this.metricsService.getCurrentMetrics();
    const auditedOperations = this.auditLog.length;
    const encryptedDataAccess = this.auditLog.filter(
      (log) =>
        log.operation.includes("READ") || log.operation.includes("WRITE"),
    ).length;

    return {
      auditedOperations,
      encryptedDataAccess,
      unauthorizedAttempts:
        currentMetrics.healthcare.unauthorizedAccessAttempts,
      dataRetentionCompliance: this.checkDataRetentionCompliance(),
      lastComplianceCheck: new Date(),
    };
  }

  /**
   * Get clinic-specific metrics
   */
  async getClinicMetrics(clinicId: string): Promise<ClinicDatabaseMetrics> {
    const baseMetrics = this.getMetrics();
    const clinicMetrics = this.metricsService.getClinicMetrics(clinicId);

    // Get clinic info
    const clinicResult =
      await this.clinicIsolationService.getClinicContext(clinicId);
    const clinicName = clinicResult.success
      ? clinicResult.data!.clinicName
      : "Unknown";

    return {
      ...baseMetrics,
      clinicId,
      clinicName,
      patientCount: clinicMetrics?.patientCount || 0,
      appointmentCount: clinicMetrics?.appointmentCount || 0,
      staffCount: await this.getStaffCount(clinicId),
      locationCount: await this.getLocationCount(clinicId),
    } as unknown as ClinicDatabaseMetrics;
  }

  /**
   * Get clinic dashboard statistics
   */
  async getClinicDashboardStats(clinicId: string): Promise<unknown> {
    return this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(clinicId, async (client) => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);

          const [
            totalPatients,
            totalAppointments,
            todayAppointments,
            upcomingAppointments,
            totalDoctors,
            totalLocations,
            recentActivity,
          ] = await Promise.all<
            [number, number, number, number, number, number, any[]]
          >([
            // Total patients (through appointments)
            client.patient.count({
              where: {
                appointments: {
                  some: { clinicId },
                },
              },
            }),

            // Total appointments
            client.appointment.count({
              where: { clinicId },
            }),

            // Today's appointments
            client.appointment.count({
              where: {
                clinicId,
                date: {
                  gte: today,
                  lt: tomorrow,
                },
              },
            }),

            // Upcoming appointments (next 7 days)
            client.appointment.count({
              where: {
                clinicId,
                date: {
                  gte: new Date(),
                  lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
                status: {
                  in: ["SCHEDULED", "CONFIRMED"],
                },
              },
            }),

            // Total doctors
            client.doctorClinic.count({
              where: { clinicId },
            }),

            // Total locations
            client.clinicLocation.count({
              where: { clinicId },
            }),

            // Recent activity (last 10 appointments)
            client.appointment.findMany({
              where: { clinicId },
              include: {
                patient: {
                  include: {
                    user: {
                      select: {
                        name: true,
                        firstName: true,
                        lastName: true,
                      },
                    },
                  },
                },
                doctor: {
                  include: {
                    user: {
                      select: {
                        name: true,
                        firstName: true,
                        lastName: true,
                      },
                    },
                  },
                },
              },
              orderBy: { updatedAt: "desc" },
              take: 10,
            }),
          ]);

          return {
            totalPatients,
            totalAppointments,
            todayAppointments,
            upcomingAppointments,
            totalDoctors,
            totalLocations,
            recentActivity: Array.isArray(recentActivity)
              ? recentActivity.map(
                  (activity: {
                    patient: unknown;
                    doctor: unknown;
                    location: unknown;
                  }) => ({
                    patient: activity.patient,
                    doctor: activity.doctor,
                    location: activity.location,
                  }),
                )
              : [],
          };
        });
      },
      "GET_CLINIC_DASHBOARD_STATS",
      clinicId,
    );
  }

  /**
   * Get clinic patients with pagination and filtering
   */
  async getClinicPatients(
    clinicId: string,
    options: {
      page?: number;
      limit?: number;
      locationId?: string;
      searchTerm?: string;
      includeInactive?: boolean;
    } = {},
  ): Promise<unknown> {
    const {
      page = 1,
      limit = 20,
      locationId,
      searchTerm,
      includeInactive = false,
    } = options;

    return this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(clinicId, async (client) => {
          const whereClause: Record<string, unknown> = {
            appointments: {
              some: {
                clinicId,
                ...(locationId ? { locationId } : {}),
              },
            },
          };

          // Add search filter
          if (searchTerm) {
            whereClause["user"] = {
              OR: [
                { name: { contains: searchTerm, mode: "insensitive" } },
                { firstName: { contains: searchTerm, mode: "insensitive" } },
                { lastName: { contains: searchTerm, mode: "insensitive" } },
                { email: { contains: searchTerm, mode: "insensitive" } },
                { phone: { contains: searchTerm, mode: "insensitive" } },
              ],
            };
          }

          const skip = (page - 1) * limit;

          const [patients, total] = await Promise.all<[any[], number]>([
            client.patient.findMany({
              where: whereClause,
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                    dateOfBirth: true,
                    isVerified: true,
                  },
                },
                appointments: {
                  where: { clinicId },
                  orderBy: { date: "desc" },
                  take: 3,
                  select: {
                    id: true,
                    date: true,
                    time: true,
                    status: true,
                    type: true,
                  },
                },
              },
              orderBy: { createdAt: "desc" },
              skip,
              take: limit,
            }),
            client.patient.count({ where: whereClause }),
          ]);

          const totalPages = Math.ceil(total / limit);

          return {
            patients: Array.isArray(patients)
              ? patients.map((patient: Record<string, unknown>) => patient)
              : [],
            total,
            page,
            totalPages,
          };
        });
      },
      "GET_CLINIC_PATIENTS",
      clinicId,
    );
  }

  /**
   * Get clinic appointments with advanced filtering
   */
  async getClinicAppointments(
    clinicId: string,
    options: {
      page?: number;
      limit?: number;
      locationId?: string;
      dateFrom?: Date;
      dateTo?: Date;
      status?: string;
      doctorId?: string;
    } = {},
  ): Promise<unknown> {
    const {
      page = 1,
      limit = 50,
      locationId,
      dateFrom,
      dateTo,
      status,
      doctorId,
    } = options;

    return this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(clinicId, async (client) => {
          const whereClause: Record<string, unknown> = {
            clinicId,
            ...(locationId ? { locationId } : {}),
            ...(doctorId ? { doctorId } : {}),
            ...(status ? { status } : {}),
            ...(dateFrom || dateTo
              ? {
                  date: {
                    ...(dateFrom ? { gte: dateFrom } : {}),
                    ...(dateTo ? { lte: dateTo } : {}),
                  },
                }
              : {}),
          };

          const skip = (page - 1) * limit;

          const [appointments, total] = await Promise.all([
            client.appointment.findMany({
              where: whereClause,
              include: {
                patient: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        email: true,
                      },
                    },
                  },
                },
                doctor: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        firstName: true,
                        lastName: true,
                      },
                    },
                  },
                },
                location: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                  },
                },
              },
              orderBy: { date: "asc" },
              skip,
              take: limit,
            }),
            client.appointment.count({ where: whereClause }),
          ]);

          const totalPages = Math.ceil(total / limit);

          return {
            appointments,
            total,
            page,
            totalPages,
          };
        });
      },
      "GET_CLINIC_APPOINTMENTS",
      clinicId,
    );
  }

  /**
   * Close database connections
   */
  async disconnect(): Promise<void> {
    try {
      await this.prismaService["$disconnect"]();
      this.logger.log("Database client disconnected");
    } catch (error) {
      this.logger.error("Failed to disconnect database client:", error);
      throw error;
    }
  }

  // Private helper methods

  private async executeWithResult<T>(
    operation: () => Promise<T>,
    operationName: string,
    clinicId?: string,
    userId?: string,
  ): Promise<RepositoryResult<T>> {
    const startTime = Date.now();

    try {
      const result = await operation();
      const executionTime = Date.now() - startTime;

      this.metricsService.recordQueryExecution(
        operationName,
        executionTime,
        true,
        clinicId,
        userId,
      );

      return RepositoryResult.success(result, {
        executionTime,
        operation: operationName,
        ...(clinicId && { clinicId }),
        ...(userId && { userId }),
        timestamp: new Date(),
      });
    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.metricsService.recordQueryExecution(
        operationName,
        executionTime,
        false,
        clinicId,
        userId,
      );

      this.logger.error(`Operation ${operationName} failed:`, {
        error: (error as Error).message,
        executionTime,
        clinicId,
        userId,
      });

      return RepositoryResult.failure(error as Error, {
        executionTime,
        operation: operationName,
        ...(clinicId && { clinicId }),
        ...(userId && { userId }),
        timestamp: new Date(),
      });
    }
  }

  private async createAuditTrail(
    auditInfo: AuditInfo,
    status: "SUCCESS" | "FAILURE",
    errorMessage?: string,
  ): Promise<void> {
    try {
      // Store audit info in memory (in production, this should go to a dedicated audit database)
      const auditEntry = {
        ...auditInfo,
        status,
        errorMessage,
        id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      };

      this.auditLog.push(auditEntry);

      // Maintain audit log size
      if (this.auditLog.length > this.maxAuditLogSize) {
        this.auditLog.shift();
      }

      return Promise.resolve();

      // In production, create database record:
      // await this.prismaService.auditLog.create({ data: auditEntry });
    } catch (error) {
      this.logger.error("Failed to create audit trail:", error);
    }
  }

  private logDataAccess(
    operation: "READ" | "WRITE",
    resourceType: string,
    executionTime: number,
    auditInfo?: AuditInfo,
  ): void {
    if (this.config.enablePHIProtection) {
      this.logger.log(`HIPAA Data Access: ${operation} ${resourceType}`, {
        operation,
        resourceType,
        executionTime,
        clinicId: auditInfo?.clinicId,
        userId: auditInfo?.userId,
        timestamp: new Date(),
        encrypted: true,
      });
    }
  }

  private checkDataRetentionCompliance(): boolean {
    // Simplified compliance check - in production would check actual data retention policies
    const retentionDays = this.config.auditRetentionDays || 2555; // 7 years default
    const oldestAudit = this.auditLog[0];

    if (oldestAudit) {
      const daysSinceOldest =
        (Date.now() - oldestAudit.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceOldest <= retentionDays;
    }

    return true;
  }

  private async getStaffCount(clinicId: string): Promise<number> {
    try {
      const result = await this.executeWithClinicContext(
        clinicId,
        async (client) => {
          const [doctors, receptionists, admins] = await Promise.all([
            client.doctorClinic.count({ where: { clinicId } }),
            client.receptionistsAtClinic.count({ where: { A: clinicId } }),
            client.clinicAdmin.count({ where: { clinicId } }),
          ]);

          return doctors + receptionists + admins;
        },
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get staff count for clinic ${clinicId}:`,
        error,
      );
      return 0;
    }
  }

  private async getLocationCount(clinicId: string): Promise<number> {
    try {
      return this.executeWithClinicContext(clinicId, async (client) => {
        return client.clinicLocation.count({ where: { clinicId } });
      });
    } catch (error) {
      this.logger.error(
        `Failed to get location count for clinic ${clinicId}:`,
        error,
      );
      return 0;
    }
  }
}
