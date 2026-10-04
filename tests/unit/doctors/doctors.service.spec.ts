/// <reference types="jest" />

import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DoctorsService,
  buildDoctorProfileUpdate,
  maskReviewerName,
} from '../../../src/services/doctors/doctors.service';
import { UpdateDoctorProfileDto, CreateDoctorReviewDto } from '@dtos/doctor.dto';

type Fn = jest.Mock;

function build() {
  const tx = {
    doctor: { findFirst: jest.fn() as Fn, update: jest.fn() as Fn, findUnique: jest.fn() as Fn },
    doctorClinic: { findFirst: jest.fn() as Fn, createMany: jest.fn() as Fn },
    user: { findUnique: jest.fn() as Fn },
    patient: { findUnique: jest.fn() as Fn },
    appointment: { findFirst: jest.fn() as Fn },
    review: {
      findMany: jest.fn() as Fn,
      aggregate: jest.fn() as Fn,
      create: jest.fn() as Fn,
    },
  };
  const db = {
    executeHealthcareRead: jest.fn((fn: (c: unknown) => unknown) => fn(tx)),
    executeHealthcareWrite: jest.fn((fn: (c: unknown) => unknown) => fn(tx)),
  };
  const cache = {
    invalidateCacheByTag: jest.fn().mockResolvedValue(undefined),
    invalidateClinicCache: jest.fn().mockResolvedValue(undefined),
    cache: jest.fn(),
    getKeyFactory: jest.fn(),
  };
  const events = { emit: jest.fn().mockResolvedValue(undefined) };
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new DoctorsService(
    db as never,
    logging as never,
    cache as never,
    events as never
  );
  return { service, tx, db, cache };
}

describe('buildDoctorProfileUpdate', () => {
  it('only includes defined fields and keeps zero/false values', () => {
    expect(
      buildDoctorProfileUpdate({
        consultationFee: 0,
        videoConsultationEnabled: false,
        languages: ['English'],
      })
    ).toEqual({ consultationFee: 0, videoConsultationEnabled: false, languages: ['English'] });
    expect(buildDoctorProfileUpdate({})).toEqual({});
  });
});

describe('maskReviewerName', () => {
  it('masks to first name + last initial', () => {
    expect(maskReviewerName('Asha', 'Patil')).toBe('Asha P.');
    expect(maskReviewerName(null, null, 'Ravi Kumar Singh')).toBe('Ravi K.');
    expect(maskReviewerName(null, null, null)).toBe('Patient');
  });
});

describe('profile DTO validation', () => {
  const run = async (body: object) =>
    (await validate(plainToInstance(UpdateDoctorProfileDto, body))).map(e => e.property);

  it('accepts valid extended fields', async () => {
    expect(
      await run({ videoConsultationFee: 499.5, slotDurationMinutes: 20, languages: ['Hindi'] })
    ).toEqual([]);
  });
  it('rejects out-of-range slot length and negative fee', async () => {
    expect(await run({ slotDurationMinutes: 2 })).toContain('slotDurationMinutes');
    expect(await run({ slotDurationMinutes: 500 })).toContain('slotDurationMinutes');
    expect(await run({ videoConsultationFee: -1 })).toContain('videoConsultationFee');
  });
  it('rejects bad review rating and long comment', async () => {
    const bad = await validate(
      plainToInstance(CreateDoctorReviewDto, {
        appointmentId: '7b6f3a52-1f0e-4b8a-9c53-0d6a1e2b3c4d',
        rating: 6,
        comment: 'x'.repeat(1001),
      })
    );
    expect(bad.map(e => e.property).sort()).toEqual(['comment', 'rating']);
  });
});

