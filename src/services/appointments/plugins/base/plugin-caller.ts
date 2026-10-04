/**
 * Identity of whoever triggered a plugin operation.
 *
 * Plugin operations arrive as free-form request data, so any identity a client writes into that
 * data (`userId`, `userRole`, ...) is untrusted. The plugin controller therefore attaches the
 * authenticated caller under the reserved `caller` key (overwriting anything the client sent),
 * and plugins that make authorization or audit decisions read it with `parsePluginCaller`.
 */
export interface PluginCaller {
  /** Authenticated user id (from the JWT). */
  readonly userId: string;
  /** Platform role (from the JWT), for example CLINIC_ADMIN. */
  readonly role: string;
}

/** Reserved key the plugin controller writes the authenticated caller to. */
export const PLUGIN_CALLER_KEY = 'caller';

/** Narrow an untrusted value to a PluginCaller, or undefined when it is not one. */
export function parsePluginCaller(value: unknown): PluginCaller | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as { userId?: unknown; role?: unknown };
  if (
    typeof candidate.userId !== 'string' ||
    candidate.userId.length === 0 ||
    typeof candidate.role !== 'string' ||
    candidate.role.length === 0
  ) {
    return undefined;
  }
  return { userId: candidate.userId, role: candidate.role };
}

/**
 * The acting user of a plugin operation: the controller-bound `caller` when present, otherwise
 * the `userId` + `userRole` pair an internal (server-side) caller supplied. Undefined when the
 * operation carries no usable identity.
 */
export function resolvePluginActor(data: {
  caller?: unknown;
  userId?: unknown;
  userRole?: unknown;
}): PluginCaller | undefined {
  const bound = parsePluginCaller(data.caller);
  if (bound) {
    return bound;
  }
  return parsePluginCaller({ userId: data.userId, role: data.userRole });
}
