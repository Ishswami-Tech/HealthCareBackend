/// <reference types="jest" />
/**
 * GET /analytics/dashboard feeds the Super Admin dashboard in one request. A Super Admin sees the
 * whole system: the X-Clinic-ID header only selects a working context, so it must not narrow
 * these totals. Every other role keeps its clinic's stats.
 */

jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('@core/guards/clinic.guard', () => ({ ClinicGuard: class {} }));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class {} }));
jest.mock('@services/appointments/plugins/analytics/appointment-analytics.service', () => ({
  AppointmentAnalyticsService: class {},
}));
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class {} }));

import { AnalyticsController } from '@services/analytics/analytics.controller';
import { AnalyticsService } from '@services/analytics/analytics.service';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

type Args = { where?: Record<string, unknown> };

function buildService() {
  const calls = {
    clinicWhere: [] as Args[],
    userWhere: [] as Args[],
    paymentWhere: [] as Args[],
    expenseWhere: [] as Args[],
    appointmentWhere: [] as Record<string, unknown>[],
    cacheKeys: [] as string[],
    cacheOptions: [] as Record<string, unknown>[],
  };
  const client = {
    clinic: {
      count: jest.fn((args: Args) => (calls.clinicWhere.push(args), Promise.resolve(3))),
      findMany: jest.fn(() =>
        Promise.resolve([
          { id: 'c2', name: 'CR Clinic', isActive: true, createdAt: new Date('2026-11-10') },
        ])
      ),
    },
    user: {
      groupBy: jest.fn((args: Args) => {
        calls.userWhere.push(args);
        return Promise.resolve([
          { role: 'PATIENT', _count: { _all: 40 } },
          { role: 'DOCTOR', _count: { _all: 2 } },
        ]);
      }),
      findMany: jest.fn((args: Args) => {
        calls.userWhere.push(args);
        return Promise.resolve([
          {
            id: 'u1',
            name: ' ',
            firstName: 'Asha',
            lastName: 'Rao',
            isActive: true,
            createdAt: new Date('2026-11-12T10:00:00.000Z'),
            primaryClinic: { name: 'CR Clinic' },
          },
        ]);
      }),
    },
    payment: {
      aggregate: jest.fn((args: Args) => {
        calls.paymentWhere.push(args);
        return Promise.resolve({ _sum: { amount: 1500, refundAmount: 100 } });
      }),
    },
    clinicExpense: {
      aggregate: jest.fn((args: Args) => {
        calls.expenseWhere.push(args);
        return Promise.resolve({ _sum: { amount: 200 } });
      }),
    },
  };
  const databaseService = {
    executeHealthcareRead: (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    countAppointmentsSafe: (where: Record<string, unknown>) => {
      calls.appointmentWhere.push(where);
      return Promise.resolve(12);
    },
  };
  const cacheService = {
    cache: (key: string, fn: () => Promise<unknown>, options: Record<string, unknown>) => {
      calls.cacheKeys.push(key);
      calls.cacheOptions.push(options);
      return fn();
    },
  };
  const service = new AnalyticsService(
    {} as never,
    databaseService as never,
    { log: jest.fn() } as never,
    cacheService as never
  );
  return { service, calls };
}

describe('AnalyticsService.getSystemDashboardStats', () => {
  it('totals every clinic and leaves soft-deleted clinics and users out', async () => {
    const { service, calls } = buildService();
    const stats = await service.getSystemDashboardStats('month');

    expect(stats.system.totalClinics).toBe(3);
    expect(stats.system.totalUsers).toBe(42);
    expect(stats.system.usersByRole).toEqual({ PATIENT: 40, DOCTOR: 2 });
    expect(stats.summary.totalAppointments).toBe(12);
    expect(stats.summary.revenue).toBe(1500);
    expect(stats.summary.netRevenue).toBe(1400);

    for (const args of [...calls.clinicWhere, ...calls.userWhere]) {
      expect(args.where).toEqual({ deletedAt: null });
    }
    // No clinic filter anywhere: the whole system.
    for (const args of [...calls.paymentWhere, ...calls.expenseWhere]) {
      expect(args.where).not.toHaveProperty('clinicId');
    }
    expect(calls.appointmentWhere[0]).not.toHaveProperty('clinicId');
    expect(calls.appointmentWhere[0]).toHaveProperty('date');
  });

  it('lists the newest users with a usable name and ISO dates', async () => {
    const { service } = buildService();
    const stats = await service.getSystemDashboardStats('month');
    expect(stats.system.recentUsers).toEqual([
      {
        id: 'u1',
        name: 'Asha Rao',
        isActive: true,
        createdAt: '2026-11-12T10:00:00.000Z',
        clinicName: 'CR Clinic',
      },
    ]);
    expect(stats.system.recentClinics[0]?.createdAt).toBe('2026-11-10T00:00:00.000Z');
  });

  it('caches as PHI under a bounded key', async () => {
    const { service, calls } = buildService();
    await service.getSystemDashboardStats('not-a-period');
    expect(calls.cacheKeys).toEqual(['analytics:dashboard:system:month']);
    expect(calls.cacheOptions[0]).toMatchObject({ containsPHI: true, ttl: 300 });
  });
});

describe('AnalyticsController GET analytics/dashboard scope', () => {
  function build() {
    const service = {
      getSystemDashboardStats: jest.fn().mockResolvedValue({ system: {} }),
      getDashboardStats: jest.fn().mockResolvedValue({ summary: {} }),
    };
    return { controller: new AnalyticsController(service as never), service };
  }
  const requestAs = (role: Role): ClinicAuthenticatedRequest =>
    ({ user: { sub: 'u1', role }, clinicContext: { clinicId: 'clinic-1' } }) as never;

  it('gives a Super Admin the whole system even with a clinic selected', async () => {
    const { controller, service } = build();
    await controller.getDashboardStats(requestAs(Role.SUPER_ADMIN), 'month');
    expect(service.getSystemDashboardStats).toHaveBeenCalledWith('month');
    expect(service.getDashboardStats).not.toHaveBeenCalled();
  });

  it("keeps a clinic admin on their clinic's stats", async () => {
    const { controller, service } = build();
    await controller.getDashboardStats(requestAs(Role.CLINIC_ADMIN), 'month');
    expect(service.getDashboardStats).toHaveBeenCalledWith('clinic-1', 'month');
    expect(service.getSystemDashboardStats).not.toHaveBeenCalled();
  });
});
