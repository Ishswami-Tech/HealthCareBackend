// Events infrastructure exports
export * from './events.module';
export * from './event.service';

// Import EventService for helper function
import { EventService } from './event.service';

/**
 * @deprecated Use `forwardRef(() => EventService)` directly instead.
 * This helper function is no longer needed - you can use `@Inject(forwardRef(() => EventService))` just like other services.
 * Kept for backward compatibility only.
 */
export function getEventServiceToken(): typeof EventService {
  return EventService;
}
