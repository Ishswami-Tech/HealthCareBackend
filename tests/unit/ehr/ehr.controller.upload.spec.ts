/// <reference types="jest" />
/**
 * POST /ehr/medical-records/:id/upload (controller): the file is read from the
 * multipart BODY (`@fastify/multipart` runs with attachFieldsToBody), a missing
 * file is a 400 and an unknown record (or one of another clinic) is a 404.
 */

import 'reflect-metadata';
import { BadRequestException, ExecutionContext, NotFoundException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { EHRController } from '@services/ehr/controllers/ehr.controller';
import { Role } from '@core/types/enums.types';

jest.mock('@services/ehr/ehr.service', () => ({ EHRService: class EHRService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class RolesGuard {} }));
jest.mock('@core/guards/clinic.guard', () => ({ ClinicGuard: class ClinicGuard {} }));
jest.mock('@core/guards/profile-completion.guard', () => ({
  ProfileCompletionGuard: class ProfileCompletionGuard {},
}));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class RbacGuard {} }));
jest.mock('@core/rbac/rbac.decorators', () => ({
  RequireResourcePermission: () => () => undefined,
}));
jest.mock('@core/decorators/profile-completion.decorator', () => ({
  RequiresProfileCompletion: () => () => undefined,
}));
jest.mock('@core/decorators', () => ({
  PatientCache: () => () => undefined,
  Cache: () => () => undefined,
}));

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32, 0x20)]);

type ParamFactory = (data: unknown, ctx: ExecutionContext) => unknown;

/** Runs the custom param decorator Nest registered for the upload handler's `file` argument. */
function readUploadedFile(request: Record<string, unknown>): unknown {
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    EHRController,
    'uploadMedicalRecordFile'
  ) as Record<string, { factory?: ParamFactory; index: number }>;
  const fileArg = Object.values(args).find(arg => arg.index === 1);
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return fileArg?.factory?.(undefined, context);
}

function createController(uploadResult: unknown) {
  const ehrService = { uploadMedicalRecordFile: jest.fn().mockResolvedValue(uploadResult) };
  const controller = new EHRController(ehrService as never);
  return { controller, ehrService };
}

const REQUEST = {
  user: { id: 'staff-1', role: 'DOCTOR' },
  clinicContext: { clinicId: 'clinic-1' },
};

describe('EHRController.uploadMedicalRecordFile', () => {
  it('stays staff-only', () => {
    const handler = EHRController.prototype.uploadMedicalRecordFile as unknown as object;
    const roles = Reflect.getMetadata('roles', handler) as string[];
    expect(roles).not.toContain(Role.PATIENT);
    expect(roles).toEqual(
      expect.arrayContaining([Role.DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN])
    );
  });

  it('reads the file from the multipart body (attachFieldsToBody), not from req.files', () => {
    const file = readUploadedFile({
      body: {
        file: { type: 'file', _buf: PDF, mimetype: 'application/pdf', filename: 'scan.pdf' },
        note: { type: 'field', value: 'ignored' },
      },
      // The shape the previous decorator expected must no longer matter.
      files: [],
    });

    expect(file).toEqual({
      buffer: PDF,
      mimetype: 'application/pdf',
      originalname: 'scan.pdf',
      size: PDF.length,
    });
  });

  it('yields no file when the multipart body has none', () => {
    expect(readUploadedFile({ body: { note: { type: 'field', value: 'x' } } })).toBeNull();
    expect(readUploadedFile({})).toBeNull();
  });

  it('rejects a request without a file with 400', async () => {
    const { controller, ehrService } = createController(null);

    await expect(
      controller.uploadMedicalRecordFile('record-1', null, REQUEST as never)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ehrService.uploadMedicalRecordFile).not.toHaveBeenCalled();
  });

  it('forwards the file and the clinic of the caller to the service and returns its result', async () => {
    const result = { record: { id: 'record-1' }, fileUrl: 'https://signed', fileKey: 'k' };
    const { controller, ehrService } = createController(result);
    const file = {
      buffer: PDF,
      mimetype: 'application/pdf',
      originalname: 'scan.pdf',
      size: PDF.length,
    };

    await expect(
      controller.uploadMedicalRecordFile('record-1', file, REQUEST as never)
    ).resolves.toBe(result);
    expect(ehrService.uploadMedicalRecordFile).toHaveBeenCalledWith(
      'record-1',
      PDF,
      'scan.pdf',
      'application/pdf',
      'clinic-1'
    );
  });

  it('answers 404 when the record does not exist in the caller clinic', async () => {
    const { controller } = createController(null);
    const file = {
      buffer: PDF,
      mimetype: 'application/pdf',
      originalname: 'scan.pdf',
      size: PDF.length,
    };

    await expect(
      controller.uploadMedicalRecordFile('missing', file, REQUEST as never)
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