describe('DoctorsService.updateDoctorProfile ownership', () => {
  it('forbids a doctor editing someone else', async () => {
    const { service } = build();
    await expect(
      service.updateDoctorProfile('u2', { userId: 'u1', role: 'DOCTOR' }, { licenseNumber: 'X' })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s when a clinic admin edits a doctor outside the clinic', async () => {
    const { service, tx } = build();
    tx.doctorClinic.findFirst.mockResolvedValue(null);
    await expect(
      service.updateDoctorProfile(
        'u2',
        { userId: 'a1', role: 'CLINIC_ADMIN', clinicId: 'c1' },
        { education: 'MD' }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forbids other roles', async () => {
    const { service } = build();
    await expect(
      service.updateDoctorProfile('u2', { userId: 'u2', role: 'PATIENT' }, {})
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a doctor persist their own fields and busts the profile cache', async () => {
    const { service, tx, cache } = build();
    tx.doctor.findUnique.mockResolvedValue({ id: 'd1' });
    jest.spyOn(service, 'getDoctorProfile').mockResolvedValue({ id: 'u1' } as never);
    await service.updateDoctorProfile(
      'u1',
      { userId: 'u1', role: 'DOCTOR', clinicId: 'c1' },
      { slotDurationMinutes: 20, certifications: ['A'] }
    );
    expect(tx.doctor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { slotDurationMinutes: 20, certifications: ['A'] } })
    );
    expect(cache.invalidateCacheByTag).toHaveBeenCalledWith('doctor:u1');
  });
});

describe('DoctorsService reviews', () => {
  const input = { appointmentId: 'a1', rating: 5, comment: ' great ' };

  function ready() {
    const ctx = build();
    ctx.tx.doctor.findFirst.mockResolvedValue({ id: 'd1', userId: 'du1' });
    ctx.tx.patient.findUnique.mockResolvedValue({ id: 'p1' });
    ctx.tx.appointment.findFirst.mockResolvedValue({ id: 'a1', status: 'COMPLETED', metadata: {} });
    ctx.tx.review.create.mockResolvedValue({ id: 'r1', rating: 5, comment: 'great' });
    ctx.tx.review.aggregate.mockResolvedValue({ _avg: { rating: 4.46 } });
    return ctx;
  }

  it('creates a review for a completed own appointment and syncs Doctor.rating', async () => {
    const { service, tx, cache } = ready();
    await service.createDoctorReview('d1', 'c1', 'pu1', input);
    expect(tx.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1', clinicId: 'c1', doctorId: 'd1', patientId: 'p1' },
      })
    );
    expect(tx.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ comment: 'great', appointmentId: 'a1', clinicId: 'c1' }),
      })
    );
    expect(tx.doctor.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { rating: 4.5 } });
    expect(cache.invalidateCacheByTag).toHaveBeenCalledWith('doctor:du1');
  });

  it('404s for an appointment that is not the caller/doctor/clinic', async () => {
    const { service, tx } = ready();
    tx.appointment.findFirst.mockResolvedValue(null);
    await expect(service.createDoctorReview('d1', 'c1', 'pu1', input)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('rejects a not-completed appointment', async () => {
    const { service, tx } = ready();
    tx.appointment.findFirst.mockResolvedValue({ id: 'a1', status: 'CONFIRMED', metadata: {} });
    await expect(service.createDoctorReview('d1', 'c1', 'pu1', input)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('409s when already rated via the video flow', async () => {
    const { service, tx } = ready();
    tx.appointment.findFirst.mockResolvedValue({
      id: 'a1',
      status: 'COMPLETED',
      metadata: { consultationRating: { reviewId: 'r0' } },
    });
    await expect(service.createDoctorReview('d1', 'c1', 'pu1', input)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(tx.review.create).not.toHaveBeenCalled();
  });

  it('409s on a unique-constraint race', async () => {
    const { service, tx } = ready();
    tx.review.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.createDoctorReview('d1', 'c1', 'pu1', input)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('404s for a doctor outside the clinic', async () => {
    const { service, tx } = ready();
    tx.doctor.findFirst.mockResolvedValue(null);
    await expect(service.createDoctorReview('d1', 'c1', 'pu1', input)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('lists clinic-scoped, paginated, masked reviews with aggregate', async () => {
    const { service, tx } = build();
    tx.doctor.findFirst.mockResolvedValue({ id: 'd1', userId: 'du1' });
    tx.review.findMany.mockResolvedValue([
      {
        id: 'r1',
        rating: 4,
        comment: 'ok',
        createdAt: new Date(),
        patient: { user: { firstName: 'Asha', lastName: 'Patil', name: 'x' } },
      },
    ]);
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: 4 }, _count: { _all: 25 } });
    const page = await service.listDoctorReviews('d1', 'c1', 2, 10);
    expect(tx.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { doctorId: 'd1', clinicId: 'c1' }, skip: 10, take: 10 })
    );
    expect(page.items[0]?.reviewerName).toBe('Asha P.');
    expect(page.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
    expect(page.averageRating).toBe(4);
  });
});

describe('DoctorsService.onboardDoctor', () => {
  const admin = { role: 'CLINIC_ADMIN', clinicId: 'c1' };

  function withDoctor(user: unknown) {
    const ctx = build();
    ctx.tx.user.findUnique.mockResolvedValue(user);
    ctx.tx.doctor.findUnique.mockResolvedValue({ id: 'd1' });
    return ctx;
  }

  it('404s for a missing user and for a non-doctor role', async () => {
    const a = withDoctor(null);
    await expect(a.service.onboardDoctor(admin, { userId: 'u1' })).rejects.toBeInstanceOf(
      NotFoundException
    );
    const b = withDoctor({ role: 'PATIENT', doctor: null });
    await expect(b.service.onboardDoctor(admin, { userId: 'u1' })).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(b.tx.doctor.update).not.toHaveBeenCalled();
  });

  it('409s when the doctor belongs to another clinic only', async () => {
    const { service, tx } = withDoctor({
      role: 'DOCTOR',
      doctor: { clinics: [{ clinicId: 'c2' }] },
    });
    await expect(service.onboardDoctor(admin, { userId: 'u1' })).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(tx.doctorClinic.createMany).not.toHaveBeenCalled();
  });

  it('allows an unassigned doctor and links them to the clinic', async () => {
    const { service, tx } = withDoctor({ role: 'DOCTOR', doctor: null });
    await service.onboardDoctor(admin, { userId: 'u1', clinicId: 'c1', licenseNumber: 'L1' });
    expect(tx.doctorClinic.createMany).toHaveBeenCalledWith({
      data: [{ doctorId: 'd1', clinicId: 'c1' }],
      skipDuplicates: true,
    });
  });

  it('allows a doctor already in the same clinic', async () => {
    const { service } = withDoctor({ role: 'DOCTOR', doctor: { clinics: [{ clinicId: 'c1' }] } });
    await expect(service.onboardDoctor(admin, { userId: 'u1' })).resolves.toBeDefined();
  });

  it('leaves SUPER_ADMIN unrestricted (no user lookup, no auto-link)', async () => {
    const { service, tx } = build();
    tx.doctor.findUnique.mockResolvedValue({ id: 'd1' });
    await service.onboardDoctor({ role: 'SUPER_ADMIN', clinicId: 'c1' }, { userId: 'u1' });
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(tx.doctorClinic.createMany).not.toHaveBeenCalled();
  });
});
