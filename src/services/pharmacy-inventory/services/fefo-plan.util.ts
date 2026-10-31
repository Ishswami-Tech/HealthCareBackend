/**
 * FEFO batch allocation plan (pure, no Nest imports).
 *
 * The dispense dialog pre-fills the server's earliest-expiry batch; the pharmacist may pick a
 * different one ("Change batch"). A chosen batch is honoured, never silently replaced by FEFO:
 * it must belong to the medicine (it is one of the medicine's batches with stock on hand), must
 * not be expired and must hold enough units. Whatever the chosen batches do not cover is taken
 * earliest expiry first from the other non-expired batches.
 */

export interface FefoPlanBatch {
  readonly id: string;
  readonly lotNumber: string;
  readonly expiryDate: Date;
  readonly quantityOnHand: number | null;
}

export interface FefoPreferredLot {
  readonly lotNumber: string;
  readonly quantity: number;
}

export interface FefoPlanTake {
  readonly batch: FefoPlanBatch;
  readonly quantity: number;
}

export type FefoPlanRefusalCode = 'BATCH_NOT_FOUND' | 'BATCH_EXPIRED' | 'BATCH_SHORT';

export interface FefoPlanRefusal {
  readonly code: FefoPlanRefusalCode;
  readonly lotNumber: string;
  readonly message: string;
}

export type FefoPlanResult =
  | {
      readonly ok: true;
      readonly takes: readonly FefoPlanTake[];
      /** Units no batch covered (taken from legacy un-batched stock when available). */
      readonly remaining: number;
    }
  | { readonly ok: false; readonly refusal: FefoPlanRefusal };

function normaliseLot(lotNumber: string): string {
  return lotNumber.trim().toUpperCase();
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Collapse repeated lots and drop empty / non-positive entries. */
export function normalisePreferredLots(
  lots: ReadonlyArray<{ lotNumber?: string | null; quantity?: number | null }> | undefined
): FefoPreferredLot[] {
  const merged = new Map<string, FefoPreferredLot>();
  for (const lot of lots ?? []) {
    const lotNumber = typeof lot.lotNumber === 'string' ? lot.lotNumber.trim() : '';
    const quantity = Number(lot.quantity ?? 0);
    if (!lotNumber || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    const key = normaliseLot(lotNumber);
    const current = merged.get(key);
    merged.set(key, {
      lotNumber: current?.lotNumber ?? lotNumber,
      quantity: (current?.quantity ?? 0) + quantity,
    });
  }
  return Array.from(merged.values());
}

/**
 * Plans which batches a dispense of `quantity` units consumes.
 *
 * @param batches - The medicine's batches with stock on hand (any order)
 * @param quantity - Units to dispense
 * @param preferredLots - Batches the pharmacist chose, with the units to take from each
 * @param nowMs - Current time (batches expiring at or before it are expired)
 */
export function planFefoConsumption(
  batches: readonly FefoPlanBatch[],
  quantity: number,
  preferredLots: readonly FefoPreferredLot[],
  nowMs: number
): FefoPlanResult {
  const byLot = new Map(batches.map(batch => [normaliseLot(batch.lotNumber), batch] as const));
  const takenByBatchId = new Map<string, number>();
  const takes: FefoPlanTake[] = [];
  let remaining = quantity;

  for (const preferred of preferredLots) {
    if (remaining <= 0) break;
    const batch = byLot.get(normaliseLot(preferred.lotNumber));
    if (!batch) {
      return {
        ok: false,
        refusal: {
          code: 'BATCH_NOT_FOUND',
          lotNumber: preferred.lotNumber,
          message: `Batch ${preferred.lotNumber} is not in stock for this medicine. Pick one of the listed batches.`,
        },
      };
    }
    if (batch.expiryDate.getTime() <= nowMs) {
      return {
        ok: false,
        refusal: {
          code: 'BATCH_EXPIRED',
          lotNumber: batch.lotNumber,
          message: `Batch ${batch.lotNumber} expired on ${isoDay(batch.expiryDate)} and cannot be dispensed.`,
        },
      };
    }
    const want = Math.min(preferred.quantity, remaining);
    const onHand = batch.quantityOnHand ?? 0;
    if (want > onHand) {
      return {
        ok: false,
        refusal: {
          code: 'BATCH_SHORT',
          lotNumber: batch.lotNumber,
          message: `Batch ${batch.lotNumber} has only ${onHand} on hand, ${want} requested.`,
        },
      };
    }
    takes.push({ batch, quantity: want });
    takenByBatchId.set(batch.id, want);
    remaining -= want;
  }

  const fefoOrder = [...batches].sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
  for (const batch of fefoOrder) {
    if (remaining <= 0) break;
    if (batch.expiryDate.getTime() <= nowMs) continue;
    const available = (batch.quantityOnHand ?? 0) - (takenByBatchId.get(batch.id) ?? 0);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    takes.push({ batch, quantity: take });
    takenByBatchId.set(batch.id, (takenByBatchId.get(batch.id) ?? 0) + take);
    remaining -= take;
  }

  return { ok: true, takes: mergeTakesByBatch(takes), remaining };
}

/** One take per batch (a chosen batch topped up by the FEFO pass is one decrement). */
function mergeTakesByBatch(takes: readonly FefoPlanTake[]): FefoPlanTake[] {
  const merged = new Map<string, FefoPlanTake>();
  for (const take of takes) {
    const current = merged.get(take.batch.id);
    merged.set(take.batch.id, {
      batch: take.batch,
      quantity: (current?.quantity ?? 0) + take.quantity,
    });
  }
  return Array.from(merged.values());
}
