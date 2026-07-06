import { createRequire } from 'module';

function patchModule(moduleExports: Record<string, unknown>): boolean {
  const plainToClass = moduleExports['plainToClass'];
  const plainToInstance = moduleExports['plainToInstance'];

  if (typeof plainToClass === 'function' || typeof plainToInstance !== 'function') {
    return false;
  }

  moduleExports['plainToClass'] = ((...args: unknown[]) =>
    (plainToInstance as (...values: unknown[]) => unknown)(...args)) as unknown;
  return true;
}

export function ensurePhonePeClassTransformerCompatibility(): void {
  try {
    const requireFn = createRequire(__filename);
    const resolvedModules = new Set<string>();

    try {
      resolvedModules.add(requireFn.resolve('class-transformer'));
    } catch {
      // ignore
    }

    try {
      const sdkEntryPoint = requireFn.resolve('@phonepe-pg/pg-sdk-node');
      const sdkRequire = createRequire(sdkEntryPoint);
      resolvedModules.add(sdkRequire.resolve('class-transformer'));
    } catch {
      // ignore
    }

    for (const modulePath of resolvedModules) {
      try {
        const moduleExports = requireFn(modulePath) as Record<string, unknown>;
        patchModule(moduleExports);
      } catch {
        // ignore individual resolution failures
      }
    }
  } catch {
    // Best-effort compatibility shim only.
  }
}
