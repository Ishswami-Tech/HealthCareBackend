/// <reference types="jest" />
/**
 * Patient profile: photo upload (private object + presigned read), the emergency-contact
 * / insurance upserts (EmergencyContact and Insurance have NO clinicId column), blood
 * group + marital status persistence, no credentials in the profile read, and the DTO
 * rules for the new fields.
 */

import { BadRequestException, ForbiddenException, PayloadTooLargeException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PatientsService } from '@services/patients/patients.service';
import {
  PROFILE_PHOTO_MAX_BYTES,
  buildProfilePhotoStorageName,
  validateProfilePhotoFile,
} from '@services/patients/patient-document.util';
import { UpdateProfileRequestDto } from '@dtos/profile-completion.dto';
import { UpdateUserProfileDto } from '@dtos/user.dto';
import { CreatePatientDto, UpdatePatientDto } from '@dtos/patient.dto';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/logging/logging.service', () => ({
  LoggingService: class LoggingService {},
}));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/storage/static-asset.service', () => ({
  AssetType: { DOCUMENT: 'documents' },
  StaticAssetService: class StaticAssetService {},
}));
jest.mock('@core/rbac/role.service', () => ({ RoleService: class RoleService {} }));
jest.mock('@core/rbac/permission.service', () => ({
  PermissionService: class PermissionService {},
}));
jest.mock('@services/appointments/appointments.service', () => ({
  AppointmentsService: class AppointmentsService {},
}));
jest.mock('@services/ehr/ehr.service', () => ({ EHRService: class EHRService {} }));
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('@services/pharmacy/services/pharmacy.service', () => ({
  PharmacyService: class PharmacyService {},
}));

const CLINIC = 'clinic-1';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

function photo(buffer: Buffer = JPEG, mimetype = 'image/jpeg') {
  return { buffer, mimetype, originalname: 'me.jpg', size: buffer.length };
}

interface HarnessOptions {
  previousPhoto?: string | null;
  writeFails?: boolean;
  uploadOk?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const userUpdates: Array<Record<string, unknown>> = [];
  const client = {
    user: {
      findUnique: jest.fn(async (args: { select?: { profilePicture?: boolean } }) =>
        args.select?.profilePicture
          ? { profilePicture: options.previousPhoto ?? null }
          : {
              id: 'user-self',
              name: 'Asha',
              profilePicture: 'https://cdn.example.com/documents/avatar-user-self-1.jpg',
              emergencyContacts: [{ name: 'Ravi', relationship: 'Spouse', phone: '+910000000000' }],
            }
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (options.writeFails) throw new Error('db down');
        userUpdates.push(data);
        return {};
      }),
    },
    patient: {
      findFirst: jest.fn().mockResolvedValue({ id: 'patient-self' }),
    },
    emergencyContact: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    insurance: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const databaseService = {
    findUserByIdSafe: jest.fn().mockResolvedValue({ id: 'user-self', primaryClinicId: CLINIC }),
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    executeHealthcareWrite: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
  };
  const staticAssetService = {
    uploadFile: jest.fn().mockResolvedValue(
      options.uploadOk === false
        ? { success: false, error: 'bucket down' }
        : {
            success: true,
            url: 'https://cdn.example.com/documents/uuid-avatar-user-self-2.jpg',
            key: 'documents/uuid-avatar-user-self-2.jpg',
          }
    ),
    deleteAsset: jest.fn().mockResolvedValue(true),
    resolveSignedUrl: jest.fn(async (url: string) => `${url}?X-Amz-Signature=sig`),
  };
  const cacheService = { invalidatePatientCache: jest.fn().mockResolvedValue(0) };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new PatientsService(
    databaseService as never,
    loggingService as never,
    staticAssetService as never,
    cacheService as never
  );
  return { service, client, databaseService, staticAssetService, cacheService, userUpdates };
}

const PATIENT_ACTOR = {
  userId: 'user-self',
  userRole: 'PATIENT',
  operation: 'UPDATE',
  resourceType: 'USER',
  clinicId: CLINIC,
};

