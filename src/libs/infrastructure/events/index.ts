// Events infrastructure exports
export * from './events.module';
export * from './event.service';

// Import EventService for helper function
import { EventService } from './event.service';

// Helper function to get EventService token for forwardRef (avoids type resolution issues)
// This should be used when injecting EventService with forwardRef to prevent circular dependency type errors
export function getEventServiceToken(): typeof EventService {
  return EventService;
}
