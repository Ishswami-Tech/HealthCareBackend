/**
 * The check-in window has ONE definition: 20 minutes before .. 45 minutes after the appointment
 * time (QR_WINDOW_* in in-person-flow.util).
 * The plugin config default must be that same constant, not a second hand-typed number.
 */
import { describe, it, expect } from '@jest/globals';
import {
  CHECK_IN_WINDOW_AFTER_MINUTES,
  CHECK_IN_WINDOW_BEFORE_MINUTES,
} from '@services/appointments/core/check-in-presence.util';
import { PluginConfigService } from '@services/appointments/plugins/config/plugin-config.service';

function buildService(): PluginConfigService {
  const configService = {
    getEnvNumber: (_key: string, fallback: number): number => fallback,
    getEnvBoolean: (_key: string, fallback: boolean): boolean => fallback,
    getEnv: (_key: string, fallback: string): string => fallback,
  };
  const cacheService = {
    get: async (): Promise<unknown> => null,
    set: async (): Promise<boolean> => true,
  };
  return new PluginConfigService(configService as never, cacheService as never);
}

describe('check-in window defaults', () => {
  it('pins the product rule at 20 minutes before and 45 minutes after', () => {
    expect(CHECK_IN_WINDOW_BEFORE_MINUTES).toBe(20);
    expect(CHECK_IN_WINDOW_AFTER_MINUTES).toBe(45);
  });

  it('defaults the confirmation plugin window to the shared constants', async () => {
    const config = await buildService().getPluginConfig('clinic-confirmation-plugin');

    expect(config?.settings['checkInWindow']).toBe(CHECK_IN_WINDOW_BEFORE_MINUTES);
    expect(config?.settings['checkInWindowAfter']).toBe(CHECK_IN_WINDOW_AFTER_MINUTES);
  });
});