describe('PatientsService.uploadProfilePhoto', () => {
  it('stores a private avatar named after the user, saves it and returns a presigned URL', async () => {
    const h = createHarness();

    const result = await h.service.uploadProfilePhoto('user-self', photo(), PATIENT_ACTOR);

    const [, name, assetType, mime, isPublic] = h.staticAssetService.uploadFile.mock.calls[0] as [
      Buffer,
      string,
      string,
      string,
      boolean,
    ];
    expect(name).toMatch(/^avatar-user-self-\d+\.jpg$/);
    expect(assetType).toBe('documents');
    expect(mime).toBe('image/jpeg');
    expect(isPublic).toBe(false);
    expect(h.userUpdates).toEqual([
      { profilePicture: 'https://cdn.example.com/documents/uuid-avatar-user-self-2.jpg' },
    ]);
    expect(result.profilePicture).toBe(
      'https://cdn.example.com/documents/uuid-avatar-user-self-2.jpg?X-Amz-Signature=sig'
    );
    expect(h.staticAssetService.resolveSignedUrl).toHaveBeenCalledWith(
      'https://cdn.example.com/documents/uuid-avatar-user-self-2.jpg',
      undefined,
      { boundTo: ['user-self'] }
    );
    expect(h.cacheService.invalidatePatientCache).toHaveBeenCalledWith('user-self', CLINIC);
    expect(h.databaseService.executeHealthcareWrite).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        userId: 'user-self',
        userRole: 'PATIENT',
        resourceType: 'USER',
        details: expect.objectContaining({ action: 'update_profile_photo' }),
      })
    );
  });

  it('removes the previous avatar object but never a social-login URL or a document', async () => {
    const own = createHarness({
      previousPhoto: 'https://cdn.example.com/documents/uuid-avatar-user-self-1.jpg',
    });
    await own.service.uploadProfilePhoto('user-self', photo(), PATIENT_ACTOR);
    expect(own.staticAssetService.deleteAsset).toHaveBeenCalledWith(
      'documents/uuid-avatar-user-self-1.jpg'
    );

    const google = createHarness({ previousPhoto: 'https://lh3.googleusercontent.com/a/abc' });
    await google.service.uploadProfilePhoto('user-self', photo(), PATIENT_ACTOR);
    expect(google.staticAssetService.deleteAsset).not.toHaveBeenCalled();

    const someonesDocument = createHarness({
      previousPhoto: 'https://cdn.example.com/documents/uuid-doc-patient-self-9.pdf',
    });
    await someonesDocument.service.uploadProfilePhoto('user-self', photo(), PATIENT_ACTOR);
    expect(someonesDocument.staticAssetService.deleteAsset).not.toHaveBeenCalled();
  });

  it('a PATIENT cannot change someone else photo (403) and nothing is stored', async () => {
    const h = createHarness();

    await expect(
      h.service.uploadProfilePhoto('user-other', photo(), PATIENT_ACTOR)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
    expect(h.client.user.update).not.toHaveBeenCalled();
  });

  it('staff may only change the photo of a patient of their clinic', async () => {
    const h = createHarness();
    const spy = jest.spyOn(h.service, 'isPatientInClinic');
    const staff = { ...PATIENT_ACTOR, userId: 'staff-1', userRole: 'RECEPTIONIST' };

    spy.mockResolvedValueOnce(false);
    await expect(h.service.uploadProfilePhoto('user-other', photo(), staff)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();

    spy.mockResolvedValueOnce(true);
    await expect(h.service.uploadProfilePhoto('user-other', photo(), staff)).resolves.toEqual(
      expect.objectContaining({ profilePicture: expect.any(String) })
    );
    expect(spy).toHaveBeenLastCalledWith('user-other', CLINIC);
  });

  it('rejects a PDF (400) and a photo over 5 MB (413) before storing anything', async () => {
    const h = createHarness();

    await expect(
      h.service.uploadProfilePhoto('user-self', photo(PDF, 'application/pdf'), PATIENT_ACTOR)
    ).rejects.toBeInstanceOf(BadRequestException);
    const big = Buffer.concat([JPEG, Buffer.alloc(PROFILE_PHOTO_MAX_BYTES, 0)]);
    await expect(
      h.service.uploadProfilePhoto('user-self', photo(big), PATIENT_ACTOR)
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects an executable posing as an image (file signature decides, not the header)', async () => {
    const h = createHarness();

    await expect(
      h.service.uploadProfilePhoto(
        'user-self',
        photo(Buffer.from('MZ\u0090\u0000 not an image at all, just text'), 'image/jpeg'),
        PATIENT_ACTOR
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });

  it('discards the uploaded object when the profile row cannot be saved, and rethrows', async () => {
    const h = createHarness({ writeFails: true });

    await expect(h.service.uploadProfilePhoto('user-self', photo(), PATIENT_ACTOR)).rejects.toThrow(
      'db down'
    );
    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledWith(
      'documents/uuid-avatar-user-self-2.jpg'
    );
  });

  it('is a 500 (not a silent success) when the object store rejects the file', async () => {
    const h = createHarness({ uploadOk: false });

    await expect(h.service.uploadProfilePhoto('user-self', photo(), PATIENT_ACTOR)).rejects.toThrow(
      'Could not store the photo'
    );
    expect(h.client.user.update).not.toHaveBeenCalled();
  });
});

describe('profile photo helpers', () => {
  it('names the object after the user so the signed URL can be bound to the owner', () => {
    expect(buildProfilePhotoStorageName('u-1', 'png', 5)).toBe('avatar-u-1-5.png');
  });

  it('accepts JPEG and rejects text posing as an image', () => {
    expect(validateProfilePhotoFile(photo()).mimeType).toBe('image/jpeg');
    expect(() =>
      validateProfilePhotoFile(photo(Buffer.from('just some text, not an image'), 'image/png'))
    ).toThrow(BadRequestException);
  });
});

describe('PatientsService.getPatientProfile', () => {
  it('omits the credentials, signs the photo and exposes the emergency contact as an object', async () => {
    const h = createHarness();

    const profile = (await h.service.getPatientProfile('user-self')) as Record<string, unknown>;

    const args = h.client.user.findUnique.mock.calls[0]?.[0] as unknown as {
      omit: Record<string, boolean>;
    };
    expect(args.omit).toMatchObject({
      password: true,
      googleId: true,
      facebookId: true,
      appleId: true,
    });
    expect(profile['emergencyContact']).toEqual({
      name: 'Ravi',
      relationship: 'Spouse',
      phone: '+910000000000',
    });
    expect(profile['profilePicture']).toBe(
      'https://cdn.example.com/documents/avatar-user-self-1.jpg?X-Amz-Signature=sig'
    );
  });
});

describe('PatientsService.createOrUpdatePatient', () => {
  it('saves the emergency contact without a clinicId (the table has no such column)', async () => {
    const h = createHarness();

    await h.service.createOrUpdatePatient({
      userId: 'user-self',
      clinicId: CLINIC,
      emergencyContact: { name: 'Ravi', relationship: 'Spouse', phone: '+910000000000' },
    });

    const lookup = h.client.emergencyContact.findFirst.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(lookup.where).not.toHaveProperty('clinicId');
    const created = h.client.emergencyContact.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(created.data).toEqual({
      userId: 'user-self',
      name: 'Ravi',
      relationship: 'Spouse',
      phone: '+910000000000',
    });
  });

  it('updates the existing emergency contact instead of adding a second one', async () => {
    const h = createHarness();
    h.client.emergencyContact.findFirst.mockResolvedValueOnce({ id: 'ec-1' });

    await h.service.createOrUpdatePatient({
      userId: 'user-self',
      emergencyContact: { name: 'Meera', relationship: 'Mother', phone: '+911111111111' },
    });

    expect(h.client.emergencyContact.create).not.toHaveBeenCalled();
    expect(h.client.emergencyContact.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ec-1' } })
    );
  });

  it('saves insurance without a clinicId either', async () => {
    const h = createHarness();

    await h.service.createOrUpdatePatient({
      userId: 'user-self',
      clinicId: CLINIC,
      insurance: {
        provider: 'Star',
        policyNumber: 'P-1',
        primaryHolder: 'Asha',
        coverageStartDate: '2026-01-01',
        coverageType: 'Medical',
      },
    });

    const lookup = h.client.insurance.findFirst.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(lookup.where).toEqual({ userId: 'user-self' });
    const created = h.client.insurance.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(created.data).not.toHaveProperty('clinicId');
  });

  it('persists bloodGroup, maritalStatus and occupation on the user (bloodGroup used to be dropped)', async () => {
    const h = createHarness();

    await h.service.createOrUpdatePatient({
      userId: 'user-self',
      bloodGroup: 'O+',
      maritalStatus: 'MARRIED',
      occupation: ' Teacher ',
    });

    expect(h.userUpdates).toContainEqual({
      occupation: 'Teacher',
      maritalStatus: 'MARRIED',
      bloodGroup: 'O+',
    });
  });
});

describe('profile DTO validation for occupation, maritalStatus and bloodGroup', () => {
  const errorsFor = async <T extends object>(cls: new () => T, plain: object) =>
    (await validate(plainToInstance(cls, plain))).map(error => error.property);

  it('POST /profile/completion/update accepts occupation, maritalStatus and bloodGroup (case-insensitive)', async () => {
    const dto = plainToInstance(UpdateProfileRequestDto, {
      occupation: 'Teacher',
      maritalStatus: 'married',
      bloodGroup: 'ab+',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.maritalStatus).toBe('MARRIED');
    expect(dto.bloodGroup).toBe('AB+');
  });

  it.each([
    ['UpdateProfileRequestDto', UpdateProfileRequestDto],
    ['UpdateUserProfileDto', UpdateUserProfileDto],
    ['UpdatePatientDto', UpdatePatientDto],
  ])('%s rejects an unknown marital status or blood group', async (_name, cls) => {
    const properties = await errorsFor(cls as new () => object, {
      maritalStatus: 'COMPLICATED',
      bloodGroup: 'Z+',
    });

    expect(properties).toEqual(expect.arrayContaining(['maritalStatus', 'bloodGroup']));
  });

  it('CreatePatientDto accepts the new fields and validates the blood group', async () => {
    expect(await errorsFor(CreatePatientDto, { userId: 'u', bloodGroup: 'XX' })).toContain(
      'bloodGroup'
    );
    const ok = plainToInstance(CreatePatientDto, {
      userId: 'u',
      bloodGroup: 'o-',
      maritalStatus: 'single',
      occupation: 'Engineer',
    });
    const properties = (await validate(ok)).map(error => error.property);
    expect(properties).not.toContain('bloodGroup');
    expect(properties).not.toContain('maritalStatus');
    expect(properties).not.toContain('occupation');
    expect(ok.bloodGroup).toBe('O-');
  });
});
