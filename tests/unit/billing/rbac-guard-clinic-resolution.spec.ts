/// <reference types="jest" />
/**
 * RbacGuard must reuse the canonical clinic UUID that validateClinicAccess already resolved
 * instead of running another (uncached) clinic lookup on every guarded request.
 */
import type { ExecutionContext } from '@nestjs/common';

jest.mock('@core/rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('@infrastructure/logging/logging.service', () => ({ LoggingService: class {} }));
jest.mock('@infrastructure/database/database.service', () => ({ DatabaseService: class {} }));
jest.mock('@infrastructure/database/internal/clinic-isolation.service', () => ({
  ClinicIsolationService: class {},
}));
jest.mock('@utils/clinic.utils', () => ({ resolveClinicUUID: jest.fn() }));

import { RbacGuard } from '@core/rbac/rbac.guard';
import { IS_PUBLIC_KEY } from '@core/decorators/public.decorator';
import { resolveClinicUUID } from '@utils/clinic.utils';

const CLINIC_UUID = '11111111-1111-4111-8111-111111111111';

function setup(accessResult: Record<string, unknown>) {
  const checkPermission = jest
    .fn()
    .mockResolvedValue({ hasPermission: true, roles: ['CLINIC_ADMIN'] });
  const guard = new RbacGuard(
    { checkPermission } as never,
    {
      getAllAndOverride: jest.fn((key: string) =>
        key === IS_PUBLIC_KEY ? false : [{ resource: 'billing', action: 'read' }]
      ),
    } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    { validateClinicAccess: jest.fn().mockResolvedValue(accessResult) } as never
  );
  const request = {
    user: { id: 'user-1' },
    headers: { 'x-clinic-id': 'CL0001' },
    params: {},
    body: {},
    query: {},
    url: '/billing/plans',
    method: 'GET',
  };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard, checkPermission, context };
}

describe('RbacGuard clinic resolution', () => {
  beforeEach(() => {
    (resolveClinicUUID as jest.Mock).mockReset();
  });

  it('reuses the clinic UUID returned by validateClinicAccess (no extra clinic lookup)', async () => {
    const { guard, checkPermission, context } = setup({
      success: true,
      data: true,
      clinicContext: { clinicId: CLINIC_UUID },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(resolveClinicUUID).not.toHaveBeenCalled();
    expect(checkPermission).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC_UUID })
    );
  });

  it('falls back to resolving the clinic when the validation result carries no context', async () => {
    (resolveClinicUUID as jest.Mock).mockResolvedValue(CLINIC_UUID);
    const { guard, checkPermission, context } = setup({ success: true, data: true });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(resolveClinicUUID).toHaveBeenCalledTimes(1);
    expect(checkPermission).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC_UUID })
    );
  });
});
