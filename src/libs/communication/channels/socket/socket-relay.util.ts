/**
 * Socket payload types and the worker -> API emit relay message format.
 * Pure module (no Nest / socket.io imports) so it can be unit tested in isolation.
 */

export type SocketEventPrimitive = string | number | boolean | null;
export type SocketEventData = Record<
  string,
  SocketEventPrimitive | SocketEventPrimitive[] | Record<string, SocketEventPrimitive>
>;

/**
 * Pub/sub channel carrying socket emits from processes without a Socket.IO server (the
 * queue/cron worker) to the API processes that own the client connections.
 */
export const SOCKET_RELAY_CHANNEL = 'socket:relay:v1';

const MAX_RELAY_ROOMS = 100;
const MAX_RELAY_ROOM_NAME = 256;
const MAX_RELAY_EVENT_NAME = 128;

/** Internal event used to confirm a relay subscription is live. Never delivered to clients. */
export const SOCKET_RELAY_PING_EVENT = '__socket_relay_ping__';

export interface SocketRelayMessage {
  /** Unique id: receivers drop repeats (e.g. if a retry left two subscribers). */
  id?: string;
  /** Target rooms; `null` means every connected client. */
  rooms: string[] | null;
  event: string;
  data: SocketEventData;
}

function isValidRoomList(rooms: unknown): rooms is string[] {
  return (
    Array.isArray(rooms) &&
    rooms.length > 0 &&
    rooms.length <= MAX_RELAY_ROOMS &&
    rooms.every(
      room => typeof room === 'string' && room.length > 0 && room.length <= MAX_RELAY_ROOM_NAME
    )
  );
}

/** Parse and validate a relay message. Returns null for anything malformed. */
export function parseSocketRelayMessage(raw: string): SocketRelayMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const event = record['event'];
  const data = record['data'];
  const rooms = record['rooms'];
  if (typeof event !== 'string' || event.length === 0 || event.length > MAX_RELAY_EVENT_NAME) {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const rawId = record['id'];
  const idPart =
    typeof rawId === 'string' && rawId.length > 0 && rawId.length <= 64 ? { id: rawId } : {};
  if (rooms === null) {
    return { ...idPart, rooms: null, event, data: data as SocketEventData };
  }
  if (!isValidRoomList(rooms)) {
    return null;
  }
  return { ...idPart, rooms, event, data: data as SocketEventData };
}
