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
    return await this.executeRead<AppointmentWithRelations | null>(
      async prisma => {
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
      },
      this.queryOptionsBuilder
        .where({ id })
        .include({
          patient: { include: { user: true } },
          doctor: { include: { user: true } },
          clinic: true,
        })
        .useCache(true)
        .cacheStrategy('short')
        .priority('normal')
        .hipaaCompliant(true)
        .rowLevelSecurity(true)
        .build()
    );
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
    return await this.executeRead<AppointmentWithRelations[]>(
      async prisma => {
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
      },
      this.queryOptionsBuilder
        .where(where)
        .include({
          patient: { include: { user: true } },
          doctor: { include: { user: true } },
          clinic: true,
          location: true,
        })
        .useCache(true)
        .cacheStrategy('short')
        .priority('normal')
        .hipaaCompliant(true)
        .rowLevelSecurity(true)
        .build()
    );
  }

  /**
   * Count appointments with filtering
   */
  async countAppointmentsSafe(where: AppointmentWhereInput): Promise<number> {
    return await this.executeRead<number>(async prisma => {
      return await prisma.appointment.count({ where });
    }, this.queryOptionsBuilder.where(where).useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).rowLevelSecurity(true).build());
  }

  /**
   * Create appointment
   */
  async createAppointmentSafe(data: AppointmentCreateInput): Promise<AppointmentWithRelations> {
    // Prisma requires nested relation inputs for required relations (e.g. `clinic`),
    // while our centralized `AppointmentCreateInput` carries scalar foreign keys.
    // Normalize to Prisma's expected shape here.
    const dataRecord = data as unknown as Record<string, unknown>;
    const clinicId = typeof dataRecord['clinicId'] === 'string' ? dataRecord['clinicId'] : '';
    const locationId =
      typeof dataRecord['locationId'] === 'string' ? dataRecord['locationId'] : undefined;
    const doctorId = typeof dataRecord['doctorId'] === 'string' ? dataRecord['doctorId'] : '';
    const patientId = typeof dataRecord['patientId'] === 'string' ? dataRecord['patientId'] : '';
    const userId = typeof dataRecord['userId'] === 'string' ? dataRecord['userId'] : '';

    const prismaCreateData: Record<string, unknown> = { ...dataRecord };
    // Replace scalar FK fields with nested connects for Prisma create()
    delete prismaCreateData['clinicId'];
    delete prismaCreateData['locationId'];
    delete prismaCreateData['doctorId'];
    delete prismaCreateData['patientId'];
    delete prismaCreateData['userId'];
    if (clinicId) {
      prismaCreateData['clinic'] = { connect: { id: clinicId } };
    }
    if (locationId) {
      prismaCreateData['location'] = { connect: { id: locationId } };
    }
    if (doctorId) {
      prismaCreateData['doctor'] = { connect: { id: doctorId } };
    }
    if (patientId) {
      prismaCreateData['patient'] = { connect: { id: patientId } };
    }
    if (userId) {
      prismaCreateData['user'] = { connect: { id: userId } };
    }

    const result = await this.executeWrite<AppointmentWithRelations>(
      async prisma => {
        return await prisma.appointment.create({
          data: prismaCreateData as unknown as Parameters<
            typeof prisma.appointment.create
          >[0]['data'],
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
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId,
        operation: 'CREATE_APPOINTMENT',
        resourceType: 'APPOINTMENT',
        resourceId: 'pending',
        timestamp: new Date(),
      },
      this.queryOptionsBuilder
        .where({ clinicId })
        .include({
          patient: { include: { user: true } },
          doctor: { include: { user: true } },
          clinic: true,
          location: true,
        })
        .clinicId(clinicId)
        .useCache(false)
        .priority('high')
        .hipaaCompliant(true)
        .rowLevelSecurity(true)
        .retries(2)
        .build()
    );

    if (result?.id) {
      await this.invalidateCache([
        this.queryKeyFactory.appointment(result.id),
        'appointments',
        ...(clinicId ? [this.queryKeyFactory.clinic(clinicId, 'appointments')] : []),
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
      },
      this.queryOptionsBuilder
        .where({ id })
        .include({
          patient: { include: { user: true } },
          doctor: { include: { user: true } },
          clinic: true,
        })
        .clinicId((data as { clinicId?: string }).clinicId || '')
        .useCache(false)
        .priority('normal')
        .hipaaCompliant(true)
        .rowLevelSecurity(true)
        .retries(2)
        .build()
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
    return await this.executeRead<AppointmentTimeSlot[]>(
      _prisma => {
        // This is a placeholder - actual implementation would query available time slots
        // For now, return empty array
        return Promise.resolve([]);
      },
      this.queryOptionsBuilder
        .where({ doctorId: _doctorId, clinicId: _clinicId })
        .clinicId(_clinicId)
        .useCache(true)
        .cacheStrategy('short')
        .priority('normal')
        .hipaaCompliant(true)
        .rowLevelSecurity(true)
        .build()
    );
  }
}
