/**
 * Change-password / reset-password DTOs (B3): `confirmPassword` is optional (the web and mobile
 * clients do not send it) and is compared with `newPassword` only when it is present. The
 * `newPassword` rules are unchanged. Validated the way the global ValidationPipe does.
 */
import { describe, it, expect } from '@jest/globals';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto, PasswordResetDto } from '@dtos/auth.dto';

async function errorsFor<T extends object>(
  type: new () => T,
  plain: Record<string, unknown>
): Promise<Record<string, string[]>> {
  const instance = plainToInstance(type, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return Object.fromEntries(
    errors.map(error => [error.property, Object.values(error.constraints ?? {})])
  );
}

describe('ChangePasswordDto', () => {
  it('accepts a body without confirmPassword', async () => {
    expect(
      await errorsFor(ChangePasswordDto, {
        currentPassword: 'OldPassword123!',
        newPassword: 'NewSecurePassword123!',
      })
    ).toEqual({});
  });

  it('accepts a matching confirmPassword', async () => {
    expect(
      await errorsFor(ChangePasswordDto, {
        currentPassword: 'OldPassword123!',
        newPassword: 'NewSecurePassword123!',
        confirmPassword: 'NewSecurePassword123!',
      })
    ).toEqual({});
  });

  it('rejects a confirmPassword that differs from newPassword', async () => {
    const errors = await errorsFor(ChangePasswordDto, {
      currentPassword: 'OldPassword123!',
      newPassword: 'NewSecurePassword123!',
      confirmPassword: 'Different123!',
    });
    expect(errors['confirmPassword']).toEqual(['Passwords do not match']);
  });

  it('keeps the newPassword rules (required, min 8)', async () => {
    expect(
      Object.keys(await errorsFor(ChangePasswordDto, { currentPassword: 'OldPassword123!' }))
    ).toEqual(['newPassword']);
    expect(
      Object.keys(
        await errorsFor(ChangePasswordDto, {
          currentPassword: 'OldPassword123!',
          newPassword: 'short',
        })
      )
    ).toEqual(['newPassword']);
  });
});

describe('PasswordResetDto', () => {
  it('accepts token + newPassword without confirmPassword', async () => {
    expect(
      await errorsFor(PasswordResetDto, {
        token: 'reset-token',
        newPassword: 'NewSecurePassword123!',
      })
    ).toEqual({});
  });

  it('rejects a mismatching confirmPassword and still requires the token', async () => {
    const errors = await errorsFor(PasswordResetDto, {
      newPassword: 'NewSecurePassword123!',
      confirmPassword: 'Other123!',
    });
    expect(Object.keys(errors).sort()).toEqual(['confirmPassword', 'token']);
  });
});
