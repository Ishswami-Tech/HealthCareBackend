/**
 * The business payload of a queue job.
 *
 * `QueueService.addJob` stores every job as a canonical envelope
 * `{ jobType, priority, domain, action, data: <payload>, metadata }`, while older producers (and
 * BullMQ jobs added directly) put the payload at the top level. Processors that destructured
 * `job.data` read the envelope instead of the payload, so `clinicId` / `doctorId` were undefined
 * and the appointment queue jobs ran against `queue:clinic:undefined:undefined`.
 *
 * Rule: the nested `data` object when there is one (`job.data.data ?? job.data`), with the
 * envelope's `action` kept as the routing action (it is what `addJob` was called with). Envelope
 * keys the payload does not carry (domain, tenantId, ...) stay available as a fallback.
 */
import type { JobData } from '@core/types/queue.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveJobPayload(data: unknown): JobData {
  if (!isRecord(data)) return {};
  const nested = data['data'];
  if (!isRecord(nested)) return data as JobData;
  const { data: _payload, ...envelope } = data;
  const envelopeAction = envelope['action'];
  return {
    ...envelope,
    ...nested,
    ...(typeof envelopeAction === 'string' && envelopeAction ? { action: envelopeAction } : {}),
  } as JobData;
}
