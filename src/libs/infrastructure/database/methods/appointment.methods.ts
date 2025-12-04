/**
 * Appointment-related database methods
 * Code splitting: Appointment convenience methods extracted from database.service.ts
 */

import { DatabaseMethodsBase } from './database-methods.base';
import type { AppointmentWithRelations, AppointmentTimeSlot } from '@core/types/database.types';
import type {
  AppointmentCreateInput,
  AppointmentUpdateInput,
  AppointmentWhereInput,
} from '@core/types/input.types';

/**
 * Appointment methods implementation
 * All methods use executeRead/Write for full optimization layers
 */
export class AppointmentMethods extends DatabaseMethodsBase {
  /**
   * Find appointment by ID
   */
  async findAppointmentByIdSafe(id: string): Promise<AppointmentWithRelations | null> {
    return await this.executeRead<AppointmentWithRelations | null>(async prisma => {
      return await prisma.appointment.findUnique({
        where: { id },
        include: {
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
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Find appointments with filtering and pagination
   * Optimized for 10M+ users: Uses indexes, pagination, and efficient queries
   */
  async findAppointmentsSafe(
    where: AppointmentWhereInput,
    options?: {
      skip?: number;
      take?: number;
      orderBy?: { date?: 'asc' | 'desc' } | { createdAt?: 'asc' | 'desc' };
    }
  ): Promise<AppointmentWithRelations[]> {
    return await this.executeRead<AppointmentWithRelations[]>(async prisma => {
      return await prisma.appointment.findMany({
        where,
        ...(options?.skip !== undefined && { skip: options.skip }),
        ...(options?.take !== undefined && { take: options.take }),
        ...(options?.orderBy && { orderBy: options.orderBy }),
        include: {
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
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Count appointments with filtering
   */
  async countAppointmentsSafe(where: AppointmentWhereInput): Promise<number> {
    return await this.executeRead<number>(async prisma => {
      return await prisma.appointment.count({ where });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Create appointment
   */
  async createAppointmentSafe(data: AppointmentCreateInput): Promise<AppointmentWithRelations> {
    const result = await this.executeWrite<AppointmentWithRelations>(
      async prisma => {
        return await prisma.appointment.create({
          data,
          include: {
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
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: data.clinicId || '',
        operation: 'CREATE_APPOINTMENT',
        resourceType: 'APPOINTMENT',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    if (result?.id) {
      await this.invalidateCache([
        this.queryKeyFactory.appointment(result.id),
        'appointments',
        ...(data.clinicId ? [this.queryKeyFactory.clinic(data.clinicId, 'appointments')] : []),
      ]);
    }

    return result;
  }

  /**
   * Update appointment
   */
  async updateAppointmentSafe(
    id: string,
    data: AppointmentUpdateInput
  ): Promise<AppointmentWithRelations> {
    const result = await this.executeWrite<AppointmentWithRelations>(
      async prisma => {
        return await prisma.appointment.update({
          where: { id },
          data,
          include: {
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
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: (data as { clinicId?: string }).clinicId || '',
        operation: 'UPDATE_APPOINTMENT',
        resourceType: 'APPOINTMENT',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    const clinicId = (data as { clinicId?: string }).clinicId;
    await this.invalidateCache([
      this.queryKeyFactory.appointment(id),
      'appointments',
      ...(clinicId ? [this.queryKeyFactory.clinic(clinicId, 'appointments')] : []),
    ]);

    return result;
  }

  /**
   * Find appointment time slots
   */
  async findAppointmentTimeSlotsSafe(
    _doctorId: string,
    _clinicId: string,
    _date: Date
  ): Promise<AppointmentTimeSlot[]> {
    return await this.executeRead<AppointmentTimeSlot[]>(_prisma => {
      // This is a placeholder - actual implementation would query available time slots
      // For now, return empty array
      return Promise.resolve([]);
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }
}
