/**
 * Detects @Cron / @Interval / @Timeout classes that @nestjs/schedule registers more than once
 * (pure, no Nest imports so it can be unit tested in isolation).
 *
 * @nestjs/schedule's explorer walks every provider wrapper, alias wrappers included
 * (`{ provide: 'X_SERVICE', useExisting: XService }`), and registers the scheduled methods of each
 * wrapper's instance. An aliased class therefore gets every job registered twice: each tick runs
 * twice, and a locked job logs "lock held by another replica" on a single worker. The worker
 * calls this at boot and logs the offenders.
 */

/** @nestjs/schedule's method metadata key (schedule.constants SCHEDULER_TYPE). */
export const SCHEDULER_TYPE_METADATA_KEY = 'SCHEDULER_TYPE';

export interface ProviderWrapperLike {
  readonly instance?: unknown;
  readonly isAlias?: boolean;
}

export interface DuplicateScheduler {
  readonly className: string;
  /** Number of provider wrappers (class + aliases) that expose this instance. */
  readonly registrations: number;
  readonly methods: readonly string[];
}

/** Method names (own and inherited, excluding Object.prototype) that carry scheduler metadata. */
export function scheduledMethodNames(
  instance: object,
  getMetadata: (fn: unknown) => unknown
): string[] {
  const names = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(instance) as object | null;
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (descriptor && typeof descriptor.value === 'function' && getMetadata(descriptor.value)) {
        names.add(name);
      }
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return [...names];
}

/** Every scheduled instance reachable through more than one wrapper, i.e. registered N times. */
export function findDuplicateSchedulers(
  wrappers: readonly ProviderWrapperLike[],
  getMetadata: (fn: unknown) => unknown
): DuplicateScheduler[] {
  const counts = new Map<object, number>();
  for (const wrapper of wrappers) {
    const instance = wrapper.instance;
    if (instance === null || typeof instance !== 'object') continue;
    counts.set(instance, (counts.get(instance) ?? 0) + 1);
  }
  const duplicates: DuplicateScheduler[] = [];
  for (const [instance, registrations] of counts) {
    if (registrations < 2) continue;
    const methods = scheduledMethodNames(instance, getMetadata);
    if (methods.length === 0) continue;
    const ctor = (instance as { constructor?: { name?: unknown } }).constructor;
    const className = typeof ctor?.name === 'string' && ctor.name ? ctor.name : 'anonymous';
    duplicates.push({ className, registrations, methods });
  }
  return duplicates;
}
