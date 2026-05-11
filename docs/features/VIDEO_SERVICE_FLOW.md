# Video Service Flow

The backend exposes one `video` service layer and selects provider adapters
behind the scenes.

## Current Behavior

- The frontend requests a video session from the backend.
- The backend decides which provider to use.
- The backend returns a join payload or URL.
- The frontend opens the join destination.

## Provider Strategy

1. Cloudflare Realtime
2. Daily
3. Google Meet

## Fallback

- If a provider fails during room creation or token generation, the backend
  falls back to the next provider.
- If all providers fail, the UI shows a graceful unavailable state.

## Notes
