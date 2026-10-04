/// <reference types="jest" />
/**
 * Validation tests for the video consultation DTOs that accept free user input.
 */

import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  EndVideoConsultationDto,
  GenerateVideoTokenDto,
  RateVideoConsultationDto,
  StartVideoConsultationDto,
} from '@dtos/video.dto';
import { ValidationPipeConfig } from '@config/validation-pipe.config';

jest.mock('@infrastructure/logging/logging.service', () => ({
  LoggingService: class LoggingService {},
}));

async function validateRating(payload: Record<string, unknown>): Promise<{
  dto: RateVideoConsultationDto;
  properties: string[];
}> {
  const dto = plainToInstance(RateVideoConsultationDto, payload);
  const errors = await validate(dto);
  return { dto, properties: errors.map(error => error.property) };
}

describe('RateVideoConsultationDto', () => {
  it.each([1, 2, 3, 4, 5])('accepts a whole-number rating of %i', async rating => {
    const { properties } = await validateRating({ rating });
    expect(properties).toEqual([]);
  });

  it('accepts a numeric string rating sent by form clients', async () => {
    const { dto, properties } = await validateRating({ rating: '4' });
    expect(properties).toEqual([]);
    expect(dto.rating).toBe(4);
  });

  it.each([0, 6, -1, 100])('rejects the out-of-range rating %i', async rating => {
    const { properties } = await validateRating({ rating });
    expect(properties).toContain('rating');
  });

  it.each([3.5, 4.9, 0.5])('rejects the non-integer rating %p', async rating => {
    const { properties } = await validateRating({ rating });
    expect(properties).toContain('rating');
  });

  it.each(['abc', null, undefined, NaN])('rejects the non-numeric rating %p', async rating => {
    const { properties } = await validateRating({ rating });
    expect(properties).toContain('rating');
  });

  it('trims the comment', async () => {
    const { dto, properties } = await validateRating({ rating: 5, comment: '  Very helpful  ' });
    expect(properties).toEqual([]);
    expect(dto.comment).toBe('Very helpful');
  });

  it('accepts a comment of exactly 1000 characters', async () => {
    const { properties } = await validateRating({ rating: 5, comment: 'a'.repeat(1000) });
    expect(properties).toEqual([]);
  });

  it('rejects a comment longer than 1000 characters', async () => {
    const { properties } = await validateRating({ rating: 5, comment: 'a'.repeat(1001) });
    expect(properties).toContain('comment');
  });

  it('measures the 1000 character limit after trimming', async () => {
    const padded = `   ${'a'.repeat(1000)}   `;
    const { dto, properties } = await validateRating({ rating: 5, comment: padded });
    expect(properties).toEqual([]);
    expect(dto.comment).toHaveLength(1000);
  });

  it('rejects a comment that is not a string', async () => {
    const { properties } = await validateRating({ rating: 5, comment: 42 });
    expect(properties).toContain('comment');
  });

  it('keeps the comment and the informational consultationId optional', async () => {
    const withoutOptional = await validateRating({ rating: 3 });
    const withConsultationId = await validateRating({ rating: 3, consultationId: 'c-1' });

    expect(withoutOptional.properties).toEqual([]);
    expect(withConsultationId.properties).toEqual([]);
  });
});

/**
 * The token, start and end bodies used to require `userId` (UUID) and `userRole` (a four-value
 * enum) although the controller ignores both and takes identity from the JWT. Mobile sends
 * `role.toLowerCase()` (assistant_doctor, nurse, therapist, counselor, ...), so those callers got a
 * 400 before authorisation. Both fields are optional, deprecated and ignored now.
 *
 * Tested through the real whitelist ValidationPipe the controller runs under
 * (`forbidNonWhitelisted`), so an old client that still sends them must not be rejected either.
 */
describe('video token / start / end bodies', () => {
  const APPOINTMENT_ID = '11111111-1111-4111-8111-111111111111';
  const pipe = new ValidationPipe(ValidationPipeConfig.getOptions());

  type BodyClass =
    | typeof GenerateVideoTokenDto
    | typeof StartVideoConsultationDto
    | typeof EndVideoConsultationDto;

  const withUserInfo = (
    metatype: BodyClass,
    body: Record<string, unknown>
  ): Record<string, unknown> =>
    metatype === GenerateVideoTokenDto ? { ...body, userInfo: { displayName: 'Dr Test' } } : body;

  function run(metatype: BodyClass, body: Record<string, unknown>): Promise<unknown> {
    return pipe.transform(withUserInfo(metatype, body), { type: 'body', metatype });
  }

  const BODIES: Array<[string, BodyClass]> = [
    ['GenerateVideoTokenDto (POST /video/token)', GenerateVideoTokenDto],
    ['StartVideoConsultationDto (POST /video/consultation/start)', StartVideoConsultationDto],
    ['EndVideoConsultationDto (POST /video/consultation/end)', EndVideoConsultationDto],
  ];

  describe.each(BODIES)('%s', (_name, metatype) => {
    it('accepts a body with only the appointmentId', async () => {
      await expect(run(metatype, { appointmentId: APPOINTMENT_ID })).resolves.toMatchObject({
        appointmentId: APPOINTMENT_ID,
      });
    });

    it.each([
      'patient',
      'doctor',
      'receptionist',
      'clinic_admin',
      'assistant_doctor',
      'nurse',
      'therapist',
      'counselor',
      'super_admin',
    ])('accepts the role name "%s" a client may send, and ignores it', async userRole => {
      await expect(
        run(metatype, { appointmentId: APPOINTMENT_ID, userId: 'user-1', userRole })
      ).resolves.toBeDefined();
    });

    it('accepts a userId that is not a UUID (it is ignored, not validated)', async () => {
      await expect(
        run(metatype, { appointmentId: APPOINTMENT_ID, userId: 'not-a-uuid' })
      ).resolves.toBeDefined();
    });

    it('still requires a valid appointmentId', async () => {
      await expect(run(metatype, {})).rejects.toBeInstanceOf(BadRequestException);
      await expect(run(metatype, { appointmentId: 'nope' })).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('still rejects unknown fields (the whitelist stays on)', async () => {
      await expect(
        run(metatype, { appointmentId: APPOINTMENT_ID, isAdmin: true })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a userRole or userId that is not a string', async () => {
      await expect(
        run(metatype, { appointmentId: APPOINTMENT_ID, userRole: 7 })
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        run(metatype, { appointmentId: APPOINTMENT_ID, userId: { id: 1 } })
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('keeps the end body options (meetingNotes, endReason) working without identity fields', async () => {
    await expect(
      run(EndVideoConsultationDto, {
        appointmentId: APPOINTMENT_ID,
        meetingNotes: 'Completed',
        endReason: 'done',
      })
    ).resolves.toMatchObject({ meetingNotes: 'Completed', endReason: 'done' });
  });

  it('keeps the token body requiring the user info', async () => {
    await expect(
      pipe.transform(
        { appointmentId: APPOINTMENT_ID },
        { type: 'body', metatype: GenerateVideoTokenDto }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
