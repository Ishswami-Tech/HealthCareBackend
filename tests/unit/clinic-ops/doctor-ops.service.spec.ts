import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DoctorOpsService } from '@services/clinic-ops/services/doctor-ops.service';

type Row = Record<string, unknown>;

describe('DoctorOpsService', () => {
  let favourites: Row[];
  let order: Row | null;
  let doctor: Row | null;
  let service: DoctorOpsService;

  beforeEach(() => {
    favourites = [];
    order = {
      id: 'o1',
      patientId: 'p1',
      status: 'ORDERED',
      tests: [],
      urgency: 'ROUTINE',
      orderedAt: new Date(),
    };
    doctor = { id: 'd1', userId: 'doc-user' };
    const client = {
      doctor: { findFirst: jest.fn(async () => doctor) },
      patient: {
        findFirst: jest.fn(async () => ({ id: 'p1' })),
        findMany: jest.fn(async () => [{ id: 'p1', user: { name: 'Asha' } }]),
      },
      investigationOrder: {
        create: jest.fn(async ({ data }: { data: Row }) => ({
          id: 'o2',
          orderedAt: new Date(),
          ...data,
        })),
        findFirst: jest.fn(async () => order),
        findMany: jest.fn(async () => [order]),
        update: jest.fn(async ({ data }: { data: Row }) => ({ ...(order as Row), ...data })),
      },
      doctorFavourite: {
        upsert: jest.fn(async ({ create }: { create: Row }) => {
          const row = { id: `f${favourites.length + 1}`, ...create };
          favourites.push(row);
          return row;
        }),
        findMany: jest.fn(async () => favourites),
        deleteMany: jest.fn(async ({ where }: { where: Row }) => ({
          count: favourites.filter(f => f['id'] === where['id'] && f['userId'] === where['userId'])
            .length,
        })),
      },
    };
    const ops = {
      read: (fn: (c: unknown) => unknown) => fn(client),
      write: (fn: (c: unknown) => unknown) => fn(client),
    };
    service = new DoctorOpsService(ops as never);
  });

  it('only a doctor account can order investigations', async () => {
    doctor = null;
    await expect(
      service.createInvestigation({ patientId: 'p1', tests: [{ name: 'CBC' }] }, 'c1', {
        userId: 'assistant',
        role: 'ASSISTANT_DOCTOR',
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks an invalid investigation status jump', async () => {
    (order as Row)['status'] = 'RESULT_READY';
    await expect(
      service.setInvestigationStatus('o1', { status: 'CANCELLED' }, 'c1', {
        userId: 'u',
        role: 'DOCTOR',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stores favourites per account and only deletes the caller's own", async () => {
    const saved = await service.upsertFavourite(
      { kind: 'MEDICINE', itemKey: 'm1', label: 'Avipattikar' },
      'c1',
      { userId: 'doc-user', role: 'DOCTOR' }
    );
    expect(saved.label).toBe('Avipattikar');
    await expect(
      service.removeFavourite(saved.id, 'c1', { userId: 'other', role: 'DOCTOR' })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.removeFavourite(saved.id, 'c1', { userId: 'doc-user', role: 'DOCTOR' })
    ).resolves.toEqual({
      id: saved.id,
      deleted: true,
    });
  });
});
