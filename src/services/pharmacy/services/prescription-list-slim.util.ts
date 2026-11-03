/**
 * Slim row of the PAGED prescription list (GET /pharmacy/prescriptions?page=), pure.
 *
 * A paged row used to carry the full nested records (doctor row + user, patient row + user,
 * every medicine column of every item, full payment rows with gateway metadata, the draft
 * snapshot): ~7 kB per row under load. The two paged clients (web doctor list, mobile pharmacy
 * desk) only read the computed top-level fields plus a handful of nested ones, so the nested
 * objects are reduced to exactly those (keys absent on the source stay absent). Single reads
 * (GET /pharmacy/prescriptions/:id) and the legacy array keep the full shape.
 *
 * Nested fields kept (what the clients read):
 * - patient: id, userId, name, firstName, lastName, uhid; patient.user: id, name, firstName,
 *   lastName, phone
 * - doctor: id, name; doctor.user: id, name
 * - location: id, name
 * - items[]: line columns + dispense history; items[].medicine: id, name, price, stock,
 *   stockQuantity, unit
 * - payments[]: id, amount, status, method, createdAt, updatedAt; metadata: paymentMethod,
 *   collectedAt
 */

type Row = Readonly<Record<string, unknown>>;

const PATIENT_KEYS = ['id', 'userId', 'name', 'firstName', 'lastName', 'uhid'] as const;
const PERSON_USER_KEYS = ['id', 'name', 'firstName', 'lastName', 'phone'] as const;
const DOCTOR_KEYS = ['id', 'name'] as const;
const DOCTOR_USER_KEYS = ['id', 'name'] as const;
const LOCATION_KEYS = ['id', 'name'] as const;
const ITEM_KEYS = [
  'id',
  'prescriptionItemId',
  'prescriptionId',
  'medicineId',
  'name',
  'medicineName',
  'dosage',
  'frequency',
  'duration',
  'instructions',
  'quantity',
  'dispensedQuantity',
  'currentStock',
  'dispensedBatchNumber',
  'dispensedAt',
  'dispenseEventHistory',
  'dispenseBatchHistory',
] as const;
const MEDICINE_KEYS = ['id', 'name', 'price', 'stock', 'stockQuantity', 'unit'] as const;
const PAYMENT_KEYS = ['id', 'amount', 'status', 'method', 'createdAt', 'updatedAt'] as const;
const PAYMENT_METADATA_KEYS = ['paymentMethod', 'collectedAt'] as const;
/** Top-level fields no paged client reads and that can be large. */
const DROPPED_ROW_KEYS: ReadonlySet<string> = new Set(['draftSnapshot']);

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The listed keys that exist on `source` (values unchanged). */
function pick(source: Row, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) out[key] = source[key];
  }
  return out;
}

/** `pick` plus a nested record reduced the same way (null / non-record kept as is). */
function pickWith(
  source: unknown,
  keys: readonly string[],
  nested?: { readonly key: string; readonly keys: readonly string[] }
): unknown {
  if (!isRecord(source)) return source;
  const out = pick(source, keys);
  if (nested && nested.key in source) {
    const inner = source[nested.key];
    out[nested.key] = isRecord(inner) ? pick(inner, nested.keys) : inner;
  }
  return out;
}

function slimList(value: unknown, slimOne: (entry: unknown) => unknown): unknown {
  return Array.isArray(value) ? value.map(slimOne) : value;
}

function slimItem(item: unknown): unknown {
  return pickWith(item, ITEM_KEYS, { key: 'medicine', keys: MEDICINE_KEYS });
}

function slimPayment(payment: unknown): unknown {
  return pickWith(payment, PAYMENT_KEYS, { key: 'metadata', keys: PAYMENT_METADATA_KEYS });
}

/** The paged-list row: every top-level field but the dropped ones, nested objects reduced. */
export function toSlimPrescriptionListRow<T extends object>(row: T): T {
  if (!isRecord(row)) return row;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (DROPPED_ROW_KEYS.has(key)) continue;
    switch (key) {
      case 'patient':
        out[key] = pickWith(value, PATIENT_KEYS, { key: 'user', keys: PERSON_USER_KEYS });
        break;
      case 'doctor':
        out[key] = pickWith(value, DOCTOR_KEYS, { key: 'user', keys: DOCTOR_USER_KEYS });
        break;
      case 'location':
        out[key] = pickWith(value, LOCATION_KEYS);
        break;
      case 'items':
        out[key] = slimList(value, slimItem);
        break;
      case 'payments':
        out[key] = slimList(value, slimPayment);
        break;
      default:
        out[key] = value;
    }
  }
  return out as T;
}
