
/**
 * Client
**/

import * as runtime from './runtime/binary.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model Patient
 * 
 */
export type Patient = $Result.DefaultSelection<Prisma.$PatientPayload>
/**
 * Model Doctor
 * 
 */
export type Doctor = $Result.DefaultSelection<Prisma.$DoctorPayload>
/**
 * Model DoctorLocation
 * 
 */
export type DoctorLocation = $Result.DefaultSelection<Prisma.$DoctorLocationPayload>
/**
 * Model Location
 * 
 */
export type Location = $Result.DefaultSelection<Prisma.$LocationPayload>
/**
 * Model Appointment
 * 
 */
export type Appointment = $Result.DefaultSelection<Prisma.$AppointmentPayload>
/**
 * Model Therapy
 * 
 */
export type Therapy = $Result.DefaultSelection<Prisma.$TherapyPayload>
/**
 * Model Payment
 * 
 */
export type Payment = $Result.DefaultSelection<Prisma.$PaymentPayload>
/**
 * Model QueueItem
 * 
 */
export type QueueItem = $Result.DefaultSelection<Prisma.$QueueItemPayload>
/**
 * Model Prescription
 * 
 */
export type Prescription = $Result.DefaultSelection<Prisma.$PrescriptionPayload>
/**
 * Model PrescriptionItem
 * 
 */
export type PrescriptionItem = $Result.DefaultSelection<Prisma.$PrescriptionItemPayload>
/**
 * Model Medicine
 * 
 */
export type Medicine = $Result.DefaultSelection<Prisma.$MedicinePayload>
/**
 * Model HealthRecord
 * 
 */
export type HealthRecord = $Result.DefaultSelection<Prisma.$HealthRecordPayload>
/**
 * Model Review
 * 
 */
export type Review = $Result.DefaultSelection<Prisma.$ReviewPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const AppointmentStatus: {
  PENDING: 'PENDING',
  SCHEDULED: 'SCHEDULED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW'
};

export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus]


export const AppointmentType: {
  IN_PERSON: 'IN_PERSON',
  VIDEO_CALL: 'VIDEO_CALL',
  HOME_VISIT: 'HOME_VISIT'
};

export type AppointmentType = (typeof AppointmentType)[keyof typeof AppointmentType]


export const PaymentStatus: {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED'
};

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus]


export const PaymentMethod: {
  CASH: 'CASH',
  CARD: 'CARD',
  UPI: 'UPI',
  NET_BANKING: 'NET_BANKING'
};

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod]


export const QueueStatus: {
  WAITING: 'WAITING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED'
};

export type QueueStatus = (typeof QueueStatus)[keyof typeof QueueStatus]


export const HealthRecordType: {
  LAB_TEST: 'LAB_TEST',
  XRAY: 'XRAY',
  MRI: 'MRI',
  PRESCRIPTION: 'PRESCRIPTION',
  DIAGNOSIS_REPORT: 'DIAGNOSIS_REPORT',
  PULSE_DIAGNOSIS: 'PULSE_DIAGNOSIS'
};

export type HealthRecordType = (typeof HealthRecordType)[keyof typeof HealthRecordType]


export const Dosha: {
  VATA: 'VATA',
  PITTA: 'PITTA',
  KAPHA: 'KAPHA'
};

export type Dosha = (typeof Dosha)[keyof typeof Dosha]


export const Prakriti: {
  VATA: 'VATA',
  PITTA: 'PITTA',
  KAPHA: 'KAPHA',
  VATA_PITTA: 'VATA_PITTA',
  PITTA_KAPHA: 'PITTA_KAPHA',
  VATA_KAPHA: 'VATA_KAPHA',
  TRIDOSHA: 'TRIDOSHA'
};

export type Prakriti = (typeof Prakriti)[keyof typeof Prakriti]

}

export type AppointmentStatus = $Enums.AppointmentStatus

export const AppointmentStatus: typeof $Enums.AppointmentStatus

export type AppointmentType = $Enums.AppointmentType

export const AppointmentType: typeof $Enums.AppointmentType

export type PaymentStatus = $Enums.PaymentStatus

export const PaymentStatus: typeof $Enums.PaymentStatus

export type PaymentMethod = $Enums.PaymentMethod

export const PaymentMethod: typeof $Enums.PaymentMethod

export type QueueStatus = $Enums.QueueStatus

export const QueueStatus: typeof $Enums.QueueStatus

export type HealthRecordType = $Enums.HealthRecordType

export const HealthRecordType: typeof $Enums.HealthRecordType

export type Dosha = $Enums.Dosha

export const Dosha: typeof $Enums.Dosha

export type Prakriti = $Enums.Prakriti

export const Prakriti: typeof $Enums.Prakriti

/**
 * ##  Prisma Client ʲˢ
 *
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Patients
 * const patients = await prisma.patient.findMany()
 * ```
 *
 *
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   *
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Patients
   * const patients = await prisma.patient.findMany()
   * ```
   *
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends (U | 'beforeExit')>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : V extends 'beforeExit' ? () => $Utils.JsPromise<void> : Prisma.LogEvent) => void): PrismaClient;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb<ClientOptions>, ExtArgs, $Utils.Call<Prisma.TypeMapCb<ClientOptions>, {
    extArgs: ExtArgs
  }>>

      /**
   * `prisma.patient`: Exposes CRUD operations for the **Patient** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Patients
    * const patients = await prisma.patient.findMany()
    * ```
    */
  get patient(): Prisma.PatientDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.doctor`: Exposes CRUD operations for the **Doctor** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Doctors
    * const doctors = await prisma.doctor.findMany()
    * ```
    */
  get doctor(): Prisma.DoctorDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.doctorLocation`: Exposes CRUD operations for the **DoctorLocation** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more DoctorLocations
    * const doctorLocations = await prisma.doctorLocation.findMany()
    * ```
    */
  get doctorLocation(): Prisma.DoctorLocationDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.location`: Exposes CRUD operations for the **Location** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Locations
    * const locations = await prisma.location.findMany()
    * ```
    */
  get location(): Prisma.LocationDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.appointment`: Exposes CRUD operations for the **Appointment** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Appointments
    * const appointments = await prisma.appointment.findMany()
    * ```
    */
  get appointment(): Prisma.AppointmentDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.therapy`: Exposes CRUD operations for the **Therapy** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Therapies
    * const therapies = await prisma.therapy.findMany()
    * ```
    */
  get therapy(): Prisma.TherapyDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.payment`: Exposes CRUD operations for the **Payment** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Payments
    * const payments = await prisma.payment.findMany()
    * ```
    */
  get payment(): Prisma.PaymentDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.queueItem`: Exposes CRUD operations for the **QueueItem** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more QueueItems
    * const queueItems = await prisma.queueItem.findMany()
    * ```
    */
  get queueItem(): Prisma.QueueItemDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.prescription`: Exposes CRUD operations for the **Prescription** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Prescriptions
    * const prescriptions = await prisma.prescription.findMany()
    * ```
    */
  get prescription(): Prisma.PrescriptionDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.prescriptionItem`: Exposes CRUD operations for the **PrescriptionItem** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PrescriptionItems
    * const prescriptionItems = await prisma.prescriptionItem.findMany()
    * ```
    */
  get prescriptionItem(): Prisma.PrescriptionItemDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.medicine`: Exposes CRUD operations for the **Medicine** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Medicines
    * const medicines = await prisma.medicine.findMany()
    * ```
    */
  get medicine(): Prisma.MedicineDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.healthRecord`: Exposes CRUD operations for the **HealthRecord** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more HealthRecords
    * const healthRecords = await prisma.healthRecord.findMany()
    * ```
    */
  get healthRecord(): Prisma.HealthRecordDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.review`: Exposes CRUD operations for the **Review** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Reviews
    * const reviews = await prisma.review.findMany()
    * ```
    */
  get review(): Prisma.ReviewDelegate<ExtArgs, ClientOptions>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 6.6.0
   * Query Engine version: f676762280b54cd07c770017ed3711ddde35f37a
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? P : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    Patient: 'Patient',
    Doctor: 'Doctor',
    DoctorLocation: 'DoctorLocation',
    Location: 'Location',
    Appointment: 'Appointment',
    Therapy: 'Therapy',
    Payment: 'Payment',
    QueueItem: 'QueueItem',
    Prescription: 'Prescription',
    PrescriptionItem: 'PrescriptionItem',
    Medicine: 'Medicine',
    HealthRecord: 'HealthRecord',
    Review: 'Review'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb<ClientOptions = {}> extends $Utils.Fn<{extArgs: $Extensions.InternalArgs }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], ClientOptions extends { omit: infer OmitOptions } ? OmitOptions : {}>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> = {
    globalOmitOptions: {
      omit: GlobalOmitOptions
    }
    meta: {
      modelProps: "patient" | "doctor" | "doctorLocation" | "location" | "appointment" | "therapy" | "payment" | "queueItem" | "prescription" | "prescriptionItem" | "medicine" | "healthRecord" | "review"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Patient: {
        payload: Prisma.$PatientPayload<ExtArgs>
        fields: Prisma.PatientFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PatientFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PatientFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload>
          }
          findFirst: {
            args: Prisma.PatientFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PatientFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload>
          }
          findMany: {
            args: Prisma.PatientFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload>[]
          }
          create: {
            args: Prisma.PatientCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload>
          }
          createMany: {
            args: Prisma.PatientCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PatientCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload>[]
          }
          delete: {
            args: Prisma.PatientDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload>
          }
          update: {
            args: Prisma.PatientUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload>
          }
          deleteMany: {
            args: Prisma.PatientDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PatientUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.PatientUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload>[]
          }
          upsert: {
            args: Prisma.PatientUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PatientPayload>
          }
          aggregate: {
            args: Prisma.PatientAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePatient>
          }
          groupBy: {
            args: Prisma.PatientGroupByArgs<ExtArgs>
            result: $Utils.Optional<PatientGroupByOutputType>[]
          }
          count: {
            args: Prisma.PatientCountArgs<ExtArgs>
            result: $Utils.Optional<PatientCountAggregateOutputType> | number
          }
        }
      }
      Doctor: {
        payload: Prisma.$DoctorPayload<ExtArgs>
        fields: Prisma.DoctorFieldRefs
        operations: {
          findUnique: {
            args: Prisma.DoctorFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.DoctorFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload>
          }
          findFirst: {
            args: Prisma.DoctorFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.DoctorFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload>
          }
          findMany: {
            args: Prisma.DoctorFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload>[]
          }
          create: {
            args: Prisma.DoctorCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload>
          }
          createMany: {
            args: Prisma.DoctorCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.DoctorCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload>[]
          }
          delete: {
            args: Prisma.DoctorDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload>
          }
          update: {
            args: Prisma.DoctorUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload>
          }
          deleteMany: {
            args: Prisma.DoctorDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.DoctorUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.DoctorUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload>[]
          }
          upsert: {
            args: Prisma.DoctorUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorPayload>
          }
          aggregate: {
            args: Prisma.DoctorAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateDoctor>
          }
          groupBy: {
            args: Prisma.DoctorGroupByArgs<ExtArgs>
            result: $Utils.Optional<DoctorGroupByOutputType>[]
          }
          count: {
            args: Prisma.DoctorCountArgs<ExtArgs>
            result: $Utils.Optional<DoctorCountAggregateOutputType> | number
          }
        }
      }
      DoctorLocation: {
        payload: Prisma.$DoctorLocationPayload<ExtArgs>
        fields: Prisma.DoctorLocationFieldRefs
        operations: {
          findUnique: {
            args: Prisma.DoctorLocationFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.DoctorLocationFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload>
          }
          findFirst: {
            args: Prisma.DoctorLocationFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.DoctorLocationFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload>
          }
          findMany: {
            args: Prisma.DoctorLocationFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload>[]
          }
          create: {
            args: Prisma.DoctorLocationCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload>
          }
          createMany: {
            args: Prisma.DoctorLocationCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.DoctorLocationCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload>[]
          }
          delete: {
            args: Prisma.DoctorLocationDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload>
          }
          update: {
            args: Prisma.DoctorLocationUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload>
          }
          deleteMany: {
            args: Prisma.DoctorLocationDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.DoctorLocationUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.DoctorLocationUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload>[]
          }
          upsert: {
            args: Prisma.DoctorLocationUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DoctorLocationPayload>
          }
          aggregate: {
            args: Prisma.DoctorLocationAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateDoctorLocation>
          }
          groupBy: {
            args: Prisma.DoctorLocationGroupByArgs<ExtArgs>
            result: $Utils.Optional<DoctorLocationGroupByOutputType>[]
          }
          count: {
            args: Prisma.DoctorLocationCountArgs<ExtArgs>
            result: $Utils.Optional<DoctorLocationCountAggregateOutputType> | number
          }
        }
      }
      Location: {
        payload: Prisma.$LocationPayload<ExtArgs>
        fields: Prisma.LocationFieldRefs
        operations: {
          findUnique: {
            args: Prisma.LocationFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.LocationFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload>
          }
          findFirst: {
            args: Prisma.LocationFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.LocationFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload>
          }
          findMany: {
            args: Prisma.LocationFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload>[]
          }
          create: {
            args: Prisma.LocationCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload>
          }
          createMany: {
            args: Prisma.LocationCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.LocationCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload>[]
          }
          delete: {
            args: Prisma.LocationDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload>
          }
          update: {
            args: Prisma.LocationUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload>
          }
          deleteMany: {
            args: Prisma.LocationDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.LocationUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.LocationUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload>[]
          }
          upsert: {
            args: Prisma.LocationUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocationPayload>
          }
          aggregate: {
            args: Prisma.LocationAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateLocation>
          }
          groupBy: {
            args: Prisma.LocationGroupByArgs<ExtArgs>
            result: $Utils.Optional<LocationGroupByOutputType>[]
          }
          count: {
            args: Prisma.LocationCountArgs<ExtArgs>
            result: $Utils.Optional<LocationCountAggregateOutputType> | number
          }
        }
      }
      Appointment: {
        payload: Prisma.$AppointmentPayload<ExtArgs>
        fields: Prisma.AppointmentFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AppointmentFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AppointmentFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload>
          }
          findFirst: {
            args: Prisma.AppointmentFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AppointmentFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload>
          }
          findMany: {
            args: Prisma.AppointmentFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload>[]
          }
          create: {
            args: Prisma.AppointmentCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload>
          }
          createMany: {
            args: Prisma.AppointmentCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AppointmentCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload>[]
          }
          delete: {
            args: Prisma.AppointmentDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload>
          }
          update: {
            args: Prisma.AppointmentUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload>
          }
          deleteMany: {
            args: Prisma.AppointmentDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AppointmentUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.AppointmentUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload>[]
          }
          upsert: {
            args: Prisma.AppointmentUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppointmentPayload>
          }
          aggregate: {
            args: Prisma.AppointmentAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAppointment>
          }
          groupBy: {
            args: Prisma.AppointmentGroupByArgs<ExtArgs>
            result: $Utils.Optional<AppointmentGroupByOutputType>[]
          }
          count: {
            args: Prisma.AppointmentCountArgs<ExtArgs>
            result: $Utils.Optional<AppointmentCountAggregateOutputType> | number
          }
        }
      }
      Therapy: {
        payload: Prisma.$TherapyPayload<ExtArgs>
        fields: Prisma.TherapyFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TherapyFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TherapyFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload>
          }
          findFirst: {
            args: Prisma.TherapyFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TherapyFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload>
          }
          findMany: {
            args: Prisma.TherapyFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload>[]
          }
          create: {
            args: Prisma.TherapyCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload>
          }
          createMany: {
            args: Prisma.TherapyCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TherapyCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload>[]
          }
          delete: {
            args: Prisma.TherapyDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload>
          }
          update: {
            args: Prisma.TherapyUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload>
          }
          deleteMany: {
            args: Prisma.TherapyDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TherapyUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.TherapyUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload>[]
          }
          upsert: {
            args: Prisma.TherapyUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TherapyPayload>
          }
          aggregate: {
            args: Prisma.TherapyAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTherapy>
          }
          groupBy: {
            args: Prisma.TherapyGroupByArgs<ExtArgs>
            result: $Utils.Optional<TherapyGroupByOutputType>[]
          }
          count: {
            args: Prisma.TherapyCountArgs<ExtArgs>
            result: $Utils.Optional<TherapyCountAggregateOutputType> | number
          }
        }
      }
      Payment: {
        payload: Prisma.$PaymentPayload<ExtArgs>
        fields: Prisma.PaymentFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PaymentFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PaymentFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload>
          }
          findFirst: {
            args: Prisma.PaymentFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PaymentFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload>
          }
          findMany: {
            args: Prisma.PaymentFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload>[]
          }
          create: {
            args: Prisma.PaymentCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload>
          }
          createMany: {
            args: Prisma.PaymentCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PaymentCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload>[]
          }
          delete: {
            args: Prisma.PaymentDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload>
          }
          update: {
            args: Prisma.PaymentUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload>
          }
          deleteMany: {
            args: Prisma.PaymentDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PaymentUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.PaymentUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload>[]
          }
          upsert: {
            args: Prisma.PaymentUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PaymentPayload>
          }
          aggregate: {
            args: Prisma.PaymentAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePayment>
          }
          groupBy: {
            args: Prisma.PaymentGroupByArgs<ExtArgs>
            result: $Utils.Optional<PaymentGroupByOutputType>[]
          }
          count: {
            args: Prisma.PaymentCountArgs<ExtArgs>
            result: $Utils.Optional<PaymentCountAggregateOutputType> | number
          }
        }
      }
      QueueItem: {
        payload: Prisma.$QueueItemPayload<ExtArgs>
        fields: Prisma.QueueItemFieldRefs
        operations: {
          findUnique: {
            args: Prisma.QueueItemFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.QueueItemFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload>
          }
          findFirst: {
            args: Prisma.QueueItemFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.QueueItemFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload>
          }
          findMany: {
            args: Prisma.QueueItemFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload>[]
          }
          create: {
            args: Prisma.QueueItemCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload>
          }
          createMany: {
            args: Prisma.QueueItemCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.QueueItemCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload>[]
          }
          delete: {
            args: Prisma.QueueItemDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload>
          }
          update: {
            args: Prisma.QueueItemUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload>
          }
          deleteMany: {
            args: Prisma.QueueItemDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.QueueItemUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.QueueItemUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload>[]
          }
          upsert: {
            args: Prisma.QueueItemUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$QueueItemPayload>
          }
          aggregate: {
            args: Prisma.QueueItemAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateQueueItem>
          }
          groupBy: {
            args: Prisma.QueueItemGroupByArgs<ExtArgs>
            result: $Utils.Optional<QueueItemGroupByOutputType>[]
          }
          count: {
            args: Prisma.QueueItemCountArgs<ExtArgs>
            result: $Utils.Optional<QueueItemCountAggregateOutputType> | number
          }
        }
      }
      Prescription: {
        payload: Prisma.$PrescriptionPayload<ExtArgs>
        fields: Prisma.PrescriptionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PrescriptionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PrescriptionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload>
          }
          findFirst: {
            args: Prisma.PrescriptionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PrescriptionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload>
          }
          findMany: {
            args: Prisma.PrescriptionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload>[]
          }
          create: {
            args: Prisma.PrescriptionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload>
          }
          createMany: {
            args: Prisma.PrescriptionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PrescriptionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload>[]
          }
          delete: {
            args: Prisma.PrescriptionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload>
          }
          update: {
            args: Prisma.PrescriptionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload>
          }
          deleteMany: {
            args: Prisma.PrescriptionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PrescriptionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.PrescriptionUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload>[]
          }
          upsert: {
            args: Prisma.PrescriptionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionPayload>
          }
          aggregate: {
            args: Prisma.PrescriptionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePrescription>
          }
          groupBy: {
            args: Prisma.PrescriptionGroupByArgs<ExtArgs>
            result: $Utils.Optional<PrescriptionGroupByOutputType>[]
          }
          count: {
            args: Prisma.PrescriptionCountArgs<ExtArgs>
            result: $Utils.Optional<PrescriptionCountAggregateOutputType> | number
          }
        }
      }
      PrescriptionItem: {
        payload: Prisma.$PrescriptionItemPayload<ExtArgs>
        fields: Prisma.PrescriptionItemFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PrescriptionItemFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PrescriptionItemFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload>
          }
          findFirst: {
            args: Prisma.PrescriptionItemFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PrescriptionItemFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload>
          }
          findMany: {
            args: Prisma.PrescriptionItemFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload>[]
          }
          create: {
            args: Prisma.PrescriptionItemCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload>
          }
          createMany: {
            args: Prisma.PrescriptionItemCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PrescriptionItemCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload>[]
          }
          delete: {
            args: Prisma.PrescriptionItemDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload>
          }
          update: {
            args: Prisma.PrescriptionItemUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload>
          }
          deleteMany: {
            args: Prisma.PrescriptionItemDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PrescriptionItemUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.PrescriptionItemUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload>[]
          }
          upsert: {
            args: Prisma.PrescriptionItemUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrescriptionItemPayload>
          }
          aggregate: {
            args: Prisma.PrescriptionItemAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePrescriptionItem>
          }
          groupBy: {
            args: Prisma.PrescriptionItemGroupByArgs<ExtArgs>
            result: $Utils.Optional<PrescriptionItemGroupByOutputType>[]
          }
          count: {
            args: Prisma.PrescriptionItemCountArgs<ExtArgs>
            result: $Utils.Optional<PrescriptionItemCountAggregateOutputType> | number
          }
        }
      }
      Medicine: {
        payload: Prisma.$MedicinePayload<ExtArgs>
        fields: Prisma.MedicineFieldRefs
        operations: {
          findUnique: {
            args: Prisma.MedicineFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.MedicineFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload>
          }
          findFirst: {
            args: Prisma.MedicineFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.MedicineFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload>
          }
          findMany: {
            args: Prisma.MedicineFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload>[]
          }
          create: {
            args: Prisma.MedicineCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload>
          }
          createMany: {
            args: Prisma.MedicineCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.MedicineCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload>[]
          }
          delete: {
            args: Prisma.MedicineDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload>
          }
          update: {
            args: Prisma.MedicineUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload>
          }
          deleteMany: {
            args: Prisma.MedicineDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.MedicineUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.MedicineUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload>[]
          }
          upsert: {
            args: Prisma.MedicineUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MedicinePayload>
          }
          aggregate: {
            args: Prisma.MedicineAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateMedicine>
          }
          groupBy: {
            args: Prisma.MedicineGroupByArgs<ExtArgs>
            result: $Utils.Optional<MedicineGroupByOutputType>[]
          }
          count: {
            args: Prisma.MedicineCountArgs<ExtArgs>
            result: $Utils.Optional<MedicineCountAggregateOutputType> | number
          }
        }
      }
      HealthRecord: {
        payload: Prisma.$HealthRecordPayload<ExtArgs>
        fields: Prisma.HealthRecordFieldRefs
        operations: {
          findUnique: {
            args: Prisma.HealthRecordFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.HealthRecordFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload>
          }
          findFirst: {
            args: Prisma.HealthRecordFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.HealthRecordFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload>
          }
          findMany: {
            args: Prisma.HealthRecordFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload>[]
          }
          create: {
            args: Prisma.HealthRecordCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload>
          }
          createMany: {
            args: Prisma.HealthRecordCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.HealthRecordCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload>[]
          }
          delete: {
            args: Prisma.HealthRecordDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload>
          }
          update: {
            args: Prisma.HealthRecordUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload>
          }
          deleteMany: {
            args: Prisma.HealthRecordDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.HealthRecordUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.HealthRecordUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload>[]
          }
          upsert: {
            args: Prisma.HealthRecordUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HealthRecordPayload>
          }
          aggregate: {
            args: Prisma.HealthRecordAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateHealthRecord>
          }
          groupBy: {
            args: Prisma.HealthRecordGroupByArgs<ExtArgs>
            result: $Utils.Optional<HealthRecordGroupByOutputType>[]
          }
          count: {
            args: Prisma.HealthRecordCountArgs<ExtArgs>
            result: $Utils.Optional<HealthRecordCountAggregateOutputType> | number
          }
        }
      }
      Review: {
        payload: Prisma.$ReviewPayload<ExtArgs>
        fields: Prisma.ReviewFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ReviewFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ReviewFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload>
          }
          findFirst: {
            args: Prisma.ReviewFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ReviewFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload>
          }
          findMany: {
            args: Prisma.ReviewFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload>[]
          }
          create: {
            args: Prisma.ReviewCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload>
          }
          createMany: {
            args: Prisma.ReviewCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ReviewCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload>[]
          }
          delete: {
            args: Prisma.ReviewDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload>
          }
          update: {
            args: Prisma.ReviewUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload>
          }
          deleteMany: {
            args: Prisma.ReviewDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ReviewUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.ReviewUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload>[]
          }
          upsert: {
            args: Prisma.ReviewUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReviewPayload>
          }
          aggregate: {
            args: Prisma.ReviewAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateReview>
          }
          groupBy: {
            args: Prisma.ReviewGroupByArgs<ExtArgs>
            result: $Utils.Optional<ReviewGroupByOutputType>[]
          }
          count: {
            args: Prisma.ReviewCountArgs<ExtArgs>
            result: $Utils.Optional<ReviewCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
    /**
     * Global configuration for omitting model fields by default.
     * 
     * @example
     * ```
     * const prisma = new PrismaClient({
     *   omit: {
     *     user: {
     *       password: true
     *     }
     *   }
     * })
     * ```
     */
    omit?: Prisma.GlobalOmitConfig
  }
  export type GlobalOmitConfig = {
    patient?: PatientOmit
    doctor?: DoctorOmit
    doctorLocation?: DoctorLocationOmit
    location?: LocationOmit
    appointment?: AppointmentOmit
    therapy?: TherapyOmit
    payment?: PaymentOmit
    queueItem?: QueueItemOmit
    prescription?: PrescriptionOmit
    prescriptionItem?: PrescriptionItemOmit
    medicine?: MedicineOmit
    healthRecord?: HealthRecordOmit
    review?: ReviewOmit
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'updateManyAndReturn'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type PatientCountOutputType
   */

  export type PatientCountOutputType = {
    appointments: number
    healthRecords: number
    prescriptions: number
    reviews: number
  }

  export type PatientCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointments?: boolean | PatientCountOutputTypeCountAppointmentsArgs
    healthRecords?: boolean | PatientCountOutputTypeCountHealthRecordsArgs
    prescriptions?: boolean | PatientCountOutputTypeCountPrescriptionsArgs
    reviews?: boolean | PatientCountOutputTypeCountReviewsArgs
  }

  // Custom InputTypes
  /**
   * PatientCountOutputType without action
   */
  export type PatientCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PatientCountOutputType
     */
    select?: PatientCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * PatientCountOutputType without action
   */
  export type PatientCountOutputTypeCountAppointmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AppointmentWhereInput
  }

  /**
   * PatientCountOutputType without action
   */
  export type PatientCountOutputTypeCountHealthRecordsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: HealthRecordWhereInput
  }

  /**
   * PatientCountOutputType without action
   */
  export type PatientCountOutputTypeCountPrescriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PrescriptionWhereInput
  }

  /**
   * PatientCountOutputType without action
   */
  export type PatientCountOutputTypeCountReviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ReviewWhereInput
  }


  /**
   * Count Type DoctorCountOutputType
   */

  export type DoctorCountOutputType = {
    appointments: number
    healthRecords: number
    prescriptions: number
    reviews: number
    locations: number
  }

  export type DoctorCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointments?: boolean | DoctorCountOutputTypeCountAppointmentsArgs
    healthRecords?: boolean | DoctorCountOutputTypeCountHealthRecordsArgs
    prescriptions?: boolean | DoctorCountOutputTypeCountPrescriptionsArgs
    reviews?: boolean | DoctorCountOutputTypeCountReviewsArgs
    locations?: boolean | DoctorCountOutputTypeCountLocationsArgs
  }

  // Custom InputTypes
  /**
   * DoctorCountOutputType without action
   */
  export type DoctorCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorCountOutputType
     */
    select?: DoctorCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * DoctorCountOutputType without action
   */
  export type DoctorCountOutputTypeCountAppointmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AppointmentWhereInput
  }

  /**
   * DoctorCountOutputType without action
   */
  export type DoctorCountOutputTypeCountHealthRecordsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: HealthRecordWhereInput
  }

  /**
   * DoctorCountOutputType without action
   */
  export type DoctorCountOutputTypeCountPrescriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PrescriptionWhereInput
  }

  /**
   * DoctorCountOutputType without action
   */
  export type DoctorCountOutputTypeCountReviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ReviewWhereInput
  }

  /**
   * DoctorCountOutputType without action
   */
  export type DoctorCountOutputTypeCountLocationsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: DoctorLocationWhereInput
  }


  /**
   * Count Type LocationCountOutputType
   */

  export type LocationCountOutputType = {
    appointments: number
    doctors: number
  }

  export type LocationCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointments?: boolean | LocationCountOutputTypeCountAppointmentsArgs
    doctors?: boolean | LocationCountOutputTypeCountDoctorsArgs
  }

  // Custom InputTypes
  /**
   * LocationCountOutputType without action
   */
  export type LocationCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocationCountOutputType
     */
    select?: LocationCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * LocationCountOutputType without action
   */
  export type LocationCountOutputTypeCountAppointmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AppointmentWhereInput
  }

  /**
   * LocationCountOutputType without action
   */
  export type LocationCountOutputTypeCountDoctorsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: DoctorLocationWhereInput
  }


  /**
   * Count Type TherapyCountOutputType
   */

  export type TherapyCountOutputType = {
    appointments: number
  }

  export type TherapyCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointments?: boolean | TherapyCountOutputTypeCountAppointmentsArgs
  }

  // Custom InputTypes
  /**
   * TherapyCountOutputType without action
   */
  export type TherapyCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TherapyCountOutputType
     */
    select?: TherapyCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * TherapyCountOutputType without action
   */
  export type TherapyCountOutputTypeCountAppointmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AppointmentWhereInput
  }


  /**
   * Count Type PrescriptionCountOutputType
   */

  export type PrescriptionCountOutputType = {
    items: number
  }

  export type PrescriptionCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    items?: boolean | PrescriptionCountOutputTypeCountItemsArgs
  }

  // Custom InputTypes
  /**
   * PrescriptionCountOutputType without action
   */
  export type PrescriptionCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionCountOutputType
     */
    select?: PrescriptionCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * PrescriptionCountOutputType without action
   */
  export type PrescriptionCountOutputTypeCountItemsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PrescriptionItemWhereInput
  }


  /**
   * Count Type MedicineCountOutputType
   */

  export type MedicineCountOutputType = {
    prescriptionItems: number
  }

  export type MedicineCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    prescriptionItems?: boolean | MedicineCountOutputTypeCountPrescriptionItemsArgs
  }

  // Custom InputTypes
  /**
   * MedicineCountOutputType without action
   */
  export type MedicineCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MedicineCountOutputType
     */
    select?: MedicineCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * MedicineCountOutputType without action
   */
  export type MedicineCountOutputTypeCountPrescriptionItemsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PrescriptionItemWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Patient
   */

  export type AggregatePatient = {
    _count: PatientCountAggregateOutputType | null
    _min: PatientMinAggregateOutputType | null
    _max: PatientMaxAggregateOutputType | null
  }

  export type PatientMinAggregateOutputType = {
    id: string | null
    userId: string | null
    prakriti: $Enums.Prakriti | null
    dosha: $Enums.Dosha | null
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
    gender: string | null
    dateOfBirth: Date | null
    address: string | null
    city: string | null
    state: string | null
    country: string | null
    zipCode: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PatientMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    prakriti: $Enums.Prakriti | null
    dosha: $Enums.Dosha | null
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
    gender: string | null
    dateOfBirth: Date | null
    address: string | null
    city: string | null
    state: string | null
    country: string | null
    zipCode: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PatientCountAggregateOutputType = {
    id: number
    userId: number
    prakriti: number
    dosha: number
    firstName: number
    lastName: number
    email: number
    phone: number
    gender: number
    dateOfBirth: number
    address: number
    city: number
    state: number
    country: number
    zipCode: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type PatientMinAggregateInputType = {
    id?: true
    userId?: true
    prakriti?: true
    dosha?: true
    firstName?: true
    lastName?: true
    email?: true
    phone?: true
    gender?: true
    dateOfBirth?: true
    address?: true
    city?: true
    state?: true
    country?: true
    zipCode?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PatientMaxAggregateInputType = {
    id?: true
    userId?: true
    prakriti?: true
    dosha?: true
    firstName?: true
    lastName?: true
    email?: true
    phone?: true
    gender?: true
    dateOfBirth?: true
    address?: true
    city?: true
    state?: true
    country?: true
    zipCode?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PatientCountAggregateInputType = {
    id?: true
    userId?: true
    prakriti?: true
    dosha?: true
    firstName?: true
    lastName?: true
    email?: true
    phone?: true
    gender?: true
    dateOfBirth?: true
    address?: true
    city?: true
    state?: true
    country?: true
    zipCode?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type PatientAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Patient to aggregate.
     */
    where?: PatientWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Patients to fetch.
     */
    orderBy?: PatientOrderByWithRelationInput | PatientOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PatientWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Patients from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Patients.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Patients
    **/
    _count?: true | PatientCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PatientMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PatientMaxAggregateInputType
  }

  export type GetPatientAggregateType<T extends PatientAggregateArgs> = {
        [P in keyof T & keyof AggregatePatient]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePatient[P]>
      : GetScalarType<T[P], AggregatePatient[P]>
  }




  export type PatientGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PatientWhereInput
    orderBy?: PatientOrderByWithAggregationInput | PatientOrderByWithAggregationInput[]
    by: PatientScalarFieldEnum[] | PatientScalarFieldEnum
    having?: PatientScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PatientCountAggregateInputType | true
    _min?: PatientMinAggregateInputType
    _max?: PatientMaxAggregateInputType
  }

  export type PatientGroupByOutputType = {
    id: string
    userId: string
    prakriti: $Enums.Prakriti | null
    dosha: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone: string | null
    gender: string | null
    dateOfBirth: Date | null
    address: string | null
    city: string | null
    state: string | null
    country: string | null
    zipCode: string | null
    createdAt: Date
    updatedAt: Date
    _count: PatientCountAggregateOutputType | null
    _min: PatientMinAggregateOutputType | null
    _max: PatientMaxAggregateOutputType | null
  }

  type GetPatientGroupByPayload<T extends PatientGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PatientGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PatientGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PatientGroupByOutputType[P]>
            : GetScalarType<T[P], PatientGroupByOutputType[P]>
        }
      >
    >


  export type PatientSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    prakriti?: boolean
    dosha?: boolean
    firstName?: boolean
    lastName?: boolean
    email?: boolean
    phone?: boolean
    gender?: boolean
    dateOfBirth?: boolean
    address?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    appointments?: boolean | Patient$appointmentsArgs<ExtArgs>
    healthRecords?: boolean | Patient$healthRecordsArgs<ExtArgs>
    prescriptions?: boolean | Patient$prescriptionsArgs<ExtArgs>
    reviews?: boolean | Patient$reviewsArgs<ExtArgs>
    _count?: boolean | PatientCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["patient"]>

  export type PatientSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    prakriti?: boolean
    dosha?: boolean
    firstName?: boolean
    lastName?: boolean
    email?: boolean
    phone?: boolean
    gender?: boolean
    dateOfBirth?: boolean
    address?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["patient"]>

  export type PatientSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    prakriti?: boolean
    dosha?: boolean
    firstName?: boolean
    lastName?: boolean
    email?: boolean
    phone?: boolean
    gender?: boolean
    dateOfBirth?: boolean
    address?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["patient"]>

  export type PatientSelectScalar = {
    id?: boolean
    userId?: boolean
    prakriti?: boolean
    dosha?: boolean
    firstName?: boolean
    lastName?: boolean
    email?: boolean
    phone?: boolean
    gender?: boolean
    dateOfBirth?: boolean
    address?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type PatientOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "userId" | "prakriti" | "dosha" | "firstName" | "lastName" | "email" | "phone" | "gender" | "dateOfBirth" | "address" | "city" | "state" | "country" | "zipCode" | "createdAt" | "updatedAt", ExtArgs["result"]["patient"]>
  export type PatientInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointments?: boolean | Patient$appointmentsArgs<ExtArgs>
    healthRecords?: boolean | Patient$healthRecordsArgs<ExtArgs>
    prescriptions?: boolean | Patient$prescriptionsArgs<ExtArgs>
    reviews?: boolean | Patient$reviewsArgs<ExtArgs>
    _count?: boolean | PatientCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type PatientIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type PatientIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $PatientPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Patient"
    objects: {
      appointments: Prisma.$AppointmentPayload<ExtArgs>[]
      healthRecords: Prisma.$HealthRecordPayload<ExtArgs>[]
      prescriptions: Prisma.$PrescriptionPayload<ExtArgs>[]
      reviews: Prisma.$ReviewPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      prakriti: $Enums.Prakriti | null
      dosha: $Enums.Dosha | null
      firstName: string
      lastName: string
      email: string
      phone: string | null
      gender: string | null
      dateOfBirth: Date | null
      address: string | null
      city: string | null
      state: string | null
      country: string | null
      zipCode: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["patient"]>
    composites: {}
  }

  type PatientGetPayload<S extends boolean | null | undefined | PatientDefaultArgs> = $Result.GetResult<Prisma.$PatientPayload, S>

  type PatientCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<PatientFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PatientCountAggregateInputType | true
    }

  export interface PatientDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Patient'], meta: { name: 'Patient' } }
    /**
     * Find zero or one Patient that matches the filter.
     * @param {PatientFindUniqueArgs} args - Arguments to find a Patient
     * @example
     * // Get one Patient
     * const patient = await prisma.patient.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PatientFindUniqueArgs>(args: SelectSubset<T, PatientFindUniqueArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Patient that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {PatientFindUniqueOrThrowArgs} args - Arguments to find a Patient
     * @example
     * // Get one Patient
     * const patient = await prisma.patient.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PatientFindUniqueOrThrowArgs>(args: SelectSubset<T, PatientFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Patient that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PatientFindFirstArgs} args - Arguments to find a Patient
     * @example
     * // Get one Patient
     * const patient = await prisma.patient.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PatientFindFirstArgs>(args?: SelectSubset<T, PatientFindFirstArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Patient that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PatientFindFirstOrThrowArgs} args - Arguments to find a Patient
     * @example
     * // Get one Patient
     * const patient = await prisma.patient.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PatientFindFirstOrThrowArgs>(args?: SelectSubset<T, PatientFindFirstOrThrowArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Patients that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PatientFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Patients
     * const patients = await prisma.patient.findMany()
     * 
     * // Get first 10 Patients
     * const patients = await prisma.patient.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const patientWithIdOnly = await prisma.patient.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PatientFindManyArgs>(args?: SelectSubset<T, PatientFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Patient.
     * @param {PatientCreateArgs} args - Arguments to create a Patient.
     * @example
     * // Create one Patient
     * const Patient = await prisma.patient.create({
     *   data: {
     *     // ... data to create a Patient
     *   }
     * })
     * 
     */
    create<T extends PatientCreateArgs>(args: SelectSubset<T, PatientCreateArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Patients.
     * @param {PatientCreateManyArgs} args - Arguments to create many Patients.
     * @example
     * // Create many Patients
     * const patient = await prisma.patient.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PatientCreateManyArgs>(args?: SelectSubset<T, PatientCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Patients and returns the data saved in the database.
     * @param {PatientCreateManyAndReturnArgs} args - Arguments to create many Patients.
     * @example
     * // Create many Patients
     * const patient = await prisma.patient.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Patients and only return the `id`
     * const patientWithIdOnly = await prisma.patient.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PatientCreateManyAndReturnArgs>(args?: SelectSubset<T, PatientCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Patient.
     * @param {PatientDeleteArgs} args - Arguments to delete one Patient.
     * @example
     * // Delete one Patient
     * const Patient = await prisma.patient.delete({
     *   where: {
     *     // ... filter to delete one Patient
     *   }
     * })
     * 
     */
    delete<T extends PatientDeleteArgs>(args: SelectSubset<T, PatientDeleteArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Patient.
     * @param {PatientUpdateArgs} args - Arguments to update one Patient.
     * @example
     * // Update one Patient
     * const patient = await prisma.patient.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PatientUpdateArgs>(args: SelectSubset<T, PatientUpdateArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Patients.
     * @param {PatientDeleteManyArgs} args - Arguments to filter Patients to delete.
     * @example
     * // Delete a few Patients
     * const { count } = await prisma.patient.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PatientDeleteManyArgs>(args?: SelectSubset<T, PatientDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Patients.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PatientUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Patients
     * const patient = await prisma.patient.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PatientUpdateManyArgs>(args: SelectSubset<T, PatientUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Patients and returns the data updated in the database.
     * @param {PatientUpdateManyAndReturnArgs} args - Arguments to update many Patients.
     * @example
     * // Update many Patients
     * const patient = await prisma.patient.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Patients and only return the `id`
     * const patientWithIdOnly = await prisma.patient.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends PatientUpdateManyAndReturnArgs>(args: SelectSubset<T, PatientUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Patient.
     * @param {PatientUpsertArgs} args - Arguments to update or create a Patient.
     * @example
     * // Update or create a Patient
     * const patient = await prisma.patient.upsert({
     *   create: {
     *     // ... data to create a Patient
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Patient we want to update
     *   }
     * })
     */
    upsert<T extends PatientUpsertArgs>(args: SelectSubset<T, PatientUpsertArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Patients.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PatientCountArgs} args - Arguments to filter Patients to count.
     * @example
     * // Count the number of Patients
     * const count = await prisma.patient.count({
     *   where: {
     *     // ... the filter for the Patients we want to count
     *   }
     * })
    **/
    count<T extends PatientCountArgs>(
      args?: Subset<T, PatientCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PatientCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Patient.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PatientAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PatientAggregateArgs>(args: Subset<T, PatientAggregateArgs>): Prisma.PrismaPromise<GetPatientAggregateType<T>>

    /**
     * Group by Patient.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PatientGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PatientGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PatientGroupByArgs['orderBy'] }
        : { orderBy?: PatientGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PatientGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPatientGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Patient model
   */
  readonly fields: PatientFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Patient.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PatientClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    appointments<T extends Patient$appointmentsArgs<ExtArgs> = {}>(args?: Subset<T, Patient$appointmentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    healthRecords<T extends Patient$healthRecordsArgs<ExtArgs> = {}>(args?: Subset<T, Patient$healthRecordsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    prescriptions<T extends Patient$prescriptionsArgs<ExtArgs> = {}>(args?: Subset<T, Patient$prescriptionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    reviews<T extends Patient$reviewsArgs<ExtArgs> = {}>(args?: Subset<T, Patient$reviewsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Patient model
   */
  interface PatientFieldRefs {
    readonly id: FieldRef<"Patient", 'String'>
    readonly userId: FieldRef<"Patient", 'String'>
    readonly prakriti: FieldRef<"Patient", 'Prakriti'>
    readonly dosha: FieldRef<"Patient", 'Dosha'>
    readonly firstName: FieldRef<"Patient", 'String'>
    readonly lastName: FieldRef<"Patient", 'String'>
    readonly email: FieldRef<"Patient", 'String'>
    readonly phone: FieldRef<"Patient", 'String'>
    readonly gender: FieldRef<"Patient", 'String'>
    readonly dateOfBirth: FieldRef<"Patient", 'DateTime'>
    readonly address: FieldRef<"Patient", 'String'>
    readonly city: FieldRef<"Patient", 'String'>
    readonly state: FieldRef<"Patient", 'String'>
    readonly country: FieldRef<"Patient", 'String'>
    readonly zipCode: FieldRef<"Patient", 'String'>
    readonly createdAt: FieldRef<"Patient", 'DateTime'>
    readonly updatedAt: FieldRef<"Patient", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Patient findUnique
   */
  export type PatientFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PatientInclude<ExtArgs> | null
    /**
     * Filter, which Patient to fetch.
     */
    where: PatientWhereUniqueInput
  }

  /**
   * Patient findUniqueOrThrow
   */
  export type PatientFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PatientInclude<ExtArgs> | null
    /**
     * Filter, which Patient to fetch.
     */
    where: PatientWhereUniqueInput
  }

  /**
   * Patient findFirst
   */
  export type PatientFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PatientInclude<ExtArgs> | null
    /**
     * Filter, which Patient to fetch.
     */
    where?: PatientWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Patients to fetch.
     */
    orderBy?: PatientOrderByWithRelationInput | PatientOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Patients.
     */
    cursor?: PatientWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Patients from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Patients.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Patients.
     */
    distinct?: PatientScalarFieldEnum | PatientScalarFieldEnum[]
  }

  /**
   * Patient findFirstOrThrow
   */
  export type PatientFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PatientInclude<ExtArgs> | null
    /**
     * Filter, which Patient to fetch.
     */
    where?: PatientWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Patients to fetch.
     */
    orderBy?: PatientOrderByWithRelationInput | PatientOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Patients.
     */
    cursor?: PatientWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Patients from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Patients.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Patients.
     */
    distinct?: PatientScalarFieldEnum | PatientScalarFieldEnum[]
  }

  /**
   * Patient findMany
   */
  export type PatientFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PatientInclude<ExtArgs> | null
    /**
     * Filter, which Patients to fetch.
     */
    where?: PatientWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Patients to fetch.
     */
    orderBy?: PatientOrderByWithRelationInput | PatientOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Patients.
     */
    cursor?: PatientWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Patients from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Patients.
     */
    skip?: number
    distinct?: PatientScalarFieldEnum | PatientScalarFieldEnum[]
  }

  /**
   * Patient create
   */
  export type PatientCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PatientInclude<ExtArgs> | null
    /**
     * The data needed to create a Patient.
     */
    data: XOR<PatientCreateInput, PatientUncheckedCreateInput>
  }

  /**
   * Patient createMany
   */
  export type PatientCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Patients.
     */
    data: PatientCreateManyInput | PatientCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Patient createManyAndReturn
   */
  export type PatientCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * The data used to create many Patients.
     */
    data: PatientCreateManyInput | PatientCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Patient update
   */
  export type PatientUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PatientInclude<ExtArgs> | null
    /**
     * The data needed to update a Patient.
     */
    data: XOR<PatientUpdateInput, PatientUncheckedUpdateInput>
    /**
     * Choose, which Patient to update.
     */
    where: PatientWhereUniqueInput
  }

  /**
   * Patient updateMany
   */
  export type PatientUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Patients.
     */
    data: XOR<PatientUpdateManyMutationInput, PatientUncheckedUpdateManyInput>
    /**
     * Filter which Patients to update
     */
    where?: PatientWhereInput
    /**
     * Limit how many Patients to update.
     */
    limit?: number
  }

  /**
   * Patient updateManyAndReturn
   */
  export type PatientUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * The data used to update Patients.
     */
    data: XOR<PatientUpdateManyMutationInput, PatientUncheckedUpdateManyInput>
    /**
     * Filter which Patients to update
     */
    where?: PatientWhereInput
    /**
     * Limit how many Patients to update.
     */
    limit?: number
  }

  /**
   * Patient upsert
   */
  export type PatientUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PatientInclude<ExtArgs> | null
    /**
     * The filter to search for the Patient to update in case it exists.
     */
    where: PatientWhereUniqueInput
    /**
     * In case the Patient found by the `where` argument doesn't exist, create a new Patient with this data.
     */
    create: XOR<PatientCreateInput, PatientUncheckedCreateInput>
    /**
     * In case the Patient was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PatientUpdateInput, PatientUncheckedUpdateInput>
  }

  /**
   * Patient delete
   */
  export type PatientDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PatientInclude<ExtArgs> | null
    /**
     * Filter which Patient to delete.
     */
    where: PatientWhereUniqueInput
  }

  /**
   * Patient deleteMany
   */
  export type PatientDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Patients to delete
     */
    where?: PatientWhereInput
    /**
     * Limit how many Patients to delete.
     */
    limit?: number
  }

  /**
   * Patient.appointments
   */
  export type Patient$appointmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    where?: AppointmentWhereInput
    orderBy?: AppointmentOrderByWithRelationInput | AppointmentOrderByWithRelationInput[]
    cursor?: AppointmentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AppointmentScalarFieldEnum | AppointmentScalarFieldEnum[]
  }

  /**
   * Patient.healthRecords
   */
  export type Patient$healthRecordsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    where?: HealthRecordWhereInput
    orderBy?: HealthRecordOrderByWithRelationInput | HealthRecordOrderByWithRelationInput[]
    cursor?: HealthRecordWhereUniqueInput
    take?: number
    skip?: number
    distinct?: HealthRecordScalarFieldEnum | HealthRecordScalarFieldEnum[]
  }

  /**
   * Patient.prescriptions
   */
  export type Patient$prescriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    where?: PrescriptionWhereInput
    orderBy?: PrescriptionOrderByWithRelationInput | PrescriptionOrderByWithRelationInput[]
    cursor?: PrescriptionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PrescriptionScalarFieldEnum | PrescriptionScalarFieldEnum[]
  }

  /**
   * Patient.reviews
   */
  export type Patient$reviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    where?: ReviewWhereInput
    orderBy?: ReviewOrderByWithRelationInput | ReviewOrderByWithRelationInput[]
    cursor?: ReviewWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ReviewScalarFieldEnum | ReviewScalarFieldEnum[]
  }

  /**
   * Patient without action
   */
  export type PatientDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Patient
     */
    select?: PatientSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Patient
     */
    omit?: PatientOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PatientInclude<ExtArgs> | null
  }


  /**
   * Model Doctor
   */

  export type AggregateDoctor = {
    _count: DoctorCountAggregateOutputType | null
    _avg: DoctorAvgAggregateOutputType | null
    _sum: DoctorSumAggregateOutputType | null
    _min: DoctorMinAggregateOutputType | null
    _max: DoctorMaxAggregateOutputType | null
  }

  export type DoctorAvgAggregateOutputType = {
    experience: number | null
    consultationFee: number | null
    rating: number | null
  }

  export type DoctorSumAggregateOutputType = {
    experience: number | null
    consultationFee: number | null
    rating: number | null
  }

  export type DoctorMinAggregateOutputType = {
    id: string | null
    userId: string | null
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
    specialization: string | null
    experience: number | null
    qualification: string | null
    consultationFee: number | null
    rating: number | null
    isAvailable: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type DoctorMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
    specialization: string | null
    experience: number | null
    qualification: string | null
    consultationFee: number | null
    rating: number | null
    isAvailable: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type DoctorCountAggregateOutputType = {
    id: number
    userId: number
    firstName: number
    lastName: number
    email: number
    phone: number
    specialization: number
    experience: number
    qualification: number
    consultationFee: number
    rating: number
    isAvailable: number
    workingHours: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type DoctorAvgAggregateInputType = {
    experience?: true
    consultationFee?: true
    rating?: true
  }

  export type DoctorSumAggregateInputType = {
    experience?: true
    consultationFee?: true
    rating?: true
  }

  export type DoctorMinAggregateInputType = {
    id?: true
    userId?: true
    firstName?: true
    lastName?: true
    email?: true
    phone?: true
    specialization?: true
    experience?: true
    qualification?: true
    consultationFee?: true
    rating?: true
    isAvailable?: true
    createdAt?: true
    updatedAt?: true
  }

  export type DoctorMaxAggregateInputType = {
    id?: true
    userId?: true
    firstName?: true
    lastName?: true
    email?: true
    phone?: true
    specialization?: true
    experience?: true
    qualification?: true
    consultationFee?: true
    rating?: true
    isAvailable?: true
    createdAt?: true
    updatedAt?: true
  }

  export type DoctorCountAggregateInputType = {
    id?: true
    userId?: true
    firstName?: true
    lastName?: true
    email?: true
    phone?: true
    specialization?: true
    experience?: true
    qualification?: true
    consultationFee?: true
    rating?: true
    isAvailable?: true
    workingHours?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type DoctorAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Doctor to aggregate.
     */
    where?: DoctorWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Doctors to fetch.
     */
    orderBy?: DoctorOrderByWithRelationInput | DoctorOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: DoctorWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Doctors from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Doctors.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Doctors
    **/
    _count?: true | DoctorCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: DoctorAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: DoctorSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: DoctorMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: DoctorMaxAggregateInputType
  }

  export type GetDoctorAggregateType<T extends DoctorAggregateArgs> = {
        [P in keyof T & keyof AggregateDoctor]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDoctor[P]>
      : GetScalarType<T[P], AggregateDoctor[P]>
  }




  export type DoctorGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: DoctorWhereInput
    orderBy?: DoctorOrderByWithAggregationInput | DoctorOrderByWithAggregationInput[]
    by: DoctorScalarFieldEnum[] | DoctorScalarFieldEnum
    having?: DoctorScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: DoctorCountAggregateInputType | true
    _avg?: DoctorAvgAggregateInputType
    _sum?: DoctorSumAggregateInputType
    _min?: DoctorMinAggregateInputType
    _max?: DoctorMaxAggregateInputType
  }

  export type DoctorGroupByOutputType = {
    id: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
    specialization: string
    experience: number
    qualification: string | null
    consultationFee: number | null
    rating: number | null
    isAvailable: boolean
    workingHours: JsonValue | null
    createdAt: Date
    updatedAt: Date
    _count: DoctorCountAggregateOutputType | null
    _avg: DoctorAvgAggregateOutputType | null
    _sum: DoctorSumAggregateOutputType | null
    _min: DoctorMinAggregateOutputType | null
    _max: DoctorMaxAggregateOutputType | null
  }

  type GetDoctorGroupByPayload<T extends DoctorGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<DoctorGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof DoctorGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], DoctorGroupByOutputType[P]>
            : GetScalarType<T[P], DoctorGroupByOutputType[P]>
        }
      >
    >


  export type DoctorSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    firstName?: boolean
    lastName?: boolean
    email?: boolean
    phone?: boolean
    specialization?: boolean
    experience?: boolean
    qualification?: boolean
    consultationFee?: boolean
    rating?: boolean
    isAvailable?: boolean
    workingHours?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    appointments?: boolean | Doctor$appointmentsArgs<ExtArgs>
    healthRecords?: boolean | Doctor$healthRecordsArgs<ExtArgs>
    prescriptions?: boolean | Doctor$prescriptionsArgs<ExtArgs>
    reviews?: boolean | Doctor$reviewsArgs<ExtArgs>
    locations?: boolean | Doctor$locationsArgs<ExtArgs>
    _count?: boolean | DoctorCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["doctor"]>

  export type DoctorSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    firstName?: boolean
    lastName?: boolean
    email?: boolean
    phone?: boolean
    specialization?: boolean
    experience?: boolean
    qualification?: boolean
    consultationFee?: boolean
    rating?: boolean
    isAvailable?: boolean
    workingHours?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["doctor"]>

  export type DoctorSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    firstName?: boolean
    lastName?: boolean
    email?: boolean
    phone?: boolean
    specialization?: boolean
    experience?: boolean
    qualification?: boolean
    consultationFee?: boolean
    rating?: boolean
    isAvailable?: boolean
    workingHours?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["doctor"]>

  export type DoctorSelectScalar = {
    id?: boolean
    userId?: boolean
    firstName?: boolean
    lastName?: boolean
    email?: boolean
    phone?: boolean
    specialization?: boolean
    experience?: boolean
    qualification?: boolean
    consultationFee?: boolean
    rating?: boolean
    isAvailable?: boolean
    workingHours?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type DoctorOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "userId" | "firstName" | "lastName" | "email" | "phone" | "specialization" | "experience" | "qualification" | "consultationFee" | "rating" | "isAvailable" | "workingHours" | "createdAt" | "updatedAt", ExtArgs["result"]["doctor"]>
  export type DoctorInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointments?: boolean | Doctor$appointmentsArgs<ExtArgs>
    healthRecords?: boolean | Doctor$healthRecordsArgs<ExtArgs>
    prescriptions?: boolean | Doctor$prescriptionsArgs<ExtArgs>
    reviews?: boolean | Doctor$reviewsArgs<ExtArgs>
    locations?: boolean | Doctor$locationsArgs<ExtArgs>
    _count?: boolean | DoctorCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type DoctorIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type DoctorIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $DoctorPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Doctor"
    objects: {
      appointments: Prisma.$AppointmentPayload<ExtArgs>[]
      healthRecords: Prisma.$HealthRecordPayload<ExtArgs>[]
      prescriptions: Prisma.$PrescriptionPayload<ExtArgs>[]
      reviews: Prisma.$ReviewPayload<ExtArgs>[]
      locations: Prisma.$DoctorLocationPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      firstName: string
      lastName: string
      email: string
      phone: string | null
      specialization: string
      experience: number
      qualification: string | null
      consultationFee: number | null
      rating: number | null
      isAvailable: boolean
      workingHours: Prisma.JsonValue | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["doctor"]>
    composites: {}
  }

  type DoctorGetPayload<S extends boolean | null | undefined | DoctorDefaultArgs> = $Result.GetResult<Prisma.$DoctorPayload, S>

  type DoctorCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<DoctorFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: DoctorCountAggregateInputType | true
    }

  export interface DoctorDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Doctor'], meta: { name: 'Doctor' } }
    /**
     * Find zero or one Doctor that matches the filter.
     * @param {DoctorFindUniqueArgs} args - Arguments to find a Doctor
     * @example
     * // Get one Doctor
     * const doctor = await prisma.doctor.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends DoctorFindUniqueArgs>(args: SelectSubset<T, DoctorFindUniqueArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Doctor that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {DoctorFindUniqueOrThrowArgs} args - Arguments to find a Doctor
     * @example
     * // Get one Doctor
     * const doctor = await prisma.doctor.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends DoctorFindUniqueOrThrowArgs>(args: SelectSubset<T, DoctorFindUniqueOrThrowArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Doctor that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorFindFirstArgs} args - Arguments to find a Doctor
     * @example
     * // Get one Doctor
     * const doctor = await prisma.doctor.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends DoctorFindFirstArgs>(args?: SelectSubset<T, DoctorFindFirstArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Doctor that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorFindFirstOrThrowArgs} args - Arguments to find a Doctor
     * @example
     * // Get one Doctor
     * const doctor = await prisma.doctor.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends DoctorFindFirstOrThrowArgs>(args?: SelectSubset<T, DoctorFindFirstOrThrowArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Doctors that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Doctors
     * const doctors = await prisma.doctor.findMany()
     * 
     * // Get first 10 Doctors
     * const doctors = await prisma.doctor.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const doctorWithIdOnly = await prisma.doctor.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends DoctorFindManyArgs>(args?: SelectSubset<T, DoctorFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Doctor.
     * @param {DoctorCreateArgs} args - Arguments to create a Doctor.
     * @example
     * // Create one Doctor
     * const Doctor = await prisma.doctor.create({
     *   data: {
     *     // ... data to create a Doctor
     *   }
     * })
     * 
     */
    create<T extends DoctorCreateArgs>(args: SelectSubset<T, DoctorCreateArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Doctors.
     * @param {DoctorCreateManyArgs} args - Arguments to create many Doctors.
     * @example
     * // Create many Doctors
     * const doctor = await prisma.doctor.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends DoctorCreateManyArgs>(args?: SelectSubset<T, DoctorCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Doctors and returns the data saved in the database.
     * @param {DoctorCreateManyAndReturnArgs} args - Arguments to create many Doctors.
     * @example
     * // Create many Doctors
     * const doctor = await prisma.doctor.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Doctors and only return the `id`
     * const doctorWithIdOnly = await prisma.doctor.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends DoctorCreateManyAndReturnArgs>(args?: SelectSubset<T, DoctorCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Doctor.
     * @param {DoctorDeleteArgs} args - Arguments to delete one Doctor.
     * @example
     * // Delete one Doctor
     * const Doctor = await prisma.doctor.delete({
     *   where: {
     *     // ... filter to delete one Doctor
     *   }
     * })
     * 
     */
    delete<T extends DoctorDeleteArgs>(args: SelectSubset<T, DoctorDeleteArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Doctor.
     * @param {DoctorUpdateArgs} args - Arguments to update one Doctor.
     * @example
     * // Update one Doctor
     * const doctor = await prisma.doctor.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends DoctorUpdateArgs>(args: SelectSubset<T, DoctorUpdateArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Doctors.
     * @param {DoctorDeleteManyArgs} args - Arguments to filter Doctors to delete.
     * @example
     * // Delete a few Doctors
     * const { count } = await prisma.doctor.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends DoctorDeleteManyArgs>(args?: SelectSubset<T, DoctorDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Doctors.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Doctors
     * const doctor = await prisma.doctor.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends DoctorUpdateManyArgs>(args: SelectSubset<T, DoctorUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Doctors and returns the data updated in the database.
     * @param {DoctorUpdateManyAndReturnArgs} args - Arguments to update many Doctors.
     * @example
     * // Update many Doctors
     * const doctor = await prisma.doctor.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Doctors and only return the `id`
     * const doctorWithIdOnly = await prisma.doctor.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends DoctorUpdateManyAndReturnArgs>(args: SelectSubset<T, DoctorUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Doctor.
     * @param {DoctorUpsertArgs} args - Arguments to update or create a Doctor.
     * @example
     * // Update or create a Doctor
     * const doctor = await prisma.doctor.upsert({
     *   create: {
     *     // ... data to create a Doctor
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Doctor we want to update
     *   }
     * })
     */
    upsert<T extends DoctorUpsertArgs>(args: SelectSubset<T, DoctorUpsertArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Doctors.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorCountArgs} args - Arguments to filter Doctors to count.
     * @example
     * // Count the number of Doctors
     * const count = await prisma.doctor.count({
     *   where: {
     *     // ... the filter for the Doctors we want to count
     *   }
     * })
    **/
    count<T extends DoctorCountArgs>(
      args?: Subset<T, DoctorCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], DoctorCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Doctor.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends DoctorAggregateArgs>(args: Subset<T, DoctorAggregateArgs>): Prisma.PrismaPromise<GetDoctorAggregateType<T>>

    /**
     * Group by Doctor.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends DoctorGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: DoctorGroupByArgs['orderBy'] }
        : { orderBy?: DoctorGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, DoctorGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDoctorGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Doctor model
   */
  readonly fields: DoctorFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Doctor.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__DoctorClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    appointments<T extends Doctor$appointmentsArgs<ExtArgs> = {}>(args?: Subset<T, Doctor$appointmentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    healthRecords<T extends Doctor$healthRecordsArgs<ExtArgs> = {}>(args?: Subset<T, Doctor$healthRecordsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    prescriptions<T extends Doctor$prescriptionsArgs<ExtArgs> = {}>(args?: Subset<T, Doctor$prescriptionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    reviews<T extends Doctor$reviewsArgs<ExtArgs> = {}>(args?: Subset<T, Doctor$reviewsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    locations<T extends Doctor$locationsArgs<ExtArgs> = {}>(args?: Subset<T, Doctor$locationsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Doctor model
   */
  interface DoctorFieldRefs {
    readonly id: FieldRef<"Doctor", 'String'>
    readonly userId: FieldRef<"Doctor", 'String'>
    readonly firstName: FieldRef<"Doctor", 'String'>
    readonly lastName: FieldRef<"Doctor", 'String'>
    readonly email: FieldRef<"Doctor", 'String'>
    readonly phone: FieldRef<"Doctor", 'String'>
    readonly specialization: FieldRef<"Doctor", 'String'>
    readonly experience: FieldRef<"Doctor", 'Int'>
    readonly qualification: FieldRef<"Doctor", 'String'>
    readonly consultationFee: FieldRef<"Doctor", 'Float'>
    readonly rating: FieldRef<"Doctor", 'Float'>
    readonly isAvailable: FieldRef<"Doctor", 'Boolean'>
    readonly workingHours: FieldRef<"Doctor", 'Json'>
    readonly createdAt: FieldRef<"Doctor", 'DateTime'>
    readonly updatedAt: FieldRef<"Doctor", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Doctor findUnique
   */
  export type DoctorFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorInclude<ExtArgs> | null
    /**
     * Filter, which Doctor to fetch.
     */
    where: DoctorWhereUniqueInput
  }

  /**
   * Doctor findUniqueOrThrow
   */
  export type DoctorFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorInclude<ExtArgs> | null
    /**
     * Filter, which Doctor to fetch.
     */
    where: DoctorWhereUniqueInput
  }

  /**
   * Doctor findFirst
   */
  export type DoctorFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorInclude<ExtArgs> | null
    /**
     * Filter, which Doctor to fetch.
     */
    where?: DoctorWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Doctors to fetch.
     */
    orderBy?: DoctorOrderByWithRelationInput | DoctorOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Doctors.
     */
    cursor?: DoctorWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Doctors from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Doctors.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Doctors.
     */
    distinct?: DoctorScalarFieldEnum | DoctorScalarFieldEnum[]
  }

  /**
   * Doctor findFirstOrThrow
   */
  export type DoctorFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorInclude<ExtArgs> | null
    /**
     * Filter, which Doctor to fetch.
     */
    where?: DoctorWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Doctors to fetch.
     */
    orderBy?: DoctorOrderByWithRelationInput | DoctorOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Doctors.
     */
    cursor?: DoctorWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Doctors from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Doctors.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Doctors.
     */
    distinct?: DoctorScalarFieldEnum | DoctorScalarFieldEnum[]
  }

  /**
   * Doctor findMany
   */
  export type DoctorFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorInclude<ExtArgs> | null
    /**
     * Filter, which Doctors to fetch.
     */
    where?: DoctorWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Doctors to fetch.
     */
    orderBy?: DoctorOrderByWithRelationInput | DoctorOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Doctors.
     */
    cursor?: DoctorWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Doctors from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Doctors.
     */
    skip?: number
    distinct?: DoctorScalarFieldEnum | DoctorScalarFieldEnum[]
  }

  /**
   * Doctor create
   */
  export type DoctorCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorInclude<ExtArgs> | null
    /**
     * The data needed to create a Doctor.
     */
    data: XOR<DoctorCreateInput, DoctorUncheckedCreateInput>
  }

  /**
   * Doctor createMany
   */
  export type DoctorCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Doctors.
     */
    data: DoctorCreateManyInput | DoctorCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Doctor createManyAndReturn
   */
  export type DoctorCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * The data used to create many Doctors.
     */
    data: DoctorCreateManyInput | DoctorCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Doctor update
   */
  export type DoctorUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorInclude<ExtArgs> | null
    /**
     * The data needed to update a Doctor.
     */
    data: XOR<DoctorUpdateInput, DoctorUncheckedUpdateInput>
    /**
     * Choose, which Doctor to update.
     */
    where: DoctorWhereUniqueInput
  }

  /**
   * Doctor updateMany
   */
  export type DoctorUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Doctors.
     */
    data: XOR<DoctorUpdateManyMutationInput, DoctorUncheckedUpdateManyInput>
    /**
     * Filter which Doctors to update
     */
    where?: DoctorWhereInput
    /**
     * Limit how many Doctors to update.
     */
    limit?: number
  }

  /**
   * Doctor updateManyAndReturn
   */
  export type DoctorUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * The data used to update Doctors.
     */
    data: XOR<DoctorUpdateManyMutationInput, DoctorUncheckedUpdateManyInput>
    /**
     * Filter which Doctors to update
     */
    where?: DoctorWhereInput
    /**
     * Limit how many Doctors to update.
     */
    limit?: number
  }

  /**
   * Doctor upsert
   */
  export type DoctorUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorInclude<ExtArgs> | null
    /**
     * The filter to search for the Doctor to update in case it exists.
     */
    where: DoctorWhereUniqueInput
    /**
     * In case the Doctor found by the `where` argument doesn't exist, create a new Doctor with this data.
     */
    create: XOR<DoctorCreateInput, DoctorUncheckedCreateInput>
    /**
     * In case the Doctor was found with the provided `where` argument, update it with this data.
     */
    update: XOR<DoctorUpdateInput, DoctorUncheckedUpdateInput>
  }

  /**
   * Doctor delete
   */
  export type DoctorDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorInclude<ExtArgs> | null
    /**
     * Filter which Doctor to delete.
     */
    where: DoctorWhereUniqueInput
  }

  /**
   * Doctor deleteMany
   */
  export type DoctorDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Doctors to delete
     */
    where?: DoctorWhereInput
    /**
     * Limit how many Doctors to delete.
     */
    limit?: number
  }

  /**
   * Doctor.appointments
   */
  export type Doctor$appointmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    where?: AppointmentWhereInput
    orderBy?: AppointmentOrderByWithRelationInput | AppointmentOrderByWithRelationInput[]
    cursor?: AppointmentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AppointmentScalarFieldEnum | AppointmentScalarFieldEnum[]
  }

  /**
   * Doctor.healthRecords
   */
  export type Doctor$healthRecordsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    where?: HealthRecordWhereInput
    orderBy?: HealthRecordOrderByWithRelationInput | HealthRecordOrderByWithRelationInput[]
    cursor?: HealthRecordWhereUniqueInput
    take?: number
    skip?: number
    distinct?: HealthRecordScalarFieldEnum | HealthRecordScalarFieldEnum[]
  }

  /**
   * Doctor.prescriptions
   */
  export type Doctor$prescriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    where?: PrescriptionWhereInput
    orderBy?: PrescriptionOrderByWithRelationInput | PrescriptionOrderByWithRelationInput[]
    cursor?: PrescriptionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PrescriptionScalarFieldEnum | PrescriptionScalarFieldEnum[]
  }

  /**
   * Doctor.reviews
   */
  export type Doctor$reviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    where?: ReviewWhereInput
    orderBy?: ReviewOrderByWithRelationInput | ReviewOrderByWithRelationInput[]
    cursor?: ReviewWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ReviewScalarFieldEnum | ReviewScalarFieldEnum[]
  }

  /**
   * Doctor.locations
   */
  export type Doctor$locationsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    where?: DoctorLocationWhereInput
    orderBy?: DoctorLocationOrderByWithRelationInput | DoctorLocationOrderByWithRelationInput[]
    cursor?: DoctorLocationWhereUniqueInput
    take?: number
    skip?: number
    distinct?: DoctorLocationScalarFieldEnum | DoctorLocationScalarFieldEnum[]
  }

  /**
   * Doctor without action
   */
  export type DoctorDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Doctor
     */
    select?: DoctorSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Doctor
     */
    omit?: DoctorOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorInclude<ExtArgs> | null
  }


  /**
   * Model DoctorLocation
   */

  export type AggregateDoctorLocation = {
    _count: DoctorLocationCountAggregateOutputType | null
    _min: DoctorLocationMinAggregateOutputType | null
    _max: DoctorLocationMaxAggregateOutputType | null
  }

  export type DoctorLocationMinAggregateOutputType = {
    doctorId: string | null
    locationId: string | null
    startTime: Date | null
    endTime: Date | null
  }

  export type DoctorLocationMaxAggregateOutputType = {
    doctorId: string | null
    locationId: string | null
    startTime: Date | null
    endTime: Date | null
  }

  export type DoctorLocationCountAggregateOutputType = {
    doctorId: number
    locationId: number
    startTime: number
    endTime: number
    _all: number
  }


  export type DoctorLocationMinAggregateInputType = {
    doctorId?: true
    locationId?: true
    startTime?: true
    endTime?: true
  }

  export type DoctorLocationMaxAggregateInputType = {
    doctorId?: true
    locationId?: true
    startTime?: true
    endTime?: true
  }

  export type DoctorLocationCountAggregateInputType = {
    doctorId?: true
    locationId?: true
    startTime?: true
    endTime?: true
    _all?: true
  }

  export type DoctorLocationAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which DoctorLocation to aggregate.
     */
    where?: DoctorLocationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of DoctorLocations to fetch.
     */
    orderBy?: DoctorLocationOrderByWithRelationInput | DoctorLocationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: DoctorLocationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` DoctorLocations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` DoctorLocations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned DoctorLocations
    **/
    _count?: true | DoctorLocationCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: DoctorLocationMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: DoctorLocationMaxAggregateInputType
  }

  export type GetDoctorLocationAggregateType<T extends DoctorLocationAggregateArgs> = {
        [P in keyof T & keyof AggregateDoctorLocation]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDoctorLocation[P]>
      : GetScalarType<T[P], AggregateDoctorLocation[P]>
  }




  export type DoctorLocationGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: DoctorLocationWhereInput
    orderBy?: DoctorLocationOrderByWithAggregationInput | DoctorLocationOrderByWithAggregationInput[]
    by: DoctorLocationScalarFieldEnum[] | DoctorLocationScalarFieldEnum
    having?: DoctorLocationScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: DoctorLocationCountAggregateInputType | true
    _min?: DoctorLocationMinAggregateInputType
    _max?: DoctorLocationMaxAggregateInputType
  }

  export type DoctorLocationGroupByOutputType = {
    doctorId: string
    locationId: string
    startTime: Date | null
    endTime: Date | null
    _count: DoctorLocationCountAggregateOutputType | null
    _min: DoctorLocationMinAggregateOutputType | null
    _max: DoctorLocationMaxAggregateOutputType | null
  }

  type GetDoctorLocationGroupByPayload<T extends DoctorLocationGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<DoctorLocationGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof DoctorLocationGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], DoctorLocationGroupByOutputType[P]>
            : GetScalarType<T[P], DoctorLocationGroupByOutputType[P]>
        }
      >
    >


  export type DoctorLocationSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    doctorId?: boolean
    locationId?: boolean
    startTime?: boolean
    endTime?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["doctorLocation"]>

  export type DoctorLocationSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    doctorId?: boolean
    locationId?: boolean
    startTime?: boolean
    endTime?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["doctorLocation"]>

  export type DoctorLocationSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    doctorId?: boolean
    locationId?: boolean
    startTime?: boolean
    endTime?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["doctorLocation"]>

  export type DoctorLocationSelectScalar = {
    doctorId?: boolean
    locationId?: boolean
    startTime?: boolean
    endTime?: boolean
  }

  export type DoctorLocationOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"doctorId" | "locationId" | "startTime" | "endTime", ExtArgs["result"]["doctorLocation"]>
  export type DoctorLocationInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
  }
  export type DoctorLocationIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
  }
  export type DoctorLocationIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
  }

  export type $DoctorLocationPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "DoctorLocation"
    objects: {
      doctor: Prisma.$DoctorPayload<ExtArgs>
      location: Prisma.$LocationPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      doctorId: string
      locationId: string
      startTime: Date | null
      endTime: Date | null
    }, ExtArgs["result"]["doctorLocation"]>
    composites: {}
  }

  type DoctorLocationGetPayload<S extends boolean | null | undefined | DoctorLocationDefaultArgs> = $Result.GetResult<Prisma.$DoctorLocationPayload, S>

  type DoctorLocationCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<DoctorLocationFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: DoctorLocationCountAggregateInputType | true
    }

  export interface DoctorLocationDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['DoctorLocation'], meta: { name: 'DoctorLocation' } }
    /**
     * Find zero or one DoctorLocation that matches the filter.
     * @param {DoctorLocationFindUniqueArgs} args - Arguments to find a DoctorLocation
     * @example
     * // Get one DoctorLocation
     * const doctorLocation = await prisma.doctorLocation.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends DoctorLocationFindUniqueArgs>(args: SelectSubset<T, DoctorLocationFindUniqueArgs<ExtArgs>>): Prisma__DoctorLocationClient<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one DoctorLocation that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {DoctorLocationFindUniqueOrThrowArgs} args - Arguments to find a DoctorLocation
     * @example
     * // Get one DoctorLocation
     * const doctorLocation = await prisma.doctorLocation.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends DoctorLocationFindUniqueOrThrowArgs>(args: SelectSubset<T, DoctorLocationFindUniqueOrThrowArgs<ExtArgs>>): Prisma__DoctorLocationClient<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first DoctorLocation that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorLocationFindFirstArgs} args - Arguments to find a DoctorLocation
     * @example
     * // Get one DoctorLocation
     * const doctorLocation = await prisma.doctorLocation.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends DoctorLocationFindFirstArgs>(args?: SelectSubset<T, DoctorLocationFindFirstArgs<ExtArgs>>): Prisma__DoctorLocationClient<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first DoctorLocation that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorLocationFindFirstOrThrowArgs} args - Arguments to find a DoctorLocation
     * @example
     * // Get one DoctorLocation
     * const doctorLocation = await prisma.doctorLocation.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends DoctorLocationFindFirstOrThrowArgs>(args?: SelectSubset<T, DoctorLocationFindFirstOrThrowArgs<ExtArgs>>): Prisma__DoctorLocationClient<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more DoctorLocations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorLocationFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all DoctorLocations
     * const doctorLocations = await prisma.doctorLocation.findMany()
     * 
     * // Get first 10 DoctorLocations
     * const doctorLocations = await prisma.doctorLocation.findMany({ take: 10 })
     * 
     * // Only select the `doctorId`
     * const doctorLocationWithDoctorIdOnly = await prisma.doctorLocation.findMany({ select: { doctorId: true } })
     * 
     */
    findMany<T extends DoctorLocationFindManyArgs>(args?: SelectSubset<T, DoctorLocationFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a DoctorLocation.
     * @param {DoctorLocationCreateArgs} args - Arguments to create a DoctorLocation.
     * @example
     * // Create one DoctorLocation
     * const DoctorLocation = await prisma.doctorLocation.create({
     *   data: {
     *     // ... data to create a DoctorLocation
     *   }
     * })
     * 
     */
    create<T extends DoctorLocationCreateArgs>(args: SelectSubset<T, DoctorLocationCreateArgs<ExtArgs>>): Prisma__DoctorLocationClient<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many DoctorLocations.
     * @param {DoctorLocationCreateManyArgs} args - Arguments to create many DoctorLocations.
     * @example
     * // Create many DoctorLocations
     * const doctorLocation = await prisma.doctorLocation.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends DoctorLocationCreateManyArgs>(args?: SelectSubset<T, DoctorLocationCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many DoctorLocations and returns the data saved in the database.
     * @param {DoctorLocationCreateManyAndReturnArgs} args - Arguments to create many DoctorLocations.
     * @example
     * // Create many DoctorLocations
     * const doctorLocation = await prisma.doctorLocation.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many DoctorLocations and only return the `doctorId`
     * const doctorLocationWithDoctorIdOnly = await prisma.doctorLocation.createManyAndReturn({
     *   select: { doctorId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends DoctorLocationCreateManyAndReturnArgs>(args?: SelectSubset<T, DoctorLocationCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a DoctorLocation.
     * @param {DoctorLocationDeleteArgs} args - Arguments to delete one DoctorLocation.
     * @example
     * // Delete one DoctorLocation
     * const DoctorLocation = await prisma.doctorLocation.delete({
     *   where: {
     *     // ... filter to delete one DoctorLocation
     *   }
     * })
     * 
     */
    delete<T extends DoctorLocationDeleteArgs>(args: SelectSubset<T, DoctorLocationDeleteArgs<ExtArgs>>): Prisma__DoctorLocationClient<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one DoctorLocation.
     * @param {DoctorLocationUpdateArgs} args - Arguments to update one DoctorLocation.
     * @example
     * // Update one DoctorLocation
     * const doctorLocation = await prisma.doctorLocation.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends DoctorLocationUpdateArgs>(args: SelectSubset<T, DoctorLocationUpdateArgs<ExtArgs>>): Prisma__DoctorLocationClient<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more DoctorLocations.
     * @param {DoctorLocationDeleteManyArgs} args - Arguments to filter DoctorLocations to delete.
     * @example
     * // Delete a few DoctorLocations
     * const { count } = await prisma.doctorLocation.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends DoctorLocationDeleteManyArgs>(args?: SelectSubset<T, DoctorLocationDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more DoctorLocations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorLocationUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many DoctorLocations
     * const doctorLocation = await prisma.doctorLocation.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends DoctorLocationUpdateManyArgs>(args: SelectSubset<T, DoctorLocationUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more DoctorLocations and returns the data updated in the database.
     * @param {DoctorLocationUpdateManyAndReturnArgs} args - Arguments to update many DoctorLocations.
     * @example
     * // Update many DoctorLocations
     * const doctorLocation = await prisma.doctorLocation.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more DoctorLocations and only return the `doctorId`
     * const doctorLocationWithDoctorIdOnly = await prisma.doctorLocation.updateManyAndReturn({
     *   select: { doctorId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends DoctorLocationUpdateManyAndReturnArgs>(args: SelectSubset<T, DoctorLocationUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one DoctorLocation.
     * @param {DoctorLocationUpsertArgs} args - Arguments to update or create a DoctorLocation.
     * @example
     * // Update or create a DoctorLocation
     * const doctorLocation = await prisma.doctorLocation.upsert({
     *   create: {
     *     // ... data to create a DoctorLocation
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the DoctorLocation we want to update
     *   }
     * })
     */
    upsert<T extends DoctorLocationUpsertArgs>(args: SelectSubset<T, DoctorLocationUpsertArgs<ExtArgs>>): Prisma__DoctorLocationClient<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of DoctorLocations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorLocationCountArgs} args - Arguments to filter DoctorLocations to count.
     * @example
     * // Count the number of DoctorLocations
     * const count = await prisma.doctorLocation.count({
     *   where: {
     *     // ... the filter for the DoctorLocations we want to count
     *   }
     * })
    **/
    count<T extends DoctorLocationCountArgs>(
      args?: Subset<T, DoctorLocationCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], DoctorLocationCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a DoctorLocation.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorLocationAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends DoctorLocationAggregateArgs>(args: Subset<T, DoctorLocationAggregateArgs>): Prisma.PrismaPromise<GetDoctorLocationAggregateType<T>>

    /**
     * Group by DoctorLocation.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DoctorLocationGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends DoctorLocationGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: DoctorLocationGroupByArgs['orderBy'] }
        : { orderBy?: DoctorLocationGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, DoctorLocationGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDoctorLocationGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the DoctorLocation model
   */
  readonly fields: DoctorLocationFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for DoctorLocation.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__DoctorLocationClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    doctor<T extends DoctorDefaultArgs<ExtArgs> = {}>(args?: Subset<T, DoctorDefaultArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    location<T extends LocationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, LocationDefaultArgs<ExtArgs>>): Prisma__LocationClient<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the DoctorLocation model
   */
  interface DoctorLocationFieldRefs {
    readonly doctorId: FieldRef<"DoctorLocation", 'String'>
    readonly locationId: FieldRef<"DoctorLocation", 'String'>
    readonly startTime: FieldRef<"DoctorLocation", 'DateTime'>
    readonly endTime: FieldRef<"DoctorLocation", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * DoctorLocation findUnique
   */
  export type DoctorLocationFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    /**
     * Filter, which DoctorLocation to fetch.
     */
    where: DoctorLocationWhereUniqueInput
  }

  /**
   * DoctorLocation findUniqueOrThrow
   */
  export type DoctorLocationFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    /**
     * Filter, which DoctorLocation to fetch.
     */
    where: DoctorLocationWhereUniqueInput
  }

  /**
   * DoctorLocation findFirst
   */
  export type DoctorLocationFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    /**
     * Filter, which DoctorLocation to fetch.
     */
    where?: DoctorLocationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of DoctorLocations to fetch.
     */
    orderBy?: DoctorLocationOrderByWithRelationInput | DoctorLocationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for DoctorLocations.
     */
    cursor?: DoctorLocationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` DoctorLocations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` DoctorLocations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of DoctorLocations.
     */
    distinct?: DoctorLocationScalarFieldEnum | DoctorLocationScalarFieldEnum[]
  }

  /**
   * DoctorLocation findFirstOrThrow
   */
  export type DoctorLocationFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    /**
     * Filter, which DoctorLocation to fetch.
     */
    where?: DoctorLocationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of DoctorLocations to fetch.
     */
    orderBy?: DoctorLocationOrderByWithRelationInput | DoctorLocationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for DoctorLocations.
     */
    cursor?: DoctorLocationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` DoctorLocations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` DoctorLocations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of DoctorLocations.
     */
    distinct?: DoctorLocationScalarFieldEnum | DoctorLocationScalarFieldEnum[]
  }

  /**
   * DoctorLocation findMany
   */
  export type DoctorLocationFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    /**
     * Filter, which DoctorLocations to fetch.
     */
    where?: DoctorLocationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of DoctorLocations to fetch.
     */
    orderBy?: DoctorLocationOrderByWithRelationInput | DoctorLocationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing DoctorLocations.
     */
    cursor?: DoctorLocationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` DoctorLocations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` DoctorLocations.
     */
    skip?: number
    distinct?: DoctorLocationScalarFieldEnum | DoctorLocationScalarFieldEnum[]
  }

  /**
   * DoctorLocation create
   */
  export type DoctorLocationCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    /**
     * The data needed to create a DoctorLocation.
     */
    data: XOR<DoctorLocationCreateInput, DoctorLocationUncheckedCreateInput>
  }

  /**
   * DoctorLocation createMany
   */
  export type DoctorLocationCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many DoctorLocations.
     */
    data: DoctorLocationCreateManyInput | DoctorLocationCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * DoctorLocation createManyAndReturn
   */
  export type DoctorLocationCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * The data used to create many DoctorLocations.
     */
    data: DoctorLocationCreateManyInput | DoctorLocationCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * DoctorLocation update
   */
  export type DoctorLocationUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    /**
     * The data needed to update a DoctorLocation.
     */
    data: XOR<DoctorLocationUpdateInput, DoctorLocationUncheckedUpdateInput>
    /**
     * Choose, which DoctorLocation to update.
     */
    where: DoctorLocationWhereUniqueInput
  }

  /**
   * DoctorLocation updateMany
   */
  export type DoctorLocationUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update DoctorLocations.
     */
    data: XOR<DoctorLocationUpdateManyMutationInput, DoctorLocationUncheckedUpdateManyInput>
    /**
     * Filter which DoctorLocations to update
     */
    where?: DoctorLocationWhereInput
    /**
     * Limit how many DoctorLocations to update.
     */
    limit?: number
  }

  /**
   * DoctorLocation updateManyAndReturn
   */
  export type DoctorLocationUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * The data used to update DoctorLocations.
     */
    data: XOR<DoctorLocationUpdateManyMutationInput, DoctorLocationUncheckedUpdateManyInput>
    /**
     * Filter which DoctorLocations to update
     */
    where?: DoctorLocationWhereInput
    /**
     * Limit how many DoctorLocations to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * DoctorLocation upsert
   */
  export type DoctorLocationUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    /**
     * The filter to search for the DoctorLocation to update in case it exists.
     */
    where: DoctorLocationWhereUniqueInput
    /**
     * In case the DoctorLocation found by the `where` argument doesn't exist, create a new DoctorLocation with this data.
     */
    create: XOR<DoctorLocationCreateInput, DoctorLocationUncheckedCreateInput>
    /**
     * In case the DoctorLocation was found with the provided `where` argument, update it with this data.
     */
    update: XOR<DoctorLocationUpdateInput, DoctorLocationUncheckedUpdateInput>
  }

  /**
   * DoctorLocation delete
   */
  export type DoctorLocationDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    /**
     * Filter which DoctorLocation to delete.
     */
    where: DoctorLocationWhereUniqueInput
  }

  /**
   * DoctorLocation deleteMany
   */
  export type DoctorLocationDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which DoctorLocations to delete
     */
    where?: DoctorLocationWhereInput
    /**
     * Limit how many DoctorLocations to delete.
     */
    limit?: number
  }

  /**
   * DoctorLocation without action
   */
  export type DoctorLocationDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
  }


  /**
   * Model Location
   */

  export type AggregateLocation = {
    _count: LocationCountAggregateOutputType | null
    _avg: LocationAvgAggregateOutputType | null
    _sum: LocationSumAggregateOutputType | null
    _min: LocationMinAggregateOutputType | null
    _max: LocationMaxAggregateOutputType | null
  }

  export type LocationAvgAggregateOutputType = {
    latitude: number | null
    longitude: number | null
  }

  export type LocationSumAggregateOutputType = {
    latitude: number | null
    longitude: number | null
  }

  export type LocationMinAggregateOutputType = {
    id: string | null
    name: string | null
    address: string | null
    city: string | null
    state: string | null
    country: string | null
    zipCode: string | null
    phone: string | null
    email: string | null
    isActive: boolean | null
    isMainBranch: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
    latitude: number | null
    longitude: number | null
    timezone: string | null
  }

  export type LocationMaxAggregateOutputType = {
    id: string | null
    name: string | null
    address: string | null
    city: string | null
    state: string | null
    country: string | null
    zipCode: string | null
    phone: string | null
    email: string | null
    isActive: boolean | null
    isMainBranch: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
    latitude: number | null
    longitude: number | null
    timezone: string | null
  }

  export type LocationCountAggregateOutputType = {
    id: number
    name: number
    address: number
    city: number
    state: number
    country: number
    zipCode: number
    phone: number
    email: number
    isActive: number
    isMainBranch: number
    createdAt: number
    updatedAt: number
    latitude: number
    longitude: number
    timezone: number
    workingHours: number
    _all: number
  }


  export type LocationAvgAggregateInputType = {
    latitude?: true
    longitude?: true
  }

  export type LocationSumAggregateInputType = {
    latitude?: true
    longitude?: true
  }

  export type LocationMinAggregateInputType = {
    id?: true
    name?: true
    address?: true
    city?: true
    state?: true
    country?: true
    zipCode?: true
    phone?: true
    email?: true
    isActive?: true
    isMainBranch?: true
    createdAt?: true
    updatedAt?: true
    latitude?: true
    longitude?: true
    timezone?: true
  }

  export type LocationMaxAggregateInputType = {
    id?: true
    name?: true
    address?: true
    city?: true
    state?: true
    country?: true
    zipCode?: true
    phone?: true
    email?: true
    isActive?: true
    isMainBranch?: true
    createdAt?: true
    updatedAt?: true
    latitude?: true
    longitude?: true
    timezone?: true
  }

  export type LocationCountAggregateInputType = {
    id?: true
    name?: true
    address?: true
    city?: true
    state?: true
    country?: true
    zipCode?: true
    phone?: true
    email?: true
    isActive?: true
    isMainBranch?: true
    createdAt?: true
    updatedAt?: true
    latitude?: true
    longitude?: true
    timezone?: true
    workingHours?: true
    _all?: true
  }

  export type LocationAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Location to aggregate.
     */
    where?: LocationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Locations to fetch.
     */
    orderBy?: LocationOrderByWithRelationInput | LocationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: LocationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Locations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Locations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Locations
    **/
    _count?: true | LocationCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: LocationAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: LocationSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: LocationMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: LocationMaxAggregateInputType
  }

  export type GetLocationAggregateType<T extends LocationAggregateArgs> = {
        [P in keyof T & keyof AggregateLocation]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateLocation[P]>
      : GetScalarType<T[P], AggregateLocation[P]>
  }




  export type LocationGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: LocationWhereInput
    orderBy?: LocationOrderByWithAggregationInput | LocationOrderByWithAggregationInput[]
    by: LocationScalarFieldEnum[] | LocationScalarFieldEnum
    having?: LocationScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: LocationCountAggregateInputType | true
    _avg?: LocationAvgAggregateInputType
    _sum?: LocationSumAggregateInputType
    _min?: LocationMinAggregateInputType
    _max?: LocationMaxAggregateInputType
  }

  export type LocationGroupByOutputType = {
    id: string
    name: string
    address: string
    city: string
    state: string
    country: string
    zipCode: string
    phone: string | null
    email: string | null
    isActive: boolean
    isMainBranch: boolean
    createdAt: Date
    updatedAt: Date
    latitude: number | null
    longitude: number | null
    timezone: string
    workingHours: JsonValue | null
    _count: LocationCountAggregateOutputType | null
    _avg: LocationAvgAggregateOutputType | null
    _sum: LocationSumAggregateOutputType | null
    _min: LocationMinAggregateOutputType | null
    _max: LocationMaxAggregateOutputType | null
  }

  type GetLocationGroupByPayload<T extends LocationGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<LocationGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof LocationGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], LocationGroupByOutputType[P]>
            : GetScalarType<T[P], LocationGroupByOutputType[P]>
        }
      >
    >


  export type LocationSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    address?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    phone?: boolean
    email?: boolean
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    latitude?: boolean
    longitude?: boolean
    timezone?: boolean
    workingHours?: boolean
    appointments?: boolean | Location$appointmentsArgs<ExtArgs>
    doctors?: boolean | Location$doctorsArgs<ExtArgs>
    _count?: boolean | LocationCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["location"]>

  export type LocationSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    address?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    phone?: boolean
    email?: boolean
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    latitude?: boolean
    longitude?: boolean
    timezone?: boolean
    workingHours?: boolean
  }, ExtArgs["result"]["location"]>

  export type LocationSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    address?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    phone?: boolean
    email?: boolean
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    latitude?: boolean
    longitude?: boolean
    timezone?: boolean
    workingHours?: boolean
  }, ExtArgs["result"]["location"]>

  export type LocationSelectScalar = {
    id?: boolean
    name?: boolean
    address?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    phone?: boolean
    email?: boolean
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    latitude?: boolean
    longitude?: boolean
    timezone?: boolean
    workingHours?: boolean
  }

  export type LocationOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "name" | "address" | "city" | "state" | "country" | "zipCode" | "phone" | "email" | "isActive" | "isMainBranch" | "createdAt" | "updatedAt" | "latitude" | "longitude" | "timezone" | "workingHours", ExtArgs["result"]["location"]>
  export type LocationInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointments?: boolean | Location$appointmentsArgs<ExtArgs>
    doctors?: boolean | Location$doctorsArgs<ExtArgs>
    _count?: boolean | LocationCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type LocationIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type LocationIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $LocationPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Location"
    objects: {
      appointments: Prisma.$AppointmentPayload<ExtArgs>[]
      doctors: Prisma.$DoctorLocationPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      address: string
      city: string
      state: string
      country: string
      zipCode: string
      phone: string | null
      email: string | null
      isActive: boolean
      isMainBranch: boolean
      createdAt: Date
      updatedAt: Date
      latitude: number | null
      longitude: number | null
      timezone: string
      workingHours: Prisma.JsonValue | null
    }, ExtArgs["result"]["location"]>
    composites: {}
  }

  type LocationGetPayload<S extends boolean | null | undefined | LocationDefaultArgs> = $Result.GetResult<Prisma.$LocationPayload, S>

  type LocationCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<LocationFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: LocationCountAggregateInputType | true
    }

  export interface LocationDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Location'], meta: { name: 'Location' } }
    /**
     * Find zero or one Location that matches the filter.
     * @param {LocationFindUniqueArgs} args - Arguments to find a Location
     * @example
     * // Get one Location
     * const location = await prisma.location.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends LocationFindUniqueArgs>(args: SelectSubset<T, LocationFindUniqueArgs<ExtArgs>>): Prisma__LocationClient<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Location that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {LocationFindUniqueOrThrowArgs} args - Arguments to find a Location
     * @example
     * // Get one Location
     * const location = await prisma.location.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends LocationFindUniqueOrThrowArgs>(args: SelectSubset<T, LocationFindUniqueOrThrowArgs<ExtArgs>>): Prisma__LocationClient<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Location that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocationFindFirstArgs} args - Arguments to find a Location
     * @example
     * // Get one Location
     * const location = await prisma.location.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends LocationFindFirstArgs>(args?: SelectSubset<T, LocationFindFirstArgs<ExtArgs>>): Prisma__LocationClient<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Location that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocationFindFirstOrThrowArgs} args - Arguments to find a Location
     * @example
     * // Get one Location
     * const location = await prisma.location.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends LocationFindFirstOrThrowArgs>(args?: SelectSubset<T, LocationFindFirstOrThrowArgs<ExtArgs>>): Prisma__LocationClient<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Locations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocationFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Locations
     * const locations = await prisma.location.findMany()
     * 
     * // Get first 10 Locations
     * const locations = await prisma.location.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const locationWithIdOnly = await prisma.location.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends LocationFindManyArgs>(args?: SelectSubset<T, LocationFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Location.
     * @param {LocationCreateArgs} args - Arguments to create a Location.
     * @example
     * // Create one Location
     * const Location = await prisma.location.create({
     *   data: {
     *     // ... data to create a Location
     *   }
     * })
     * 
     */
    create<T extends LocationCreateArgs>(args: SelectSubset<T, LocationCreateArgs<ExtArgs>>): Prisma__LocationClient<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Locations.
     * @param {LocationCreateManyArgs} args - Arguments to create many Locations.
     * @example
     * // Create many Locations
     * const location = await prisma.location.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends LocationCreateManyArgs>(args?: SelectSubset<T, LocationCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Locations and returns the data saved in the database.
     * @param {LocationCreateManyAndReturnArgs} args - Arguments to create many Locations.
     * @example
     * // Create many Locations
     * const location = await prisma.location.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Locations and only return the `id`
     * const locationWithIdOnly = await prisma.location.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends LocationCreateManyAndReturnArgs>(args?: SelectSubset<T, LocationCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Location.
     * @param {LocationDeleteArgs} args - Arguments to delete one Location.
     * @example
     * // Delete one Location
     * const Location = await prisma.location.delete({
     *   where: {
     *     // ... filter to delete one Location
     *   }
     * })
     * 
     */
    delete<T extends LocationDeleteArgs>(args: SelectSubset<T, LocationDeleteArgs<ExtArgs>>): Prisma__LocationClient<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Location.
     * @param {LocationUpdateArgs} args - Arguments to update one Location.
     * @example
     * // Update one Location
     * const location = await prisma.location.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends LocationUpdateArgs>(args: SelectSubset<T, LocationUpdateArgs<ExtArgs>>): Prisma__LocationClient<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Locations.
     * @param {LocationDeleteManyArgs} args - Arguments to filter Locations to delete.
     * @example
     * // Delete a few Locations
     * const { count } = await prisma.location.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends LocationDeleteManyArgs>(args?: SelectSubset<T, LocationDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Locations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocationUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Locations
     * const location = await prisma.location.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends LocationUpdateManyArgs>(args: SelectSubset<T, LocationUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Locations and returns the data updated in the database.
     * @param {LocationUpdateManyAndReturnArgs} args - Arguments to update many Locations.
     * @example
     * // Update many Locations
     * const location = await prisma.location.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Locations and only return the `id`
     * const locationWithIdOnly = await prisma.location.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends LocationUpdateManyAndReturnArgs>(args: SelectSubset<T, LocationUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Location.
     * @param {LocationUpsertArgs} args - Arguments to update or create a Location.
     * @example
     * // Update or create a Location
     * const location = await prisma.location.upsert({
     *   create: {
     *     // ... data to create a Location
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Location we want to update
     *   }
     * })
     */
    upsert<T extends LocationUpsertArgs>(args: SelectSubset<T, LocationUpsertArgs<ExtArgs>>): Prisma__LocationClient<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Locations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocationCountArgs} args - Arguments to filter Locations to count.
     * @example
     * // Count the number of Locations
     * const count = await prisma.location.count({
     *   where: {
     *     // ... the filter for the Locations we want to count
     *   }
     * })
    **/
    count<T extends LocationCountArgs>(
      args?: Subset<T, LocationCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], LocationCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Location.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocationAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends LocationAggregateArgs>(args: Subset<T, LocationAggregateArgs>): Prisma.PrismaPromise<GetLocationAggregateType<T>>

    /**
     * Group by Location.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocationGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends LocationGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: LocationGroupByArgs['orderBy'] }
        : { orderBy?: LocationGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, LocationGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetLocationGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Location model
   */
  readonly fields: LocationFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Location.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__LocationClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    appointments<T extends Location$appointmentsArgs<ExtArgs> = {}>(args?: Subset<T, Location$appointmentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    doctors<T extends Location$doctorsArgs<ExtArgs> = {}>(args?: Subset<T, Location$doctorsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$DoctorLocationPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Location model
   */
  interface LocationFieldRefs {
    readonly id: FieldRef<"Location", 'String'>
    readonly name: FieldRef<"Location", 'String'>
    readonly address: FieldRef<"Location", 'String'>
    readonly city: FieldRef<"Location", 'String'>
    readonly state: FieldRef<"Location", 'String'>
    readonly country: FieldRef<"Location", 'String'>
    readonly zipCode: FieldRef<"Location", 'String'>
    readonly phone: FieldRef<"Location", 'String'>
    readonly email: FieldRef<"Location", 'String'>
    readonly isActive: FieldRef<"Location", 'Boolean'>
    readonly isMainBranch: FieldRef<"Location", 'Boolean'>
    readonly createdAt: FieldRef<"Location", 'DateTime'>
    readonly updatedAt: FieldRef<"Location", 'DateTime'>
    readonly latitude: FieldRef<"Location", 'Float'>
    readonly longitude: FieldRef<"Location", 'Float'>
    readonly timezone: FieldRef<"Location", 'String'>
    readonly workingHours: FieldRef<"Location", 'Json'>
  }
    

  // Custom InputTypes
  /**
   * Location findUnique
   */
  export type LocationFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LocationInclude<ExtArgs> | null
    /**
     * Filter, which Location to fetch.
     */
    where: LocationWhereUniqueInput
  }

  /**
   * Location findUniqueOrThrow
   */
  export type LocationFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LocationInclude<ExtArgs> | null
    /**
     * Filter, which Location to fetch.
     */
    where: LocationWhereUniqueInput
  }

  /**
   * Location findFirst
   */
  export type LocationFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LocationInclude<ExtArgs> | null
    /**
     * Filter, which Location to fetch.
     */
    where?: LocationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Locations to fetch.
     */
    orderBy?: LocationOrderByWithRelationInput | LocationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Locations.
     */
    cursor?: LocationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Locations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Locations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Locations.
     */
    distinct?: LocationScalarFieldEnum | LocationScalarFieldEnum[]
  }

  /**
   * Location findFirstOrThrow
   */
  export type LocationFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LocationInclude<ExtArgs> | null
    /**
     * Filter, which Location to fetch.
     */
    where?: LocationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Locations to fetch.
     */
    orderBy?: LocationOrderByWithRelationInput | LocationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Locations.
     */
    cursor?: LocationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Locations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Locations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Locations.
     */
    distinct?: LocationScalarFieldEnum | LocationScalarFieldEnum[]
  }

  /**
   * Location findMany
   */
  export type LocationFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LocationInclude<ExtArgs> | null
    /**
     * Filter, which Locations to fetch.
     */
    where?: LocationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Locations to fetch.
     */
    orderBy?: LocationOrderByWithRelationInput | LocationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Locations.
     */
    cursor?: LocationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Locations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Locations.
     */
    skip?: number
    distinct?: LocationScalarFieldEnum | LocationScalarFieldEnum[]
  }

  /**
   * Location create
   */
  export type LocationCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LocationInclude<ExtArgs> | null
    /**
     * The data needed to create a Location.
     */
    data: XOR<LocationCreateInput, LocationUncheckedCreateInput>
  }

  /**
   * Location createMany
   */
  export type LocationCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Locations.
     */
    data: LocationCreateManyInput | LocationCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Location createManyAndReturn
   */
  export type LocationCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * The data used to create many Locations.
     */
    data: LocationCreateManyInput | LocationCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Location update
   */
  export type LocationUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LocationInclude<ExtArgs> | null
    /**
     * The data needed to update a Location.
     */
    data: XOR<LocationUpdateInput, LocationUncheckedUpdateInput>
    /**
     * Choose, which Location to update.
     */
    where: LocationWhereUniqueInput
  }

  /**
   * Location updateMany
   */
  export type LocationUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Locations.
     */
    data: XOR<LocationUpdateManyMutationInput, LocationUncheckedUpdateManyInput>
    /**
     * Filter which Locations to update
     */
    where?: LocationWhereInput
    /**
     * Limit how many Locations to update.
     */
    limit?: number
  }

  /**
   * Location updateManyAndReturn
   */
  export type LocationUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * The data used to update Locations.
     */
    data: XOR<LocationUpdateManyMutationInput, LocationUncheckedUpdateManyInput>
    /**
     * Filter which Locations to update
     */
    where?: LocationWhereInput
    /**
     * Limit how many Locations to update.
     */
    limit?: number
  }

  /**
   * Location upsert
   */
  export type LocationUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LocationInclude<ExtArgs> | null
    /**
     * The filter to search for the Location to update in case it exists.
     */
    where: LocationWhereUniqueInput
    /**
     * In case the Location found by the `where` argument doesn't exist, create a new Location with this data.
     */
    create: XOR<LocationCreateInput, LocationUncheckedCreateInput>
    /**
     * In case the Location was found with the provided `where` argument, update it with this data.
     */
    update: XOR<LocationUpdateInput, LocationUncheckedUpdateInput>
  }

  /**
   * Location delete
   */
  export type LocationDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LocationInclude<ExtArgs> | null
    /**
     * Filter which Location to delete.
     */
    where: LocationWhereUniqueInput
  }

  /**
   * Location deleteMany
   */
  export type LocationDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Locations to delete
     */
    where?: LocationWhereInput
    /**
     * Limit how many Locations to delete.
     */
    limit?: number
  }

  /**
   * Location.appointments
   */
  export type Location$appointmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    where?: AppointmentWhereInput
    orderBy?: AppointmentOrderByWithRelationInput | AppointmentOrderByWithRelationInput[]
    cursor?: AppointmentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AppointmentScalarFieldEnum | AppointmentScalarFieldEnum[]
  }

  /**
   * Location.doctors
   */
  export type Location$doctorsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DoctorLocation
     */
    select?: DoctorLocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the DoctorLocation
     */
    omit?: DoctorLocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: DoctorLocationInclude<ExtArgs> | null
    where?: DoctorLocationWhereInput
    orderBy?: DoctorLocationOrderByWithRelationInput | DoctorLocationOrderByWithRelationInput[]
    cursor?: DoctorLocationWhereUniqueInput
    take?: number
    skip?: number
    distinct?: DoctorLocationScalarFieldEnum | DoctorLocationScalarFieldEnum[]
  }

  /**
   * Location without action
   */
  export type LocationDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Location
     */
    select?: LocationSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Location
     */
    omit?: LocationOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LocationInclude<ExtArgs> | null
  }


  /**
   * Model Appointment
   */

  export type AggregateAppointment = {
    _count: AppointmentCountAggregateOutputType | null
    _avg: AppointmentAvgAggregateOutputType | null
    _sum: AppointmentSumAggregateOutputType | null
    _min: AppointmentMinAggregateOutputType | null
    _max: AppointmentMaxAggregateOutputType | null
  }

  export type AppointmentAvgAggregateOutputType = {
    duration: number | null
  }

  export type AppointmentSumAggregateOutputType = {
    duration: number | null
  }

  export type AppointmentMinAggregateOutputType = {
    id: string | null
    type: $Enums.AppointmentType | null
    doctorId: string | null
    patientId: string | null
    locationId: string | null
    date: Date | null
    time: string | null
    duration: number | null
    status: $Enums.AppointmentStatus | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
    therapyId: string | null
    startedAt: Date | null
    checkedInAt: Date | null
    completedAt: Date | null
  }

  export type AppointmentMaxAggregateOutputType = {
    id: string | null
    type: $Enums.AppointmentType | null
    doctorId: string | null
    patientId: string | null
    locationId: string | null
    date: Date | null
    time: string | null
    duration: number | null
    status: $Enums.AppointmentStatus | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
    therapyId: string | null
    startedAt: Date | null
    checkedInAt: Date | null
    completedAt: Date | null
  }

  export type AppointmentCountAggregateOutputType = {
    id: number
    type: number
    doctorId: number
    patientId: number
    locationId: number
    date: number
    time: number
    duration: number
    status: number
    notes: number
    createdAt: number
    updatedAt: number
    therapyId: number
    startedAt: number
    checkedInAt: number
    completedAt: number
    _all: number
  }


  export type AppointmentAvgAggregateInputType = {
    duration?: true
  }

  export type AppointmentSumAggregateInputType = {
    duration?: true
  }

  export type AppointmentMinAggregateInputType = {
    id?: true
    type?: true
    doctorId?: true
    patientId?: true
    locationId?: true
    date?: true
    time?: true
    duration?: true
    status?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
    therapyId?: true
    startedAt?: true
    checkedInAt?: true
    completedAt?: true
  }

  export type AppointmentMaxAggregateInputType = {
    id?: true
    type?: true
    doctorId?: true
    patientId?: true
    locationId?: true
    date?: true
    time?: true
    duration?: true
    status?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
    therapyId?: true
    startedAt?: true
    checkedInAt?: true
    completedAt?: true
  }

  export type AppointmentCountAggregateInputType = {
    id?: true
    type?: true
    doctorId?: true
    patientId?: true
    locationId?: true
    date?: true
    time?: true
    duration?: true
    status?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
    therapyId?: true
    startedAt?: true
    checkedInAt?: true
    completedAt?: true
    _all?: true
  }

  export type AppointmentAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Appointment to aggregate.
     */
    where?: AppointmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Appointments to fetch.
     */
    orderBy?: AppointmentOrderByWithRelationInput | AppointmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AppointmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Appointments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Appointments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Appointments
    **/
    _count?: true | AppointmentCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: AppointmentAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: AppointmentSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AppointmentMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AppointmentMaxAggregateInputType
  }

  export type GetAppointmentAggregateType<T extends AppointmentAggregateArgs> = {
        [P in keyof T & keyof AggregateAppointment]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAppointment[P]>
      : GetScalarType<T[P], AggregateAppointment[P]>
  }




  export type AppointmentGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AppointmentWhereInput
    orderBy?: AppointmentOrderByWithAggregationInput | AppointmentOrderByWithAggregationInput[]
    by: AppointmentScalarFieldEnum[] | AppointmentScalarFieldEnum
    having?: AppointmentScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AppointmentCountAggregateInputType | true
    _avg?: AppointmentAvgAggregateInputType
    _sum?: AppointmentSumAggregateInputType
    _min?: AppointmentMinAggregateInputType
    _max?: AppointmentMaxAggregateInputType
  }

  export type AppointmentGroupByOutputType = {
    id: string
    type: $Enums.AppointmentType
    doctorId: string
    patientId: string
    locationId: string
    date: Date
    time: string
    duration: number
    status: $Enums.AppointmentStatus
    notes: string | null
    createdAt: Date
    updatedAt: Date
    therapyId: string | null
    startedAt: Date | null
    checkedInAt: Date | null
    completedAt: Date | null
    _count: AppointmentCountAggregateOutputType | null
    _avg: AppointmentAvgAggregateOutputType | null
    _sum: AppointmentSumAggregateOutputType | null
    _min: AppointmentMinAggregateOutputType | null
    _max: AppointmentMaxAggregateOutputType | null
  }

  type GetAppointmentGroupByPayload<T extends AppointmentGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AppointmentGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AppointmentGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AppointmentGroupByOutputType[P]>
            : GetScalarType<T[P], AppointmentGroupByOutputType[P]>
        }
      >
    >


  export type AppointmentSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    type?: boolean
    doctorId?: boolean
    patientId?: boolean
    locationId?: boolean
    date?: boolean
    time?: boolean
    duration?: boolean
    status?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    therapyId?: boolean
    startedAt?: boolean
    checkedInAt?: boolean
    completedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
    therapy?: boolean | Appointment$therapyArgs<ExtArgs>
    payment?: boolean | Appointment$paymentArgs<ExtArgs>
    queueItem?: boolean | Appointment$queueItemArgs<ExtArgs>
  }, ExtArgs["result"]["appointment"]>

  export type AppointmentSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    type?: boolean
    doctorId?: boolean
    patientId?: boolean
    locationId?: boolean
    date?: boolean
    time?: boolean
    duration?: boolean
    status?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    therapyId?: boolean
    startedAt?: boolean
    checkedInAt?: boolean
    completedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
    therapy?: boolean | Appointment$therapyArgs<ExtArgs>
  }, ExtArgs["result"]["appointment"]>

  export type AppointmentSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    type?: boolean
    doctorId?: boolean
    patientId?: boolean
    locationId?: boolean
    date?: boolean
    time?: boolean
    duration?: boolean
    status?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    therapyId?: boolean
    startedAt?: boolean
    checkedInAt?: boolean
    completedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
    therapy?: boolean | Appointment$therapyArgs<ExtArgs>
  }, ExtArgs["result"]["appointment"]>

  export type AppointmentSelectScalar = {
    id?: boolean
    type?: boolean
    doctorId?: boolean
    patientId?: boolean
    locationId?: boolean
    date?: boolean
    time?: boolean
    duration?: boolean
    status?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    therapyId?: boolean
    startedAt?: boolean
    checkedInAt?: boolean
    completedAt?: boolean
  }

  export type AppointmentOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "type" | "doctorId" | "patientId" | "locationId" | "date" | "time" | "duration" | "status" | "notes" | "createdAt" | "updatedAt" | "therapyId" | "startedAt" | "checkedInAt" | "completedAt", ExtArgs["result"]["appointment"]>
  export type AppointmentInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
    therapy?: boolean | Appointment$therapyArgs<ExtArgs>
    payment?: boolean | Appointment$paymentArgs<ExtArgs>
    queueItem?: boolean | Appointment$queueItemArgs<ExtArgs>
  }
  export type AppointmentIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
    therapy?: boolean | Appointment$therapyArgs<ExtArgs>
  }
  export type AppointmentIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
    location?: boolean | LocationDefaultArgs<ExtArgs>
    therapy?: boolean | Appointment$therapyArgs<ExtArgs>
  }

  export type $AppointmentPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Appointment"
    objects: {
      doctor: Prisma.$DoctorPayload<ExtArgs>
      patient: Prisma.$PatientPayload<ExtArgs>
      location: Prisma.$LocationPayload<ExtArgs>
      therapy: Prisma.$TherapyPayload<ExtArgs> | null
      payment: Prisma.$PaymentPayload<ExtArgs> | null
      queueItem: Prisma.$QueueItemPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      type: $Enums.AppointmentType
      doctorId: string
      patientId: string
      locationId: string
      date: Date
      time: string
      duration: number
      status: $Enums.AppointmentStatus
      notes: string | null
      createdAt: Date
      updatedAt: Date
      therapyId: string | null
      startedAt: Date | null
      checkedInAt: Date | null
      completedAt: Date | null
    }, ExtArgs["result"]["appointment"]>
    composites: {}
  }

  type AppointmentGetPayload<S extends boolean | null | undefined | AppointmentDefaultArgs> = $Result.GetResult<Prisma.$AppointmentPayload, S>

  type AppointmentCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<AppointmentFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: AppointmentCountAggregateInputType | true
    }

  export interface AppointmentDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Appointment'], meta: { name: 'Appointment' } }
    /**
     * Find zero or one Appointment that matches the filter.
     * @param {AppointmentFindUniqueArgs} args - Arguments to find a Appointment
     * @example
     * // Get one Appointment
     * const appointment = await prisma.appointment.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AppointmentFindUniqueArgs>(args: SelectSubset<T, AppointmentFindUniqueArgs<ExtArgs>>): Prisma__AppointmentClient<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Appointment that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {AppointmentFindUniqueOrThrowArgs} args - Arguments to find a Appointment
     * @example
     * // Get one Appointment
     * const appointment = await prisma.appointment.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AppointmentFindUniqueOrThrowArgs>(args: SelectSubset<T, AppointmentFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AppointmentClient<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Appointment that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppointmentFindFirstArgs} args - Arguments to find a Appointment
     * @example
     * // Get one Appointment
     * const appointment = await prisma.appointment.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AppointmentFindFirstArgs>(args?: SelectSubset<T, AppointmentFindFirstArgs<ExtArgs>>): Prisma__AppointmentClient<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Appointment that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppointmentFindFirstOrThrowArgs} args - Arguments to find a Appointment
     * @example
     * // Get one Appointment
     * const appointment = await prisma.appointment.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AppointmentFindFirstOrThrowArgs>(args?: SelectSubset<T, AppointmentFindFirstOrThrowArgs<ExtArgs>>): Prisma__AppointmentClient<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Appointments that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppointmentFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Appointments
     * const appointments = await prisma.appointment.findMany()
     * 
     * // Get first 10 Appointments
     * const appointments = await prisma.appointment.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const appointmentWithIdOnly = await prisma.appointment.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends AppointmentFindManyArgs>(args?: SelectSubset<T, AppointmentFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Appointment.
     * @param {AppointmentCreateArgs} args - Arguments to create a Appointment.
     * @example
     * // Create one Appointment
     * const Appointment = await prisma.appointment.create({
     *   data: {
     *     // ... data to create a Appointment
     *   }
     * })
     * 
     */
    create<T extends AppointmentCreateArgs>(args: SelectSubset<T, AppointmentCreateArgs<ExtArgs>>): Prisma__AppointmentClient<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Appointments.
     * @param {AppointmentCreateManyArgs} args - Arguments to create many Appointments.
     * @example
     * // Create many Appointments
     * const appointment = await prisma.appointment.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AppointmentCreateManyArgs>(args?: SelectSubset<T, AppointmentCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Appointments and returns the data saved in the database.
     * @param {AppointmentCreateManyAndReturnArgs} args - Arguments to create many Appointments.
     * @example
     * // Create many Appointments
     * const appointment = await prisma.appointment.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Appointments and only return the `id`
     * const appointmentWithIdOnly = await prisma.appointment.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AppointmentCreateManyAndReturnArgs>(args?: SelectSubset<T, AppointmentCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Appointment.
     * @param {AppointmentDeleteArgs} args - Arguments to delete one Appointment.
     * @example
     * // Delete one Appointment
     * const Appointment = await prisma.appointment.delete({
     *   where: {
     *     // ... filter to delete one Appointment
     *   }
     * })
     * 
     */
    delete<T extends AppointmentDeleteArgs>(args: SelectSubset<T, AppointmentDeleteArgs<ExtArgs>>): Prisma__AppointmentClient<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Appointment.
     * @param {AppointmentUpdateArgs} args - Arguments to update one Appointment.
     * @example
     * // Update one Appointment
     * const appointment = await prisma.appointment.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AppointmentUpdateArgs>(args: SelectSubset<T, AppointmentUpdateArgs<ExtArgs>>): Prisma__AppointmentClient<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Appointments.
     * @param {AppointmentDeleteManyArgs} args - Arguments to filter Appointments to delete.
     * @example
     * // Delete a few Appointments
     * const { count } = await prisma.appointment.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AppointmentDeleteManyArgs>(args?: SelectSubset<T, AppointmentDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Appointments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppointmentUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Appointments
     * const appointment = await prisma.appointment.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AppointmentUpdateManyArgs>(args: SelectSubset<T, AppointmentUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Appointments and returns the data updated in the database.
     * @param {AppointmentUpdateManyAndReturnArgs} args - Arguments to update many Appointments.
     * @example
     * // Update many Appointments
     * const appointment = await prisma.appointment.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Appointments and only return the `id`
     * const appointmentWithIdOnly = await prisma.appointment.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends AppointmentUpdateManyAndReturnArgs>(args: SelectSubset<T, AppointmentUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Appointment.
     * @param {AppointmentUpsertArgs} args - Arguments to update or create a Appointment.
     * @example
     * // Update or create a Appointment
     * const appointment = await prisma.appointment.upsert({
     *   create: {
     *     // ... data to create a Appointment
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Appointment we want to update
     *   }
     * })
     */
    upsert<T extends AppointmentUpsertArgs>(args: SelectSubset<T, AppointmentUpsertArgs<ExtArgs>>): Prisma__AppointmentClient<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Appointments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppointmentCountArgs} args - Arguments to filter Appointments to count.
     * @example
     * // Count the number of Appointments
     * const count = await prisma.appointment.count({
     *   where: {
     *     // ... the filter for the Appointments we want to count
     *   }
     * })
    **/
    count<T extends AppointmentCountArgs>(
      args?: Subset<T, AppointmentCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AppointmentCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Appointment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppointmentAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AppointmentAggregateArgs>(args: Subset<T, AppointmentAggregateArgs>): Prisma.PrismaPromise<GetAppointmentAggregateType<T>>

    /**
     * Group by Appointment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppointmentGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AppointmentGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AppointmentGroupByArgs['orderBy'] }
        : { orderBy?: AppointmentGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AppointmentGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAppointmentGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Appointment model
   */
  readonly fields: AppointmentFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Appointment.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AppointmentClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    doctor<T extends DoctorDefaultArgs<ExtArgs> = {}>(args?: Subset<T, DoctorDefaultArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    patient<T extends PatientDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PatientDefaultArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    location<T extends LocationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, LocationDefaultArgs<ExtArgs>>): Prisma__LocationClient<$Result.GetResult<Prisma.$LocationPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    therapy<T extends Appointment$therapyArgs<ExtArgs> = {}>(args?: Subset<T, Appointment$therapyArgs<ExtArgs>>): Prisma__TherapyClient<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    payment<T extends Appointment$paymentArgs<ExtArgs> = {}>(args?: Subset<T, Appointment$paymentArgs<ExtArgs>>): Prisma__PaymentClient<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    queueItem<T extends Appointment$queueItemArgs<ExtArgs> = {}>(args?: Subset<T, Appointment$queueItemArgs<ExtArgs>>): Prisma__QueueItemClient<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Appointment model
   */
  interface AppointmentFieldRefs {
    readonly id: FieldRef<"Appointment", 'String'>
    readonly type: FieldRef<"Appointment", 'AppointmentType'>
    readonly doctorId: FieldRef<"Appointment", 'String'>
    readonly patientId: FieldRef<"Appointment", 'String'>
    readonly locationId: FieldRef<"Appointment", 'String'>
    readonly date: FieldRef<"Appointment", 'DateTime'>
    readonly time: FieldRef<"Appointment", 'String'>
    readonly duration: FieldRef<"Appointment", 'Int'>
    readonly status: FieldRef<"Appointment", 'AppointmentStatus'>
    readonly notes: FieldRef<"Appointment", 'String'>
    readonly createdAt: FieldRef<"Appointment", 'DateTime'>
    readonly updatedAt: FieldRef<"Appointment", 'DateTime'>
    readonly therapyId: FieldRef<"Appointment", 'String'>
    readonly startedAt: FieldRef<"Appointment", 'DateTime'>
    readonly checkedInAt: FieldRef<"Appointment", 'DateTime'>
    readonly completedAt: FieldRef<"Appointment", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Appointment findUnique
   */
  export type AppointmentFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    /**
     * Filter, which Appointment to fetch.
     */
    where: AppointmentWhereUniqueInput
  }

  /**
   * Appointment findUniqueOrThrow
   */
  export type AppointmentFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    /**
     * Filter, which Appointment to fetch.
     */
    where: AppointmentWhereUniqueInput
  }

  /**
   * Appointment findFirst
   */
  export type AppointmentFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    /**
     * Filter, which Appointment to fetch.
     */
    where?: AppointmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Appointments to fetch.
     */
    orderBy?: AppointmentOrderByWithRelationInput | AppointmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Appointments.
     */
    cursor?: AppointmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Appointments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Appointments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Appointments.
     */
    distinct?: AppointmentScalarFieldEnum | AppointmentScalarFieldEnum[]
  }

  /**
   * Appointment findFirstOrThrow
   */
  export type AppointmentFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    /**
     * Filter, which Appointment to fetch.
     */
    where?: AppointmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Appointments to fetch.
     */
    orderBy?: AppointmentOrderByWithRelationInput | AppointmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Appointments.
     */
    cursor?: AppointmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Appointments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Appointments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Appointments.
     */
    distinct?: AppointmentScalarFieldEnum | AppointmentScalarFieldEnum[]
  }

  /**
   * Appointment findMany
   */
  export type AppointmentFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    /**
     * Filter, which Appointments to fetch.
     */
    where?: AppointmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Appointments to fetch.
     */
    orderBy?: AppointmentOrderByWithRelationInput | AppointmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Appointments.
     */
    cursor?: AppointmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Appointments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Appointments.
     */
    skip?: number
    distinct?: AppointmentScalarFieldEnum | AppointmentScalarFieldEnum[]
  }

  /**
   * Appointment create
   */
  export type AppointmentCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    /**
     * The data needed to create a Appointment.
     */
    data: XOR<AppointmentCreateInput, AppointmentUncheckedCreateInput>
  }

  /**
   * Appointment createMany
   */
  export type AppointmentCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Appointments.
     */
    data: AppointmentCreateManyInput | AppointmentCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Appointment createManyAndReturn
   */
  export type AppointmentCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * The data used to create many Appointments.
     */
    data: AppointmentCreateManyInput | AppointmentCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Appointment update
   */
  export type AppointmentUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    /**
     * The data needed to update a Appointment.
     */
    data: XOR<AppointmentUpdateInput, AppointmentUncheckedUpdateInput>
    /**
     * Choose, which Appointment to update.
     */
    where: AppointmentWhereUniqueInput
  }

  /**
   * Appointment updateMany
   */
  export type AppointmentUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Appointments.
     */
    data: XOR<AppointmentUpdateManyMutationInput, AppointmentUncheckedUpdateManyInput>
    /**
     * Filter which Appointments to update
     */
    where?: AppointmentWhereInput
    /**
     * Limit how many Appointments to update.
     */
    limit?: number
  }

  /**
   * Appointment updateManyAndReturn
   */
  export type AppointmentUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * The data used to update Appointments.
     */
    data: XOR<AppointmentUpdateManyMutationInput, AppointmentUncheckedUpdateManyInput>
    /**
     * Filter which Appointments to update
     */
    where?: AppointmentWhereInput
    /**
     * Limit how many Appointments to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * Appointment upsert
   */
  export type AppointmentUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    /**
     * The filter to search for the Appointment to update in case it exists.
     */
    where: AppointmentWhereUniqueInput
    /**
     * In case the Appointment found by the `where` argument doesn't exist, create a new Appointment with this data.
     */
    create: XOR<AppointmentCreateInput, AppointmentUncheckedCreateInput>
    /**
     * In case the Appointment was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AppointmentUpdateInput, AppointmentUncheckedUpdateInput>
  }

  /**
   * Appointment delete
   */
  export type AppointmentDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    /**
     * Filter which Appointment to delete.
     */
    where: AppointmentWhereUniqueInput
  }

  /**
   * Appointment deleteMany
   */
  export type AppointmentDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Appointments to delete
     */
    where?: AppointmentWhereInput
    /**
     * Limit how many Appointments to delete.
     */
    limit?: number
  }

  /**
   * Appointment.therapy
   */
  export type Appointment$therapyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
    where?: TherapyWhereInput
  }

  /**
   * Appointment.payment
   */
  export type Appointment$paymentArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
    where?: PaymentWhereInput
  }

  /**
   * Appointment.queueItem
   */
  export type Appointment$queueItemArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
    where?: QueueItemWhereInput
  }

  /**
   * Appointment without action
   */
  export type AppointmentDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
  }


  /**
   * Model Therapy
   */

  export type AggregateTherapy = {
    _count: TherapyCountAggregateOutputType | null
    _avg: TherapyAvgAggregateOutputType | null
    _sum: TherapySumAggregateOutputType | null
    _min: TherapyMinAggregateOutputType | null
    _max: TherapyMaxAggregateOutputType | null
  }

  export type TherapyAvgAggregateOutputType = {
    duration: number | null
  }

  export type TherapySumAggregateOutputType = {
    duration: number | null
  }

  export type TherapyMinAggregateOutputType = {
    id: string | null
    name: string | null
    description: string | null
    duration: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TherapyMaxAggregateOutputType = {
    id: string | null
    name: string | null
    description: string | null
    duration: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TherapyCountAggregateOutputType = {
    id: number
    name: number
    description: number
    duration: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type TherapyAvgAggregateInputType = {
    duration?: true
  }

  export type TherapySumAggregateInputType = {
    duration?: true
  }

  export type TherapyMinAggregateInputType = {
    id?: true
    name?: true
    description?: true
    duration?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TherapyMaxAggregateInputType = {
    id?: true
    name?: true
    description?: true
    duration?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TherapyCountAggregateInputType = {
    id?: true
    name?: true
    description?: true
    duration?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type TherapyAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Therapy to aggregate.
     */
    where?: TherapyWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Therapies to fetch.
     */
    orderBy?: TherapyOrderByWithRelationInput | TherapyOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TherapyWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Therapies from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Therapies.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Therapies
    **/
    _count?: true | TherapyCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: TherapyAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: TherapySumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TherapyMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TherapyMaxAggregateInputType
  }

  export type GetTherapyAggregateType<T extends TherapyAggregateArgs> = {
        [P in keyof T & keyof AggregateTherapy]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTherapy[P]>
      : GetScalarType<T[P], AggregateTherapy[P]>
  }




  export type TherapyGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TherapyWhereInput
    orderBy?: TherapyOrderByWithAggregationInput | TherapyOrderByWithAggregationInput[]
    by: TherapyScalarFieldEnum[] | TherapyScalarFieldEnum
    having?: TherapyScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TherapyCountAggregateInputType | true
    _avg?: TherapyAvgAggregateInputType
    _sum?: TherapySumAggregateInputType
    _min?: TherapyMinAggregateInputType
    _max?: TherapyMaxAggregateInputType
  }

  export type TherapyGroupByOutputType = {
    id: string
    name: string
    description: string | null
    duration: number | null
    createdAt: Date
    updatedAt: Date
    _count: TherapyCountAggregateOutputType | null
    _avg: TherapyAvgAggregateOutputType | null
    _sum: TherapySumAggregateOutputType | null
    _min: TherapyMinAggregateOutputType | null
    _max: TherapyMaxAggregateOutputType | null
  }

  type GetTherapyGroupByPayload<T extends TherapyGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TherapyGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TherapyGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TherapyGroupByOutputType[P]>
            : GetScalarType<T[P], TherapyGroupByOutputType[P]>
        }
      >
    >


  export type TherapySelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    description?: boolean
    duration?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    appointments?: boolean | Therapy$appointmentsArgs<ExtArgs>
    _count?: boolean | TherapyCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["therapy"]>

  export type TherapySelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    description?: boolean
    duration?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["therapy"]>

  export type TherapySelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    description?: boolean
    duration?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["therapy"]>

  export type TherapySelectScalar = {
    id?: boolean
    name?: boolean
    description?: boolean
    duration?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type TherapyOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "name" | "description" | "duration" | "createdAt" | "updatedAt", ExtArgs["result"]["therapy"]>
  export type TherapyInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointments?: boolean | Therapy$appointmentsArgs<ExtArgs>
    _count?: boolean | TherapyCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type TherapyIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type TherapyIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $TherapyPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Therapy"
    objects: {
      appointments: Prisma.$AppointmentPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      description: string | null
      duration: number | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["therapy"]>
    composites: {}
  }

  type TherapyGetPayload<S extends boolean | null | undefined | TherapyDefaultArgs> = $Result.GetResult<Prisma.$TherapyPayload, S>

  type TherapyCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<TherapyFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: TherapyCountAggregateInputType | true
    }

  export interface TherapyDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Therapy'], meta: { name: 'Therapy' } }
    /**
     * Find zero or one Therapy that matches the filter.
     * @param {TherapyFindUniqueArgs} args - Arguments to find a Therapy
     * @example
     * // Get one Therapy
     * const therapy = await prisma.therapy.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TherapyFindUniqueArgs>(args: SelectSubset<T, TherapyFindUniqueArgs<ExtArgs>>): Prisma__TherapyClient<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Therapy that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {TherapyFindUniqueOrThrowArgs} args - Arguments to find a Therapy
     * @example
     * // Get one Therapy
     * const therapy = await prisma.therapy.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TherapyFindUniqueOrThrowArgs>(args: SelectSubset<T, TherapyFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TherapyClient<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Therapy that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TherapyFindFirstArgs} args - Arguments to find a Therapy
     * @example
     * // Get one Therapy
     * const therapy = await prisma.therapy.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TherapyFindFirstArgs>(args?: SelectSubset<T, TherapyFindFirstArgs<ExtArgs>>): Prisma__TherapyClient<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Therapy that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TherapyFindFirstOrThrowArgs} args - Arguments to find a Therapy
     * @example
     * // Get one Therapy
     * const therapy = await prisma.therapy.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TherapyFindFirstOrThrowArgs>(args?: SelectSubset<T, TherapyFindFirstOrThrowArgs<ExtArgs>>): Prisma__TherapyClient<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Therapies that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TherapyFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Therapies
     * const therapies = await prisma.therapy.findMany()
     * 
     * // Get first 10 Therapies
     * const therapies = await prisma.therapy.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const therapyWithIdOnly = await prisma.therapy.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TherapyFindManyArgs>(args?: SelectSubset<T, TherapyFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Therapy.
     * @param {TherapyCreateArgs} args - Arguments to create a Therapy.
     * @example
     * // Create one Therapy
     * const Therapy = await prisma.therapy.create({
     *   data: {
     *     // ... data to create a Therapy
     *   }
     * })
     * 
     */
    create<T extends TherapyCreateArgs>(args: SelectSubset<T, TherapyCreateArgs<ExtArgs>>): Prisma__TherapyClient<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Therapies.
     * @param {TherapyCreateManyArgs} args - Arguments to create many Therapies.
     * @example
     * // Create many Therapies
     * const therapy = await prisma.therapy.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TherapyCreateManyArgs>(args?: SelectSubset<T, TherapyCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Therapies and returns the data saved in the database.
     * @param {TherapyCreateManyAndReturnArgs} args - Arguments to create many Therapies.
     * @example
     * // Create many Therapies
     * const therapy = await prisma.therapy.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Therapies and only return the `id`
     * const therapyWithIdOnly = await prisma.therapy.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TherapyCreateManyAndReturnArgs>(args?: SelectSubset<T, TherapyCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Therapy.
     * @param {TherapyDeleteArgs} args - Arguments to delete one Therapy.
     * @example
     * // Delete one Therapy
     * const Therapy = await prisma.therapy.delete({
     *   where: {
     *     // ... filter to delete one Therapy
     *   }
     * })
     * 
     */
    delete<T extends TherapyDeleteArgs>(args: SelectSubset<T, TherapyDeleteArgs<ExtArgs>>): Prisma__TherapyClient<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Therapy.
     * @param {TherapyUpdateArgs} args - Arguments to update one Therapy.
     * @example
     * // Update one Therapy
     * const therapy = await prisma.therapy.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TherapyUpdateArgs>(args: SelectSubset<T, TherapyUpdateArgs<ExtArgs>>): Prisma__TherapyClient<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Therapies.
     * @param {TherapyDeleteManyArgs} args - Arguments to filter Therapies to delete.
     * @example
     * // Delete a few Therapies
     * const { count } = await prisma.therapy.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TherapyDeleteManyArgs>(args?: SelectSubset<T, TherapyDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Therapies.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TherapyUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Therapies
     * const therapy = await prisma.therapy.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TherapyUpdateManyArgs>(args: SelectSubset<T, TherapyUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Therapies and returns the data updated in the database.
     * @param {TherapyUpdateManyAndReturnArgs} args - Arguments to update many Therapies.
     * @example
     * // Update many Therapies
     * const therapy = await prisma.therapy.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Therapies and only return the `id`
     * const therapyWithIdOnly = await prisma.therapy.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends TherapyUpdateManyAndReturnArgs>(args: SelectSubset<T, TherapyUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Therapy.
     * @param {TherapyUpsertArgs} args - Arguments to update or create a Therapy.
     * @example
     * // Update or create a Therapy
     * const therapy = await prisma.therapy.upsert({
     *   create: {
     *     // ... data to create a Therapy
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Therapy we want to update
     *   }
     * })
     */
    upsert<T extends TherapyUpsertArgs>(args: SelectSubset<T, TherapyUpsertArgs<ExtArgs>>): Prisma__TherapyClient<$Result.GetResult<Prisma.$TherapyPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Therapies.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TherapyCountArgs} args - Arguments to filter Therapies to count.
     * @example
     * // Count the number of Therapies
     * const count = await prisma.therapy.count({
     *   where: {
     *     // ... the filter for the Therapies we want to count
     *   }
     * })
    **/
    count<T extends TherapyCountArgs>(
      args?: Subset<T, TherapyCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TherapyCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Therapy.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TherapyAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TherapyAggregateArgs>(args: Subset<T, TherapyAggregateArgs>): Prisma.PrismaPromise<GetTherapyAggregateType<T>>

    /**
     * Group by Therapy.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TherapyGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TherapyGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TherapyGroupByArgs['orderBy'] }
        : { orderBy?: TherapyGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TherapyGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTherapyGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Therapy model
   */
  readonly fields: TherapyFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Therapy.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TherapyClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    appointments<T extends Therapy$appointmentsArgs<ExtArgs> = {}>(args?: Subset<T, Therapy$appointmentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Therapy model
   */
  interface TherapyFieldRefs {
    readonly id: FieldRef<"Therapy", 'String'>
    readonly name: FieldRef<"Therapy", 'String'>
    readonly description: FieldRef<"Therapy", 'String'>
    readonly duration: FieldRef<"Therapy", 'Int'>
    readonly createdAt: FieldRef<"Therapy", 'DateTime'>
    readonly updatedAt: FieldRef<"Therapy", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Therapy findUnique
   */
  export type TherapyFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
    /**
     * Filter, which Therapy to fetch.
     */
    where: TherapyWhereUniqueInput
  }

  /**
   * Therapy findUniqueOrThrow
   */
  export type TherapyFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
    /**
     * Filter, which Therapy to fetch.
     */
    where: TherapyWhereUniqueInput
  }

  /**
   * Therapy findFirst
   */
  export type TherapyFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
    /**
     * Filter, which Therapy to fetch.
     */
    where?: TherapyWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Therapies to fetch.
     */
    orderBy?: TherapyOrderByWithRelationInput | TherapyOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Therapies.
     */
    cursor?: TherapyWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Therapies from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Therapies.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Therapies.
     */
    distinct?: TherapyScalarFieldEnum | TherapyScalarFieldEnum[]
  }

  /**
   * Therapy findFirstOrThrow
   */
  export type TherapyFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
    /**
     * Filter, which Therapy to fetch.
     */
    where?: TherapyWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Therapies to fetch.
     */
    orderBy?: TherapyOrderByWithRelationInput | TherapyOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Therapies.
     */
    cursor?: TherapyWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Therapies from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Therapies.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Therapies.
     */
    distinct?: TherapyScalarFieldEnum | TherapyScalarFieldEnum[]
  }

  /**
   * Therapy findMany
   */
  export type TherapyFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
    /**
     * Filter, which Therapies to fetch.
     */
    where?: TherapyWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Therapies to fetch.
     */
    orderBy?: TherapyOrderByWithRelationInput | TherapyOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Therapies.
     */
    cursor?: TherapyWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Therapies from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Therapies.
     */
    skip?: number
    distinct?: TherapyScalarFieldEnum | TherapyScalarFieldEnum[]
  }

  /**
   * Therapy create
   */
  export type TherapyCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
    /**
     * The data needed to create a Therapy.
     */
    data: XOR<TherapyCreateInput, TherapyUncheckedCreateInput>
  }

  /**
   * Therapy createMany
   */
  export type TherapyCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Therapies.
     */
    data: TherapyCreateManyInput | TherapyCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Therapy createManyAndReturn
   */
  export type TherapyCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * The data used to create many Therapies.
     */
    data: TherapyCreateManyInput | TherapyCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Therapy update
   */
  export type TherapyUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
    /**
     * The data needed to update a Therapy.
     */
    data: XOR<TherapyUpdateInput, TherapyUncheckedUpdateInput>
    /**
     * Choose, which Therapy to update.
     */
    where: TherapyWhereUniqueInput
  }

  /**
   * Therapy updateMany
   */
  export type TherapyUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Therapies.
     */
    data: XOR<TherapyUpdateManyMutationInput, TherapyUncheckedUpdateManyInput>
    /**
     * Filter which Therapies to update
     */
    where?: TherapyWhereInput
    /**
     * Limit how many Therapies to update.
     */
    limit?: number
  }

  /**
   * Therapy updateManyAndReturn
   */
  export type TherapyUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * The data used to update Therapies.
     */
    data: XOR<TherapyUpdateManyMutationInput, TherapyUncheckedUpdateManyInput>
    /**
     * Filter which Therapies to update
     */
    where?: TherapyWhereInput
    /**
     * Limit how many Therapies to update.
     */
    limit?: number
  }

  /**
   * Therapy upsert
   */
  export type TherapyUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
    /**
     * The filter to search for the Therapy to update in case it exists.
     */
    where: TherapyWhereUniqueInput
    /**
     * In case the Therapy found by the `where` argument doesn't exist, create a new Therapy with this data.
     */
    create: XOR<TherapyCreateInput, TherapyUncheckedCreateInput>
    /**
     * In case the Therapy was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TherapyUpdateInput, TherapyUncheckedUpdateInput>
  }

  /**
   * Therapy delete
   */
  export type TherapyDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
    /**
     * Filter which Therapy to delete.
     */
    where: TherapyWhereUniqueInput
  }

  /**
   * Therapy deleteMany
   */
  export type TherapyDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Therapies to delete
     */
    where?: TherapyWhereInput
    /**
     * Limit how many Therapies to delete.
     */
    limit?: number
  }

  /**
   * Therapy.appointments
   */
  export type Therapy$appointmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Appointment
     */
    select?: AppointmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Appointment
     */
    omit?: AppointmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AppointmentInclude<ExtArgs> | null
    where?: AppointmentWhereInput
    orderBy?: AppointmentOrderByWithRelationInput | AppointmentOrderByWithRelationInput[]
    cursor?: AppointmentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AppointmentScalarFieldEnum | AppointmentScalarFieldEnum[]
  }

  /**
   * Therapy without action
   */
  export type TherapyDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Therapy
     */
    select?: TherapySelect<ExtArgs> | null
    /**
     * Omit specific fields from the Therapy
     */
    omit?: TherapyOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TherapyInclude<ExtArgs> | null
  }


  /**
   * Model Payment
   */

  export type AggregatePayment = {
    _count: PaymentCountAggregateOutputType | null
    _avg: PaymentAvgAggregateOutputType | null
    _sum: PaymentSumAggregateOutputType | null
    _min: PaymentMinAggregateOutputType | null
    _max: PaymentMaxAggregateOutputType | null
  }

  export type PaymentAvgAggregateOutputType = {
    amount: number | null
  }

  export type PaymentSumAggregateOutputType = {
    amount: number | null
  }

  export type PaymentMinAggregateOutputType = {
    id: string | null
    appointmentId: string | null
    amount: number | null
    status: $Enums.PaymentStatus | null
    method: $Enums.PaymentMethod | null
    transactionId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PaymentMaxAggregateOutputType = {
    id: string | null
    appointmentId: string | null
    amount: number | null
    status: $Enums.PaymentStatus | null
    method: $Enums.PaymentMethod | null
    transactionId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PaymentCountAggregateOutputType = {
    id: number
    appointmentId: number
    amount: number
    status: number
    method: number
    transactionId: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type PaymentAvgAggregateInputType = {
    amount?: true
  }

  export type PaymentSumAggregateInputType = {
    amount?: true
  }

  export type PaymentMinAggregateInputType = {
    id?: true
    appointmentId?: true
    amount?: true
    status?: true
    method?: true
    transactionId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PaymentMaxAggregateInputType = {
    id?: true
    appointmentId?: true
    amount?: true
    status?: true
    method?: true
    transactionId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PaymentCountAggregateInputType = {
    id?: true
    appointmentId?: true
    amount?: true
    status?: true
    method?: true
    transactionId?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type PaymentAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Payment to aggregate.
     */
    where?: PaymentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Payments to fetch.
     */
    orderBy?: PaymentOrderByWithRelationInput | PaymentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PaymentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Payments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Payments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Payments
    **/
    _count?: true | PaymentCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PaymentAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PaymentSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PaymentMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PaymentMaxAggregateInputType
  }

  export type GetPaymentAggregateType<T extends PaymentAggregateArgs> = {
        [P in keyof T & keyof AggregatePayment]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePayment[P]>
      : GetScalarType<T[P], AggregatePayment[P]>
  }




  export type PaymentGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PaymentWhereInput
    orderBy?: PaymentOrderByWithAggregationInput | PaymentOrderByWithAggregationInput[]
    by: PaymentScalarFieldEnum[] | PaymentScalarFieldEnum
    having?: PaymentScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PaymentCountAggregateInputType | true
    _avg?: PaymentAvgAggregateInputType
    _sum?: PaymentSumAggregateInputType
    _min?: PaymentMinAggregateInputType
    _max?: PaymentMaxAggregateInputType
  }

  export type PaymentGroupByOutputType = {
    id: string
    appointmentId: string
    amount: number
    status: $Enums.PaymentStatus
    method: $Enums.PaymentMethod | null
    transactionId: string | null
    createdAt: Date
    updatedAt: Date
    _count: PaymentCountAggregateOutputType | null
    _avg: PaymentAvgAggregateOutputType | null
    _sum: PaymentSumAggregateOutputType | null
    _min: PaymentMinAggregateOutputType | null
    _max: PaymentMaxAggregateOutputType | null
  }

  type GetPaymentGroupByPayload<T extends PaymentGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PaymentGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PaymentGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PaymentGroupByOutputType[P]>
            : GetScalarType<T[P], PaymentGroupByOutputType[P]>
        }
      >
    >


  export type PaymentSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    appointmentId?: boolean
    amount?: boolean
    status?: boolean
    method?: boolean
    transactionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["payment"]>

  export type PaymentSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    appointmentId?: boolean
    amount?: boolean
    status?: boolean
    method?: boolean
    transactionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["payment"]>

  export type PaymentSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    appointmentId?: boolean
    amount?: boolean
    status?: boolean
    method?: boolean
    transactionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["payment"]>

  export type PaymentSelectScalar = {
    id?: boolean
    appointmentId?: boolean
    amount?: boolean
    status?: boolean
    method?: boolean
    transactionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type PaymentOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "appointmentId" | "amount" | "status" | "method" | "transactionId" | "createdAt" | "updatedAt", ExtArgs["result"]["payment"]>
  export type PaymentInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }
  export type PaymentIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }
  export type PaymentIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }

  export type $PaymentPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Payment"
    objects: {
      appointment: Prisma.$AppointmentPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      appointmentId: string
      amount: number
      status: $Enums.PaymentStatus
      method: $Enums.PaymentMethod | null
      transactionId: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["payment"]>
    composites: {}
  }

  type PaymentGetPayload<S extends boolean | null | undefined | PaymentDefaultArgs> = $Result.GetResult<Prisma.$PaymentPayload, S>

  type PaymentCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<PaymentFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PaymentCountAggregateInputType | true
    }

  export interface PaymentDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Payment'], meta: { name: 'Payment' } }
    /**
     * Find zero or one Payment that matches the filter.
     * @param {PaymentFindUniqueArgs} args - Arguments to find a Payment
     * @example
     * // Get one Payment
     * const payment = await prisma.payment.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PaymentFindUniqueArgs>(args: SelectSubset<T, PaymentFindUniqueArgs<ExtArgs>>): Prisma__PaymentClient<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Payment that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {PaymentFindUniqueOrThrowArgs} args - Arguments to find a Payment
     * @example
     * // Get one Payment
     * const payment = await prisma.payment.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PaymentFindUniqueOrThrowArgs>(args: SelectSubset<T, PaymentFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PaymentClient<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Payment that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentFindFirstArgs} args - Arguments to find a Payment
     * @example
     * // Get one Payment
     * const payment = await prisma.payment.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PaymentFindFirstArgs>(args?: SelectSubset<T, PaymentFindFirstArgs<ExtArgs>>): Prisma__PaymentClient<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Payment that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentFindFirstOrThrowArgs} args - Arguments to find a Payment
     * @example
     * // Get one Payment
     * const payment = await prisma.payment.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PaymentFindFirstOrThrowArgs>(args?: SelectSubset<T, PaymentFindFirstOrThrowArgs<ExtArgs>>): Prisma__PaymentClient<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Payments that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Payments
     * const payments = await prisma.payment.findMany()
     * 
     * // Get first 10 Payments
     * const payments = await prisma.payment.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const paymentWithIdOnly = await prisma.payment.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PaymentFindManyArgs>(args?: SelectSubset<T, PaymentFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Payment.
     * @param {PaymentCreateArgs} args - Arguments to create a Payment.
     * @example
     * // Create one Payment
     * const Payment = await prisma.payment.create({
     *   data: {
     *     // ... data to create a Payment
     *   }
     * })
     * 
     */
    create<T extends PaymentCreateArgs>(args: SelectSubset<T, PaymentCreateArgs<ExtArgs>>): Prisma__PaymentClient<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Payments.
     * @param {PaymentCreateManyArgs} args - Arguments to create many Payments.
     * @example
     * // Create many Payments
     * const payment = await prisma.payment.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PaymentCreateManyArgs>(args?: SelectSubset<T, PaymentCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Payments and returns the data saved in the database.
     * @param {PaymentCreateManyAndReturnArgs} args - Arguments to create many Payments.
     * @example
     * // Create many Payments
     * const payment = await prisma.payment.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Payments and only return the `id`
     * const paymentWithIdOnly = await prisma.payment.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PaymentCreateManyAndReturnArgs>(args?: SelectSubset<T, PaymentCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Payment.
     * @param {PaymentDeleteArgs} args - Arguments to delete one Payment.
     * @example
     * // Delete one Payment
     * const Payment = await prisma.payment.delete({
     *   where: {
     *     // ... filter to delete one Payment
     *   }
     * })
     * 
     */
    delete<T extends PaymentDeleteArgs>(args: SelectSubset<T, PaymentDeleteArgs<ExtArgs>>): Prisma__PaymentClient<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Payment.
     * @param {PaymentUpdateArgs} args - Arguments to update one Payment.
     * @example
     * // Update one Payment
     * const payment = await prisma.payment.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PaymentUpdateArgs>(args: SelectSubset<T, PaymentUpdateArgs<ExtArgs>>): Prisma__PaymentClient<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Payments.
     * @param {PaymentDeleteManyArgs} args - Arguments to filter Payments to delete.
     * @example
     * // Delete a few Payments
     * const { count } = await prisma.payment.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PaymentDeleteManyArgs>(args?: SelectSubset<T, PaymentDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Payments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Payments
     * const payment = await prisma.payment.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PaymentUpdateManyArgs>(args: SelectSubset<T, PaymentUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Payments and returns the data updated in the database.
     * @param {PaymentUpdateManyAndReturnArgs} args - Arguments to update many Payments.
     * @example
     * // Update many Payments
     * const payment = await prisma.payment.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Payments and only return the `id`
     * const paymentWithIdOnly = await prisma.payment.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends PaymentUpdateManyAndReturnArgs>(args: SelectSubset<T, PaymentUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Payment.
     * @param {PaymentUpsertArgs} args - Arguments to update or create a Payment.
     * @example
     * // Update or create a Payment
     * const payment = await prisma.payment.upsert({
     *   create: {
     *     // ... data to create a Payment
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Payment we want to update
     *   }
     * })
     */
    upsert<T extends PaymentUpsertArgs>(args: SelectSubset<T, PaymentUpsertArgs<ExtArgs>>): Prisma__PaymentClient<$Result.GetResult<Prisma.$PaymentPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Payments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentCountArgs} args - Arguments to filter Payments to count.
     * @example
     * // Count the number of Payments
     * const count = await prisma.payment.count({
     *   where: {
     *     // ... the filter for the Payments we want to count
     *   }
     * })
    **/
    count<T extends PaymentCountArgs>(
      args?: Subset<T, PaymentCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PaymentCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Payment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PaymentAggregateArgs>(args: Subset<T, PaymentAggregateArgs>): Prisma.PrismaPromise<GetPaymentAggregateType<T>>

    /**
     * Group by Payment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PaymentGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PaymentGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PaymentGroupByArgs['orderBy'] }
        : { orderBy?: PaymentGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PaymentGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPaymentGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Payment model
   */
  readonly fields: PaymentFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Payment.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PaymentClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    appointment<T extends AppointmentDefaultArgs<ExtArgs> = {}>(args?: Subset<T, AppointmentDefaultArgs<ExtArgs>>): Prisma__AppointmentClient<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Payment model
   */
  interface PaymentFieldRefs {
    readonly id: FieldRef<"Payment", 'String'>
    readonly appointmentId: FieldRef<"Payment", 'String'>
    readonly amount: FieldRef<"Payment", 'Float'>
    readonly status: FieldRef<"Payment", 'PaymentStatus'>
    readonly method: FieldRef<"Payment", 'PaymentMethod'>
    readonly transactionId: FieldRef<"Payment", 'String'>
    readonly createdAt: FieldRef<"Payment", 'DateTime'>
    readonly updatedAt: FieldRef<"Payment", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Payment findUnique
   */
  export type PaymentFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
    /**
     * Filter, which Payment to fetch.
     */
    where: PaymentWhereUniqueInput
  }

  /**
   * Payment findUniqueOrThrow
   */
  export type PaymentFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
    /**
     * Filter, which Payment to fetch.
     */
    where: PaymentWhereUniqueInput
  }

  /**
   * Payment findFirst
   */
  export type PaymentFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
    /**
     * Filter, which Payment to fetch.
     */
    where?: PaymentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Payments to fetch.
     */
    orderBy?: PaymentOrderByWithRelationInput | PaymentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Payments.
     */
    cursor?: PaymentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Payments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Payments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Payments.
     */
    distinct?: PaymentScalarFieldEnum | PaymentScalarFieldEnum[]
  }

  /**
   * Payment findFirstOrThrow
   */
  export type PaymentFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
    /**
     * Filter, which Payment to fetch.
     */
    where?: PaymentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Payments to fetch.
     */
    orderBy?: PaymentOrderByWithRelationInput | PaymentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Payments.
     */
    cursor?: PaymentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Payments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Payments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Payments.
     */
    distinct?: PaymentScalarFieldEnum | PaymentScalarFieldEnum[]
  }

  /**
   * Payment findMany
   */
  export type PaymentFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
    /**
     * Filter, which Payments to fetch.
     */
    where?: PaymentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Payments to fetch.
     */
    orderBy?: PaymentOrderByWithRelationInput | PaymentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Payments.
     */
    cursor?: PaymentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Payments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Payments.
     */
    skip?: number
    distinct?: PaymentScalarFieldEnum | PaymentScalarFieldEnum[]
  }

  /**
   * Payment create
   */
  export type PaymentCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
    /**
     * The data needed to create a Payment.
     */
    data: XOR<PaymentCreateInput, PaymentUncheckedCreateInput>
  }

  /**
   * Payment createMany
   */
  export type PaymentCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Payments.
     */
    data: PaymentCreateManyInput | PaymentCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Payment createManyAndReturn
   */
  export type PaymentCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * The data used to create many Payments.
     */
    data: PaymentCreateManyInput | PaymentCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Payment update
   */
  export type PaymentUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
    /**
     * The data needed to update a Payment.
     */
    data: XOR<PaymentUpdateInput, PaymentUncheckedUpdateInput>
    /**
     * Choose, which Payment to update.
     */
    where: PaymentWhereUniqueInput
  }

  /**
   * Payment updateMany
   */
  export type PaymentUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Payments.
     */
    data: XOR<PaymentUpdateManyMutationInput, PaymentUncheckedUpdateManyInput>
    /**
     * Filter which Payments to update
     */
    where?: PaymentWhereInput
    /**
     * Limit how many Payments to update.
     */
    limit?: number
  }

  /**
   * Payment updateManyAndReturn
   */
  export type PaymentUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * The data used to update Payments.
     */
    data: XOR<PaymentUpdateManyMutationInput, PaymentUncheckedUpdateManyInput>
    /**
     * Filter which Payments to update
     */
    where?: PaymentWhereInput
    /**
     * Limit how many Payments to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * Payment upsert
   */
  export type PaymentUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
    /**
     * The filter to search for the Payment to update in case it exists.
     */
    where: PaymentWhereUniqueInput
    /**
     * In case the Payment found by the `where` argument doesn't exist, create a new Payment with this data.
     */
    create: XOR<PaymentCreateInput, PaymentUncheckedCreateInput>
    /**
     * In case the Payment was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PaymentUpdateInput, PaymentUncheckedUpdateInput>
  }

  /**
   * Payment delete
   */
  export type PaymentDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
    /**
     * Filter which Payment to delete.
     */
    where: PaymentWhereUniqueInput
  }

  /**
   * Payment deleteMany
   */
  export type PaymentDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Payments to delete
     */
    where?: PaymentWhereInput
    /**
     * Limit how many Payments to delete.
     */
    limit?: number
  }

  /**
   * Payment without action
   */
  export type PaymentDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Payment
     */
    select?: PaymentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Payment
     */
    omit?: PaymentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PaymentInclude<ExtArgs> | null
  }


  /**
   * Model QueueItem
   */

  export type AggregateQueueItem = {
    _count: QueueItemCountAggregateOutputType | null
    _avg: QueueItemAvgAggregateOutputType | null
    _sum: QueueItemSumAggregateOutputType | null
    _min: QueueItemMinAggregateOutputType | null
    _max: QueueItemMaxAggregateOutputType | null
  }

  export type QueueItemAvgAggregateOutputType = {
    queueNumber: number | null
    estimatedWaitTime: number | null
  }

  export type QueueItemSumAggregateOutputType = {
    queueNumber: number | null
    estimatedWaitTime: number | null
  }

  export type QueueItemMinAggregateOutputType = {
    id: string | null
    appointmentId: string | null
    queueNumber: number | null
    estimatedWaitTime: number | null
    status: $Enums.QueueStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type QueueItemMaxAggregateOutputType = {
    id: string | null
    appointmentId: string | null
    queueNumber: number | null
    estimatedWaitTime: number | null
    status: $Enums.QueueStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type QueueItemCountAggregateOutputType = {
    id: number
    appointmentId: number
    queueNumber: number
    estimatedWaitTime: number
    status: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type QueueItemAvgAggregateInputType = {
    queueNumber?: true
    estimatedWaitTime?: true
  }

  export type QueueItemSumAggregateInputType = {
    queueNumber?: true
    estimatedWaitTime?: true
  }

  export type QueueItemMinAggregateInputType = {
    id?: true
    appointmentId?: true
    queueNumber?: true
    estimatedWaitTime?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type QueueItemMaxAggregateInputType = {
    id?: true
    appointmentId?: true
    queueNumber?: true
    estimatedWaitTime?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type QueueItemCountAggregateInputType = {
    id?: true
    appointmentId?: true
    queueNumber?: true
    estimatedWaitTime?: true
    status?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type QueueItemAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which QueueItem to aggregate.
     */
    where?: QueueItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of QueueItems to fetch.
     */
    orderBy?: QueueItemOrderByWithRelationInput | QueueItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: QueueItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` QueueItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` QueueItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned QueueItems
    **/
    _count?: true | QueueItemCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: QueueItemAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: QueueItemSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: QueueItemMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: QueueItemMaxAggregateInputType
  }

  export type GetQueueItemAggregateType<T extends QueueItemAggregateArgs> = {
        [P in keyof T & keyof AggregateQueueItem]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateQueueItem[P]>
      : GetScalarType<T[P], AggregateQueueItem[P]>
  }




  export type QueueItemGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: QueueItemWhereInput
    orderBy?: QueueItemOrderByWithAggregationInput | QueueItemOrderByWithAggregationInput[]
    by: QueueItemScalarFieldEnum[] | QueueItemScalarFieldEnum
    having?: QueueItemScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: QueueItemCountAggregateInputType | true
    _avg?: QueueItemAvgAggregateInputType
    _sum?: QueueItemSumAggregateInputType
    _min?: QueueItemMinAggregateInputType
    _max?: QueueItemMaxAggregateInputType
  }

  export type QueueItemGroupByOutputType = {
    id: string
    appointmentId: string
    queueNumber: number
    estimatedWaitTime: number | null
    status: $Enums.QueueStatus
    createdAt: Date
    updatedAt: Date
    _count: QueueItemCountAggregateOutputType | null
    _avg: QueueItemAvgAggregateOutputType | null
    _sum: QueueItemSumAggregateOutputType | null
    _min: QueueItemMinAggregateOutputType | null
    _max: QueueItemMaxAggregateOutputType | null
  }

  type GetQueueItemGroupByPayload<T extends QueueItemGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<QueueItemGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof QueueItemGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], QueueItemGroupByOutputType[P]>
            : GetScalarType<T[P], QueueItemGroupByOutputType[P]>
        }
      >
    >


  export type QueueItemSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    appointmentId?: boolean
    queueNumber?: boolean
    estimatedWaitTime?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["queueItem"]>

  export type QueueItemSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    appointmentId?: boolean
    queueNumber?: boolean
    estimatedWaitTime?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["queueItem"]>

  export type QueueItemSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    appointmentId?: boolean
    queueNumber?: boolean
    estimatedWaitTime?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["queueItem"]>

  export type QueueItemSelectScalar = {
    id?: boolean
    appointmentId?: boolean
    queueNumber?: boolean
    estimatedWaitTime?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type QueueItemOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "appointmentId" | "queueNumber" | "estimatedWaitTime" | "status" | "createdAt" | "updatedAt", ExtArgs["result"]["queueItem"]>
  export type QueueItemInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }
  export type QueueItemIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }
  export type QueueItemIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    appointment?: boolean | AppointmentDefaultArgs<ExtArgs>
  }

  export type $QueueItemPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "QueueItem"
    objects: {
      appointment: Prisma.$AppointmentPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      appointmentId: string
      queueNumber: number
      estimatedWaitTime: number | null
      status: $Enums.QueueStatus
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["queueItem"]>
    composites: {}
  }

  type QueueItemGetPayload<S extends boolean | null | undefined | QueueItemDefaultArgs> = $Result.GetResult<Prisma.$QueueItemPayload, S>

  type QueueItemCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<QueueItemFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: QueueItemCountAggregateInputType | true
    }

  export interface QueueItemDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['QueueItem'], meta: { name: 'QueueItem' } }
    /**
     * Find zero or one QueueItem that matches the filter.
     * @param {QueueItemFindUniqueArgs} args - Arguments to find a QueueItem
     * @example
     * // Get one QueueItem
     * const queueItem = await prisma.queueItem.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends QueueItemFindUniqueArgs>(args: SelectSubset<T, QueueItemFindUniqueArgs<ExtArgs>>): Prisma__QueueItemClient<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one QueueItem that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {QueueItemFindUniqueOrThrowArgs} args - Arguments to find a QueueItem
     * @example
     * // Get one QueueItem
     * const queueItem = await prisma.queueItem.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends QueueItemFindUniqueOrThrowArgs>(args: SelectSubset<T, QueueItemFindUniqueOrThrowArgs<ExtArgs>>): Prisma__QueueItemClient<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first QueueItem that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {QueueItemFindFirstArgs} args - Arguments to find a QueueItem
     * @example
     * // Get one QueueItem
     * const queueItem = await prisma.queueItem.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends QueueItemFindFirstArgs>(args?: SelectSubset<T, QueueItemFindFirstArgs<ExtArgs>>): Prisma__QueueItemClient<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first QueueItem that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {QueueItemFindFirstOrThrowArgs} args - Arguments to find a QueueItem
     * @example
     * // Get one QueueItem
     * const queueItem = await prisma.queueItem.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends QueueItemFindFirstOrThrowArgs>(args?: SelectSubset<T, QueueItemFindFirstOrThrowArgs<ExtArgs>>): Prisma__QueueItemClient<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more QueueItems that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {QueueItemFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all QueueItems
     * const queueItems = await prisma.queueItem.findMany()
     * 
     * // Get first 10 QueueItems
     * const queueItems = await prisma.queueItem.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const queueItemWithIdOnly = await prisma.queueItem.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends QueueItemFindManyArgs>(args?: SelectSubset<T, QueueItemFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a QueueItem.
     * @param {QueueItemCreateArgs} args - Arguments to create a QueueItem.
     * @example
     * // Create one QueueItem
     * const QueueItem = await prisma.queueItem.create({
     *   data: {
     *     // ... data to create a QueueItem
     *   }
     * })
     * 
     */
    create<T extends QueueItemCreateArgs>(args: SelectSubset<T, QueueItemCreateArgs<ExtArgs>>): Prisma__QueueItemClient<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many QueueItems.
     * @param {QueueItemCreateManyArgs} args - Arguments to create many QueueItems.
     * @example
     * // Create many QueueItems
     * const queueItem = await prisma.queueItem.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends QueueItemCreateManyArgs>(args?: SelectSubset<T, QueueItemCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many QueueItems and returns the data saved in the database.
     * @param {QueueItemCreateManyAndReturnArgs} args - Arguments to create many QueueItems.
     * @example
     * // Create many QueueItems
     * const queueItem = await prisma.queueItem.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many QueueItems and only return the `id`
     * const queueItemWithIdOnly = await prisma.queueItem.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends QueueItemCreateManyAndReturnArgs>(args?: SelectSubset<T, QueueItemCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a QueueItem.
     * @param {QueueItemDeleteArgs} args - Arguments to delete one QueueItem.
     * @example
     * // Delete one QueueItem
     * const QueueItem = await prisma.queueItem.delete({
     *   where: {
     *     // ... filter to delete one QueueItem
     *   }
     * })
     * 
     */
    delete<T extends QueueItemDeleteArgs>(args: SelectSubset<T, QueueItemDeleteArgs<ExtArgs>>): Prisma__QueueItemClient<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one QueueItem.
     * @param {QueueItemUpdateArgs} args - Arguments to update one QueueItem.
     * @example
     * // Update one QueueItem
     * const queueItem = await prisma.queueItem.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends QueueItemUpdateArgs>(args: SelectSubset<T, QueueItemUpdateArgs<ExtArgs>>): Prisma__QueueItemClient<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more QueueItems.
     * @param {QueueItemDeleteManyArgs} args - Arguments to filter QueueItems to delete.
     * @example
     * // Delete a few QueueItems
     * const { count } = await prisma.queueItem.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends QueueItemDeleteManyArgs>(args?: SelectSubset<T, QueueItemDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more QueueItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {QueueItemUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many QueueItems
     * const queueItem = await prisma.queueItem.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends QueueItemUpdateManyArgs>(args: SelectSubset<T, QueueItemUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more QueueItems and returns the data updated in the database.
     * @param {QueueItemUpdateManyAndReturnArgs} args - Arguments to update many QueueItems.
     * @example
     * // Update many QueueItems
     * const queueItem = await prisma.queueItem.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more QueueItems and only return the `id`
     * const queueItemWithIdOnly = await prisma.queueItem.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends QueueItemUpdateManyAndReturnArgs>(args: SelectSubset<T, QueueItemUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one QueueItem.
     * @param {QueueItemUpsertArgs} args - Arguments to update or create a QueueItem.
     * @example
     * // Update or create a QueueItem
     * const queueItem = await prisma.queueItem.upsert({
     *   create: {
     *     // ... data to create a QueueItem
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the QueueItem we want to update
     *   }
     * })
     */
    upsert<T extends QueueItemUpsertArgs>(args: SelectSubset<T, QueueItemUpsertArgs<ExtArgs>>): Prisma__QueueItemClient<$Result.GetResult<Prisma.$QueueItemPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of QueueItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {QueueItemCountArgs} args - Arguments to filter QueueItems to count.
     * @example
     * // Count the number of QueueItems
     * const count = await prisma.queueItem.count({
     *   where: {
     *     // ... the filter for the QueueItems we want to count
     *   }
     * })
    **/
    count<T extends QueueItemCountArgs>(
      args?: Subset<T, QueueItemCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], QueueItemCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a QueueItem.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {QueueItemAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends QueueItemAggregateArgs>(args: Subset<T, QueueItemAggregateArgs>): Prisma.PrismaPromise<GetQueueItemAggregateType<T>>

    /**
     * Group by QueueItem.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {QueueItemGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends QueueItemGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: QueueItemGroupByArgs['orderBy'] }
        : { orderBy?: QueueItemGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, QueueItemGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetQueueItemGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the QueueItem model
   */
  readonly fields: QueueItemFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for QueueItem.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__QueueItemClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    appointment<T extends AppointmentDefaultArgs<ExtArgs> = {}>(args?: Subset<T, AppointmentDefaultArgs<ExtArgs>>): Prisma__AppointmentClient<$Result.GetResult<Prisma.$AppointmentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the QueueItem model
   */
  interface QueueItemFieldRefs {
    readonly id: FieldRef<"QueueItem", 'String'>
    readonly appointmentId: FieldRef<"QueueItem", 'String'>
    readonly queueNumber: FieldRef<"QueueItem", 'Int'>
    readonly estimatedWaitTime: FieldRef<"QueueItem", 'Int'>
    readonly status: FieldRef<"QueueItem", 'QueueStatus'>
    readonly createdAt: FieldRef<"QueueItem", 'DateTime'>
    readonly updatedAt: FieldRef<"QueueItem", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * QueueItem findUnique
   */
  export type QueueItemFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
    /**
     * Filter, which QueueItem to fetch.
     */
    where: QueueItemWhereUniqueInput
  }

  /**
   * QueueItem findUniqueOrThrow
   */
  export type QueueItemFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
    /**
     * Filter, which QueueItem to fetch.
     */
    where: QueueItemWhereUniqueInput
  }

  /**
   * QueueItem findFirst
   */
  export type QueueItemFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
    /**
     * Filter, which QueueItem to fetch.
     */
    where?: QueueItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of QueueItems to fetch.
     */
    orderBy?: QueueItemOrderByWithRelationInput | QueueItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for QueueItems.
     */
    cursor?: QueueItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` QueueItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` QueueItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of QueueItems.
     */
    distinct?: QueueItemScalarFieldEnum | QueueItemScalarFieldEnum[]
  }

  /**
   * QueueItem findFirstOrThrow
   */
  export type QueueItemFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
    /**
     * Filter, which QueueItem to fetch.
     */
    where?: QueueItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of QueueItems to fetch.
     */
    orderBy?: QueueItemOrderByWithRelationInput | QueueItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for QueueItems.
     */
    cursor?: QueueItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` QueueItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` QueueItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of QueueItems.
     */
    distinct?: QueueItemScalarFieldEnum | QueueItemScalarFieldEnum[]
  }

  /**
   * QueueItem findMany
   */
  export type QueueItemFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
    /**
     * Filter, which QueueItems to fetch.
     */
    where?: QueueItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of QueueItems to fetch.
     */
    orderBy?: QueueItemOrderByWithRelationInput | QueueItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing QueueItems.
     */
    cursor?: QueueItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` QueueItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` QueueItems.
     */
    skip?: number
    distinct?: QueueItemScalarFieldEnum | QueueItemScalarFieldEnum[]
  }

  /**
   * QueueItem create
   */
  export type QueueItemCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
    /**
     * The data needed to create a QueueItem.
     */
    data: XOR<QueueItemCreateInput, QueueItemUncheckedCreateInput>
  }

  /**
   * QueueItem createMany
   */
  export type QueueItemCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many QueueItems.
     */
    data: QueueItemCreateManyInput | QueueItemCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * QueueItem createManyAndReturn
   */
  export type QueueItemCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * The data used to create many QueueItems.
     */
    data: QueueItemCreateManyInput | QueueItemCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * QueueItem update
   */
  export type QueueItemUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
    /**
     * The data needed to update a QueueItem.
     */
    data: XOR<QueueItemUpdateInput, QueueItemUncheckedUpdateInput>
    /**
     * Choose, which QueueItem to update.
     */
    where: QueueItemWhereUniqueInput
  }

  /**
   * QueueItem updateMany
   */
  export type QueueItemUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update QueueItems.
     */
    data: XOR<QueueItemUpdateManyMutationInput, QueueItemUncheckedUpdateManyInput>
    /**
     * Filter which QueueItems to update
     */
    where?: QueueItemWhereInput
    /**
     * Limit how many QueueItems to update.
     */
    limit?: number
  }

  /**
   * QueueItem updateManyAndReturn
   */
  export type QueueItemUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * The data used to update QueueItems.
     */
    data: XOR<QueueItemUpdateManyMutationInput, QueueItemUncheckedUpdateManyInput>
    /**
     * Filter which QueueItems to update
     */
    where?: QueueItemWhereInput
    /**
     * Limit how many QueueItems to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * QueueItem upsert
   */
  export type QueueItemUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
    /**
     * The filter to search for the QueueItem to update in case it exists.
     */
    where: QueueItemWhereUniqueInput
    /**
     * In case the QueueItem found by the `where` argument doesn't exist, create a new QueueItem with this data.
     */
    create: XOR<QueueItemCreateInput, QueueItemUncheckedCreateInput>
    /**
     * In case the QueueItem was found with the provided `where` argument, update it with this data.
     */
    update: XOR<QueueItemUpdateInput, QueueItemUncheckedUpdateInput>
  }

  /**
   * QueueItem delete
   */
  export type QueueItemDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
    /**
     * Filter which QueueItem to delete.
     */
    where: QueueItemWhereUniqueInput
  }

  /**
   * QueueItem deleteMany
   */
  export type QueueItemDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which QueueItems to delete
     */
    where?: QueueItemWhereInput
    /**
     * Limit how many QueueItems to delete.
     */
    limit?: number
  }

  /**
   * QueueItem without action
   */
  export type QueueItemDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the QueueItem
     */
    select?: QueueItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the QueueItem
     */
    omit?: QueueItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: QueueItemInclude<ExtArgs> | null
  }


  /**
   * Model Prescription
   */

  export type AggregatePrescription = {
    _count: PrescriptionCountAggregateOutputType | null
    _min: PrescriptionMinAggregateOutputType | null
    _max: PrescriptionMaxAggregateOutputType | null
  }

  export type PrescriptionMinAggregateOutputType = {
    id: string | null
    patientId: string | null
    doctorId: string | null
    date: Date | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PrescriptionMaxAggregateOutputType = {
    id: string | null
    patientId: string | null
    doctorId: string | null
    date: Date | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PrescriptionCountAggregateOutputType = {
    id: number
    patientId: number
    doctorId: number
    date: number
    notes: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type PrescriptionMinAggregateInputType = {
    id?: true
    patientId?: true
    doctorId?: true
    date?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PrescriptionMaxAggregateInputType = {
    id?: true
    patientId?: true
    doctorId?: true
    date?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PrescriptionCountAggregateInputType = {
    id?: true
    patientId?: true
    doctorId?: true
    date?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type PrescriptionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Prescription to aggregate.
     */
    where?: PrescriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Prescriptions to fetch.
     */
    orderBy?: PrescriptionOrderByWithRelationInput | PrescriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PrescriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Prescriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Prescriptions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Prescriptions
    **/
    _count?: true | PrescriptionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PrescriptionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PrescriptionMaxAggregateInputType
  }

  export type GetPrescriptionAggregateType<T extends PrescriptionAggregateArgs> = {
        [P in keyof T & keyof AggregatePrescription]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePrescription[P]>
      : GetScalarType<T[P], AggregatePrescription[P]>
  }




  export type PrescriptionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PrescriptionWhereInput
    orderBy?: PrescriptionOrderByWithAggregationInput | PrescriptionOrderByWithAggregationInput[]
    by: PrescriptionScalarFieldEnum[] | PrescriptionScalarFieldEnum
    having?: PrescriptionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PrescriptionCountAggregateInputType | true
    _min?: PrescriptionMinAggregateInputType
    _max?: PrescriptionMaxAggregateInputType
  }

  export type PrescriptionGroupByOutputType = {
    id: string
    patientId: string
    doctorId: string
    date: Date
    notes: string | null
    createdAt: Date
    updatedAt: Date
    _count: PrescriptionCountAggregateOutputType | null
    _min: PrescriptionMinAggregateOutputType | null
    _max: PrescriptionMaxAggregateOutputType | null
  }

  type GetPrescriptionGroupByPayload<T extends PrescriptionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PrescriptionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PrescriptionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PrescriptionGroupByOutputType[P]>
            : GetScalarType<T[P], PrescriptionGroupByOutputType[P]>
        }
      >
    >


  export type PrescriptionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    patientId?: boolean
    doctorId?: boolean
    date?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
    items?: boolean | Prescription$itemsArgs<ExtArgs>
    _count?: boolean | PrescriptionCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["prescription"]>

  export type PrescriptionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    patientId?: boolean
    doctorId?: boolean
    date?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["prescription"]>

  export type PrescriptionSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    patientId?: boolean
    doctorId?: boolean
    date?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["prescription"]>

  export type PrescriptionSelectScalar = {
    id?: boolean
    patientId?: boolean
    doctorId?: boolean
    date?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type PrescriptionOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "patientId" | "doctorId" | "date" | "notes" | "createdAt" | "updatedAt", ExtArgs["result"]["prescription"]>
  export type PrescriptionInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
    items?: boolean | Prescription$itemsArgs<ExtArgs>
    _count?: boolean | PrescriptionCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type PrescriptionIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }
  export type PrescriptionIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }

  export type $PrescriptionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Prescription"
    objects: {
      doctor: Prisma.$DoctorPayload<ExtArgs>
      patient: Prisma.$PatientPayload<ExtArgs>
      items: Prisma.$PrescriptionItemPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      patientId: string
      doctorId: string
      date: Date
      notes: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["prescription"]>
    composites: {}
  }

  type PrescriptionGetPayload<S extends boolean | null | undefined | PrescriptionDefaultArgs> = $Result.GetResult<Prisma.$PrescriptionPayload, S>

  type PrescriptionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<PrescriptionFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PrescriptionCountAggregateInputType | true
    }

  export interface PrescriptionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Prescription'], meta: { name: 'Prescription' } }
    /**
     * Find zero or one Prescription that matches the filter.
     * @param {PrescriptionFindUniqueArgs} args - Arguments to find a Prescription
     * @example
     * // Get one Prescription
     * const prescription = await prisma.prescription.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PrescriptionFindUniqueArgs>(args: SelectSubset<T, PrescriptionFindUniqueArgs<ExtArgs>>): Prisma__PrescriptionClient<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Prescription that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {PrescriptionFindUniqueOrThrowArgs} args - Arguments to find a Prescription
     * @example
     * // Get one Prescription
     * const prescription = await prisma.prescription.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PrescriptionFindUniqueOrThrowArgs>(args: SelectSubset<T, PrescriptionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PrescriptionClient<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Prescription that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionFindFirstArgs} args - Arguments to find a Prescription
     * @example
     * // Get one Prescription
     * const prescription = await prisma.prescription.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PrescriptionFindFirstArgs>(args?: SelectSubset<T, PrescriptionFindFirstArgs<ExtArgs>>): Prisma__PrescriptionClient<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Prescription that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionFindFirstOrThrowArgs} args - Arguments to find a Prescription
     * @example
     * // Get one Prescription
     * const prescription = await prisma.prescription.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PrescriptionFindFirstOrThrowArgs>(args?: SelectSubset<T, PrescriptionFindFirstOrThrowArgs<ExtArgs>>): Prisma__PrescriptionClient<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Prescriptions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Prescriptions
     * const prescriptions = await prisma.prescription.findMany()
     * 
     * // Get first 10 Prescriptions
     * const prescriptions = await prisma.prescription.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const prescriptionWithIdOnly = await prisma.prescription.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PrescriptionFindManyArgs>(args?: SelectSubset<T, PrescriptionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Prescription.
     * @param {PrescriptionCreateArgs} args - Arguments to create a Prescription.
     * @example
     * // Create one Prescription
     * const Prescription = await prisma.prescription.create({
     *   data: {
     *     // ... data to create a Prescription
     *   }
     * })
     * 
     */
    create<T extends PrescriptionCreateArgs>(args: SelectSubset<T, PrescriptionCreateArgs<ExtArgs>>): Prisma__PrescriptionClient<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Prescriptions.
     * @param {PrescriptionCreateManyArgs} args - Arguments to create many Prescriptions.
     * @example
     * // Create many Prescriptions
     * const prescription = await prisma.prescription.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PrescriptionCreateManyArgs>(args?: SelectSubset<T, PrescriptionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Prescriptions and returns the data saved in the database.
     * @param {PrescriptionCreateManyAndReturnArgs} args - Arguments to create many Prescriptions.
     * @example
     * // Create many Prescriptions
     * const prescription = await prisma.prescription.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Prescriptions and only return the `id`
     * const prescriptionWithIdOnly = await prisma.prescription.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PrescriptionCreateManyAndReturnArgs>(args?: SelectSubset<T, PrescriptionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Prescription.
     * @param {PrescriptionDeleteArgs} args - Arguments to delete one Prescription.
     * @example
     * // Delete one Prescription
     * const Prescription = await prisma.prescription.delete({
     *   where: {
     *     // ... filter to delete one Prescription
     *   }
     * })
     * 
     */
    delete<T extends PrescriptionDeleteArgs>(args: SelectSubset<T, PrescriptionDeleteArgs<ExtArgs>>): Prisma__PrescriptionClient<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Prescription.
     * @param {PrescriptionUpdateArgs} args - Arguments to update one Prescription.
     * @example
     * // Update one Prescription
     * const prescription = await prisma.prescription.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PrescriptionUpdateArgs>(args: SelectSubset<T, PrescriptionUpdateArgs<ExtArgs>>): Prisma__PrescriptionClient<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Prescriptions.
     * @param {PrescriptionDeleteManyArgs} args - Arguments to filter Prescriptions to delete.
     * @example
     * // Delete a few Prescriptions
     * const { count } = await prisma.prescription.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PrescriptionDeleteManyArgs>(args?: SelectSubset<T, PrescriptionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Prescriptions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Prescriptions
     * const prescription = await prisma.prescription.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PrescriptionUpdateManyArgs>(args: SelectSubset<T, PrescriptionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Prescriptions and returns the data updated in the database.
     * @param {PrescriptionUpdateManyAndReturnArgs} args - Arguments to update many Prescriptions.
     * @example
     * // Update many Prescriptions
     * const prescription = await prisma.prescription.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Prescriptions and only return the `id`
     * const prescriptionWithIdOnly = await prisma.prescription.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends PrescriptionUpdateManyAndReturnArgs>(args: SelectSubset<T, PrescriptionUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Prescription.
     * @param {PrescriptionUpsertArgs} args - Arguments to update or create a Prescription.
     * @example
     * // Update or create a Prescription
     * const prescription = await prisma.prescription.upsert({
     *   create: {
     *     // ... data to create a Prescription
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Prescription we want to update
     *   }
     * })
     */
    upsert<T extends PrescriptionUpsertArgs>(args: SelectSubset<T, PrescriptionUpsertArgs<ExtArgs>>): Prisma__PrescriptionClient<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Prescriptions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionCountArgs} args - Arguments to filter Prescriptions to count.
     * @example
     * // Count the number of Prescriptions
     * const count = await prisma.prescription.count({
     *   where: {
     *     // ... the filter for the Prescriptions we want to count
     *   }
     * })
    **/
    count<T extends PrescriptionCountArgs>(
      args?: Subset<T, PrescriptionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PrescriptionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Prescription.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PrescriptionAggregateArgs>(args: Subset<T, PrescriptionAggregateArgs>): Prisma.PrismaPromise<GetPrescriptionAggregateType<T>>

    /**
     * Group by Prescription.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PrescriptionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PrescriptionGroupByArgs['orderBy'] }
        : { orderBy?: PrescriptionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PrescriptionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPrescriptionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Prescription model
   */
  readonly fields: PrescriptionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Prescription.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PrescriptionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    doctor<T extends DoctorDefaultArgs<ExtArgs> = {}>(args?: Subset<T, DoctorDefaultArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    patient<T extends PatientDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PatientDefaultArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    items<T extends Prescription$itemsArgs<ExtArgs> = {}>(args?: Subset<T, Prescription$itemsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Prescription model
   */
  interface PrescriptionFieldRefs {
    readonly id: FieldRef<"Prescription", 'String'>
    readonly patientId: FieldRef<"Prescription", 'String'>
    readonly doctorId: FieldRef<"Prescription", 'String'>
    readonly date: FieldRef<"Prescription", 'DateTime'>
    readonly notes: FieldRef<"Prescription", 'String'>
    readonly createdAt: FieldRef<"Prescription", 'DateTime'>
    readonly updatedAt: FieldRef<"Prescription", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Prescription findUnique
   */
  export type PrescriptionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    /**
     * Filter, which Prescription to fetch.
     */
    where: PrescriptionWhereUniqueInput
  }

  /**
   * Prescription findUniqueOrThrow
   */
  export type PrescriptionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    /**
     * Filter, which Prescription to fetch.
     */
    where: PrescriptionWhereUniqueInput
  }

  /**
   * Prescription findFirst
   */
  export type PrescriptionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    /**
     * Filter, which Prescription to fetch.
     */
    where?: PrescriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Prescriptions to fetch.
     */
    orderBy?: PrescriptionOrderByWithRelationInput | PrescriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Prescriptions.
     */
    cursor?: PrescriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Prescriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Prescriptions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Prescriptions.
     */
    distinct?: PrescriptionScalarFieldEnum | PrescriptionScalarFieldEnum[]
  }

  /**
   * Prescription findFirstOrThrow
   */
  export type PrescriptionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    /**
     * Filter, which Prescription to fetch.
     */
    where?: PrescriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Prescriptions to fetch.
     */
    orderBy?: PrescriptionOrderByWithRelationInput | PrescriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Prescriptions.
     */
    cursor?: PrescriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Prescriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Prescriptions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Prescriptions.
     */
    distinct?: PrescriptionScalarFieldEnum | PrescriptionScalarFieldEnum[]
  }

  /**
   * Prescription findMany
   */
  export type PrescriptionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    /**
     * Filter, which Prescriptions to fetch.
     */
    where?: PrescriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Prescriptions to fetch.
     */
    orderBy?: PrescriptionOrderByWithRelationInput | PrescriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Prescriptions.
     */
    cursor?: PrescriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Prescriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Prescriptions.
     */
    skip?: number
    distinct?: PrescriptionScalarFieldEnum | PrescriptionScalarFieldEnum[]
  }

  /**
   * Prescription create
   */
  export type PrescriptionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    /**
     * The data needed to create a Prescription.
     */
    data: XOR<PrescriptionCreateInput, PrescriptionUncheckedCreateInput>
  }

  /**
   * Prescription createMany
   */
  export type PrescriptionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Prescriptions.
     */
    data: PrescriptionCreateManyInput | PrescriptionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Prescription createManyAndReturn
   */
  export type PrescriptionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * The data used to create many Prescriptions.
     */
    data: PrescriptionCreateManyInput | PrescriptionCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Prescription update
   */
  export type PrescriptionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    /**
     * The data needed to update a Prescription.
     */
    data: XOR<PrescriptionUpdateInput, PrescriptionUncheckedUpdateInput>
    /**
     * Choose, which Prescription to update.
     */
    where: PrescriptionWhereUniqueInput
  }

  /**
   * Prescription updateMany
   */
  export type PrescriptionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Prescriptions.
     */
    data: XOR<PrescriptionUpdateManyMutationInput, PrescriptionUncheckedUpdateManyInput>
    /**
     * Filter which Prescriptions to update
     */
    where?: PrescriptionWhereInput
    /**
     * Limit how many Prescriptions to update.
     */
    limit?: number
  }

  /**
   * Prescription updateManyAndReturn
   */
  export type PrescriptionUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * The data used to update Prescriptions.
     */
    data: XOR<PrescriptionUpdateManyMutationInput, PrescriptionUncheckedUpdateManyInput>
    /**
     * Filter which Prescriptions to update
     */
    where?: PrescriptionWhereInput
    /**
     * Limit how many Prescriptions to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * Prescription upsert
   */
  export type PrescriptionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    /**
     * The filter to search for the Prescription to update in case it exists.
     */
    where: PrescriptionWhereUniqueInput
    /**
     * In case the Prescription found by the `where` argument doesn't exist, create a new Prescription with this data.
     */
    create: XOR<PrescriptionCreateInput, PrescriptionUncheckedCreateInput>
    /**
     * In case the Prescription was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PrescriptionUpdateInput, PrescriptionUncheckedUpdateInput>
  }

  /**
   * Prescription delete
   */
  export type PrescriptionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
    /**
     * Filter which Prescription to delete.
     */
    where: PrescriptionWhereUniqueInput
  }

  /**
   * Prescription deleteMany
   */
  export type PrescriptionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Prescriptions to delete
     */
    where?: PrescriptionWhereInput
    /**
     * Limit how many Prescriptions to delete.
     */
    limit?: number
  }

  /**
   * Prescription.items
   */
  export type Prescription$itemsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    where?: PrescriptionItemWhereInput
    orderBy?: PrescriptionItemOrderByWithRelationInput | PrescriptionItemOrderByWithRelationInput[]
    cursor?: PrescriptionItemWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PrescriptionItemScalarFieldEnum | PrescriptionItemScalarFieldEnum[]
  }

  /**
   * Prescription without action
   */
  export type PrescriptionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Prescription
     */
    select?: PrescriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Prescription
     */
    omit?: PrescriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionInclude<ExtArgs> | null
  }


  /**
   * Model PrescriptionItem
   */

  export type AggregatePrescriptionItem = {
    _count: PrescriptionItemCountAggregateOutputType | null
    _min: PrescriptionItemMinAggregateOutputType | null
    _max: PrescriptionItemMaxAggregateOutputType | null
  }

  export type PrescriptionItemMinAggregateOutputType = {
    id: string | null
    prescriptionId: string | null
    medicineId: string | null
    dosage: string | null
    frequency: string | null
    duration: string | null
    instructions: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PrescriptionItemMaxAggregateOutputType = {
    id: string | null
    prescriptionId: string | null
    medicineId: string | null
    dosage: string | null
    frequency: string | null
    duration: string | null
    instructions: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PrescriptionItemCountAggregateOutputType = {
    id: number
    prescriptionId: number
    medicineId: number
    dosage: number
    frequency: number
    duration: number
    instructions: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type PrescriptionItemMinAggregateInputType = {
    id?: true
    prescriptionId?: true
    medicineId?: true
    dosage?: true
    frequency?: true
    duration?: true
    instructions?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PrescriptionItemMaxAggregateInputType = {
    id?: true
    prescriptionId?: true
    medicineId?: true
    dosage?: true
    frequency?: true
    duration?: true
    instructions?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PrescriptionItemCountAggregateInputType = {
    id?: true
    prescriptionId?: true
    medicineId?: true
    dosage?: true
    frequency?: true
    duration?: true
    instructions?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type PrescriptionItemAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PrescriptionItem to aggregate.
     */
    where?: PrescriptionItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PrescriptionItems to fetch.
     */
    orderBy?: PrescriptionItemOrderByWithRelationInput | PrescriptionItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PrescriptionItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PrescriptionItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PrescriptionItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PrescriptionItems
    **/
    _count?: true | PrescriptionItemCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PrescriptionItemMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PrescriptionItemMaxAggregateInputType
  }

  export type GetPrescriptionItemAggregateType<T extends PrescriptionItemAggregateArgs> = {
        [P in keyof T & keyof AggregatePrescriptionItem]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePrescriptionItem[P]>
      : GetScalarType<T[P], AggregatePrescriptionItem[P]>
  }




  export type PrescriptionItemGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PrescriptionItemWhereInput
    orderBy?: PrescriptionItemOrderByWithAggregationInput | PrescriptionItemOrderByWithAggregationInput[]
    by: PrescriptionItemScalarFieldEnum[] | PrescriptionItemScalarFieldEnum
    having?: PrescriptionItemScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PrescriptionItemCountAggregateInputType | true
    _min?: PrescriptionItemMinAggregateInputType
    _max?: PrescriptionItemMaxAggregateInputType
  }

  export type PrescriptionItemGroupByOutputType = {
    id: string
    prescriptionId: string
    medicineId: string
    dosage: string | null
    frequency: string | null
    duration: string | null
    instructions: string | null
    createdAt: Date
    updatedAt: Date
    _count: PrescriptionItemCountAggregateOutputType | null
    _min: PrescriptionItemMinAggregateOutputType | null
    _max: PrescriptionItemMaxAggregateOutputType | null
  }

  type GetPrescriptionItemGroupByPayload<T extends PrescriptionItemGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PrescriptionItemGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PrescriptionItemGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PrescriptionItemGroupByOutputType[P]>
            : GetScalarType<T[P], PrescriptionItemGroupByOutputType[P]>
        }
      >
    >


  export type PrescriptionItemSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    prescriptionId?: boolean
    medicineId?: boolean
    dosage?: boolean
    frequency?: boolean
    duration?: boolean
    instructions?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    medicine?: boolean | MedicineDefaultArgs<ExtArgs>
    prescription?: boolean | PrescriptionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["prescriptionItem"]>

  export type PrescriptionItemSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    prescriptionId?: boolean
    medicineId?: boolean
    dosage?: boolean
    frequency?: boolean
    duration?: boolean
    instructions?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    medicine?: boolean | MedicineDefaultArgs<ExtArgs>
    prescription?: boolean | PrescriptionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["prescriptionItem"]>

  export type PrescriptionItemSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    prescriptionId?: boolean
    medicineId?: boolean
    dosage?: boolean
    frequency?: boolean
    duration?: boolean
    instructions?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    medicine?: boolean | MedicineDefaultArgs<ExtArgs>
    prescription?: boolean | PrescriptionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["prescriptionItem"]>

  export type PrescriptionItemSelectScalar = {
    id?: boolean
    prescriptionId?: boolean
    medicineId?: boolean
    dosage?: boolean
    frequency?: boolean
    duration?: boolean
    instructions?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type PrescriptionItemOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "prescriptionId" | "medicineId" | "dosage" | "frequency" | "duration" | "instructions" | "createdAt" | "updatedAt", ExtArgs["result"]["prescriptionItem"]>
  export type PrescriptionItemInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    medicine?: boolean | MedicineDefaultArgs<ExtArgs>
    prescription?: boolean | PrescriptionDefaultArgs<ExtArgs>
  }
  export type PrescriptionItemIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    medicine?: boolean | MedicineDefaultArgs<ExtArgs>
    prescription?: boolean | PrescriptionDefaultArgs<ExtArgs>
  }
  export type PrescriptionItemIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    medicine?: boolean | MedicineDefaultArgs<ExtArgs>
    prescription?: boolean | PrescriptionDefaultArgs<ExtArgs>
  }

  export type $PrescriptionItemPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PrescriptionItem"
    objects: {
      medicine: Prisma.$MedicinePayload<ExtArgs>
      prescription: Prisma.$PrescriptionPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      prescriptionId: string
      medicineId: string
      dosage: string | null
      frequency: string | null
      duration: string | null
      instructions: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["prescriptionItem"]>
    composites: {}
  }

  type PrescriptionItemGetPayload<S extends boolean | null | undefined | PrescriptionItemDefaultArgs> = $Result.GetResult<Prisma.$PrescriptionItemPayload, S>

  type PrescriptionItemCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<PrescriptionItemFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PrescriptionItemCountAggregateInputType | true
    }

  export interface PrescriptionItemDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PrescriptionItem'], meta: { name: 'PrescriptionItem' } }
    /**
     * Find zero or one PrescriptionItem that matches the filter.
     * @param {PrescriptionItemFindUniqueArgs} args - Arguments to find a PrescriptionItem
     * @example
     * // Get one PrescriptionItem
     * const prescriptionItem = await prisma.prescriptionItem.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PrescriptionItemFindUniqueArgs>(args: SelectSubset<T, PrescriptionItemFindUniqueArgs<ExtArgs>>): Prisma__PrescriptionItemClient<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one PrescriptionItem that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {PrescriptionItemFindUniqueOrThrowArgs} args - Arguments to find a PrescriptionItem
     * @example
     * // Get one PrescriptionItem
     * const prescriptionItem = await prisma.prescriptionItem.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PrescriptionItemFindUniqueOrThrowArgs>(args: SelectSubset<T, PrescriptionItemFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PrescriptionItemClient<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first PrescriptionItem that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionItemFindFirstArgs} args - Arguments to find a PrescriptionItem
     * @example
     * // Get one PrescriptionItem
     * const prescriptionItem = await prisma.prescriptionItem.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PrescriptionItemFindFirstArgs>(args?: SelectSubset<T, PrescriptionItemFindFirstArgs<ExtArgs>>): Prisma__PrescriptionItemClient<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first PrescriptionItem that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionItemFindFirstOrThrowArgs} args - Arguments to find a PrescriptionItem
     * @example
     * // Get one PrescriptionItem
     * const prescriptionItem = await prisma.prescriptionItem.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PrescriptionItemFindFirstOrThrowArgs>(args?: SelectSubset<T, PrescriptionItemFindFirstOrThrowArgs<ExtArgs>>): Prisma__PrescriptionItemClient<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more PrescriptionItems that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionItemFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PrescriptionItems
     * const prescriptionItems = await prisma.prescriptionItem.findMany()
     * 
     * // Get first 10 PrescriptionItems
     * const prescriptionItems = await prisma.prescriptionItem.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const prescriptionItemWithIdOnly = await prisma.prescriptionItem.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PrescriptionItemFindManyArgs>(args?: SelectSubset<T, PrescriptionItemFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a PrescriptionItem.
     * @param {PrescriptionItemCreateArgs} args - Arguments to create a PrescriptionItem.
     * @example
     * // Create one PrescriptionItem
     * const PrescriptionItem = await prisma.prescriptionItem.create({
     *   data: {
     *     // ... data to create a PrescriptionItem
     *   }
     * })
     * 
     */
    create<T extends PrescriptionItemCreateArgs>(args: SelectSubset<T, PrescriptionItemCreateArgs<ExtArgs>>): Prisma__PrescriptionItemClient<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many PrescriptionItems.
     * @param {PrescriptionItemCreateManyArgs} args - Arguments to create many PrescriptionItems.
     * @example
     * // Create many PrescriptionItems
     * const prescriptionItem = await prisma.prescriptionItem.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PrescriptionItemCreateManyArgs>(args?: SelectSubset<T, PrescriptionItemCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PrescriptionItems and returns the data saved in the database.
     * @param {PrescriptionItemCreateManyAndReturnArgs} args - Arguments to create many PrescriptionItems.
     * @example
     * // Create many PrescriptionItems
     * const prescriptionItem = await prisma.prescriptionItem.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PrescriptionItems and only return the `id`
     * const prescriptionItemWithIdOnly = await prisma.prescriptionItem.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PrescriptionItemCreateManyAndReturnArgs>(args?: SelectSubset<T, PrescriptionItemCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a PrescriptionItem.
     * @param {PrescriptionItemDeleteArgs} args - Arguments to delete one PrescriptionItem.
     * @example
     * // Delete one PrescriptionItem
     * const PrescriptionItem = await prisma.prescriptionItem.delete({
     *   where: {
     *     // ... filter to delete one PrescriptionItem
     *   }
     * })
     * 
     */
    delete<T extends PrescriptionItemDeleteArgs>(args: SelectSubset<T, PrescriptionItemDeleteArgs<ExtArgs>>): Prisma__PrescriptionItemClient<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one PrescriptionItem.
     * @param {PrescriptionItemUpdateArgs} args - Arguments to update one PrescriptionItem.
     * @example
     * // Update one PrescriptionItem
     * const prescriptionItem = await prisma.prescriptionItem.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PrescriptionItemUpdateArgs>(args: SelectSubset<T, PrescriptionItemUpdateArgs<ExtArgs>>): Prisma__PrescriptionItemClient<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more PrescriptionItems.
     * @param {PrescriptionItemDeleteManyArgs} args - Arguments to filter PrescriptionItems to delete.
     * @example
     * // Delete a few PrescriptionItems
     * const { count } = await prisma.prescriptionItem.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PrescriptionItemDeleteManyArgs>(args?: SelectSubset<T, PrescriptionItemDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PrescriptionItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionItemUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PrescriptionItems
     * const prescriptionItem = await prisma.prescriptionItem.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PrescriptionItemUpdateManyArgs>(args: SelectSubset<T, PrescriptionItemUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PrescriptionItems and returns the data updated in the database.
     * @param {PrescriptionItemUpdateManyAndReturnArgs} args - Arguments to update many PrescriptionItems.
     * @example
     * // Update many PrescriptionItems
     * const prescriptionItem = await prisma.prescriptionItem.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more PrescriptionItems and only return the `id`
     * const prescriptionItemWithIdOnly = await prisma.prescriptionItem.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends PrescriptionItemUpdateManyAndReturnArgs>(args: SelectSubset<T, PrescriptionItemUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one PrescriptionItem.
     * @param {PrescriptionItemUpsertArgs} args - Arguments to update or create a PrescriptionItem.
     * @example
     * // Update or create a PrescriptionItem
     * const prescriptionItem = await prisma.prescriptionItem.upsert({
     *   create: {
     *     // ... data to create a PrescriptionItem
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PrescriptionItem we want to update
     *   }
     * })
     */
    upsert<T extends PrescriptionItemUpsertArgs>(args: SelectSubset<T, PrescriptionItemUpsertArgs<ExtArgs>>): Prisma__PrescriptionItemClient<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of PrescriptionItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionItemCountArgs} args - Arguments to filter PrescriptionItems to count.
     * @example
     * // Count the number of PrescriptionItems
     * const count = await prisma.prescriptionItem.count({
     *   where: {
     *     // ... the filter for the PrescriptionItems we want to count
     *   }
     * })
    **/
    count<T extends PrescriptionItemCountArgs>(
      args?: Subset<T, PrescriptionItemCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PrescriptionItemCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PrescriptionItem.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionItemAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PrescriptionItemAggregateArgs>(args: Subset<T, PrescriptionItemAggregateArgs>): Prisma.PrismaPromise<GetPrescriptionItemAggregateType<T>>

    /**
     * Group by PrescriptionItem.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrescriptionItemGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PrescriptionItemGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PrescriptionItemGroupByArgs['orderBy'] }
        : { orderBy?: PrescriptionItemGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PrescriptionItemGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPrescriptionItemGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PrescriptionItem model
   */
  readonly fields: PrescriptionItemFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PrescriptionItem.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PrescriptionItemClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    medicine<T extends MedicineDefaultArgs<ExtArgs> = {}>(args?: Subset<T, MedicineDefaultArgs<ExtArgs>>): Prisma__MedicineClient<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    prescription<T extends PrescriptionDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PrescriptionDefaultArgs<ExtArgs>>): Prisma__PrescriptionClient<$Result.GetResult<Prisma.$PrescriptionPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the PrescriptionItem model
   */
  interface PrescriptionItemFieldRefs {
    readonly id: FieldRef<"PrescriptionItem", 'String'>
    readonly prescriptionId: FieldRef<"PrescriptionItem", 'String'>
    readonly medicineId: FieldRef<"PrescriptionItem", 'String'>
    readonly dosage: FieldRef<"PrescriptionItem", 'String'>
    readonly frequency: FieldRef<"PrescriptionItem", 'String'>
    readonly duration: FieldRef<"PrescriptionItem", 'String'>
    readonly instructions: FieldRef<"PrescriptionItem", 'String'>
    readonly createdAt: FieldRef<"PrescriptionItem", 'DateTime'>
    readonly updatedAt: FieldRef<"PrescriptionItem", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PrescriptionItem findUnique
   */
  export type PrescriptionItemFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    /**
     * Filter, which PrescriptionItem to fetch.
     */
    where: PrescriptionItemWhereUniqueInput
  }

  /**
   * PrescriptionItem findUniqueOrThrow
   */
  export type PrescriptionItemFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    /**
     * Filter, which PrescriptionItem to fetch.
     */
    where: PrescriptionItemWhereUniqueInput
  }

  /**
   * PrescriptionItem findFirst
   */
  export type PrescriptionItemFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    /**
     * Filter, which PrescriptionItem to fetch.
     */
    where?: PrescriptionItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PrescriptionItems to fetch.
     */
    orderBy?: PrescriptionItemOrderByWithRelationInput | PrescriptionItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PrescriptionItems.
     */
    cursor?: PrescriptionItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PrescriptionItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PrescriptionItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PrescriptionItems.
     */
    distinct?: PrescriptionItemScalarFieldEnum | PrescriptionItemScalarFieldEnum[]
  }

  /**
   * PrescriptionItem findFirstOrThrow
   */
  export type PrescriptionItemFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    /**
     * Filter, which PrescriptionItem to fetch.
     */
    where?: PrescriptionItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PrescriptionItems to fetch.
     */
    orderBy?: PrescriptionItemOrderByWithRelationInput | PrescriptionItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PrescriptionItems.
     */
    cursor?: PrescriptionItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PrescriptionItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PrescriptionItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PrescriptionItems.
     */
    distinct?: PrescriptionItemScalarFieldEnum | PrescriptionItemScalarFieldEnum[]
  }

  /**
   * PrescriptionItem findMany
   */
  export type PrescriptionItemFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    /**
     * Filter, which PrescriptionItems to fetch.
     */
    where?: PrescriptionItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PrescriptionItems to fetch.
     */
    orderBy?: PrescriptionItemOrderByWithRelationInput | PrescriptionItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PrescriptionItems.
     */
    cursor?: PrescriptionItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PrescriptionItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PrescriptionItems.
     */
    skip?: number
    distinct?: PrescriptionItemScalarFieldEnum | PrescriptionItemScalarFieldEnum[]
  }

  /**
   * PrescriptionItem create
   */
  export type PrescriptionItemCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    /**
     * The data needed to create a PrescriptionItem.
     */
    data: XOR<PrescriptionItemCreateInput, PrescriptionItemUncheckedCreateInput>
  }

  /**
   * PrescriptionItem createMany
   */
  export type PrescriptionItemCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PrescriptionItems.
     */
    data: PrescriptionItemCreateManyInput | PrescriptionItemCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PrescriptionItem createManyAndReturn
   */
  export type PrescriptionItemCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * The data used to create many PrescriptionItems.
     */
    data: PrescriptionItemCreateManyInput | PrescriptionItemCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * PrescriptionItem update
   */
  export type PrescriptionItemUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    /**
     * The data needed to update a PrescriptionItem.
     */
    data: XOR<PrescriptionItemUpdateInput, PrescriptionItemUncheckedUpdateInput>
    /**
     * Choose, which PrescriptionItem to update.
     */
    where: PrescriptionItemWhereUniqueInput
  }

  /**
   * PrescriptionItem updateMany
   */
  export type PrescriptionItemUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PrescriptionItems.
     */
    data: XOR<PrescriptionItemUpdateManyMutationInput, PrescriptionItemUncheckedUpdateManyInput>
    /**
     * Filter which PrescriptionItems to update
     */
    where?: PrescriptionItemWhereInput
    /**
     * Limit how many PrescriptionItems to update.
     */
    limit?: number
  }

  /**
   * PrescriptionItem updateManyAndReturn
   */
  export type PrescriptionItemUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * The data used to update PrescriptionItems.
     */
    data: XOR<PrescriptionItemUpdateManyMutationInput, PrescriptionItemUncheckedUpdateManyInput>
    /**
     * Filter which PrescriptionItems to update
     */
    where?: PrescriptionItemWhereInput
    /**
     * Limit how many PrescriptionItems to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * PrescriptionItem upsert
   */
  export type PrescriptionItemUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    /**
     * The filter to search for the PrescriptionItem to update in case it exists.
     */
    where: PrescriptionItemWhereUniqueInput
    /**
     * In case the PrescriptionItem found by the `where` argument doesn't exist, create a new PrescriptionItem with this data.
     */
    create: XOR<PrescriptionItemCreateInput, PrescriptionItemUncheckedCreateInput>
    /**
     * In case the PrescriptionItem was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PrescriptionItemUpdateInput, PrescriptionItemUncheckedUpdateInput>
  }

  /**
   * PrescriptionItem delete
   */
  export type PrescriptionItemDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    /**
     * Filter which PrescriptionItem to delete.
     */
    where: PrescriptionItemWhereUniqueInput
  }

  /**
   * PrescriptionItem deleteMany
   */
  export type PrescriptionItemDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PrescriptionItems to delete
     */
    where?: PrescriptionItemWhereInput
    /**
     * Limit how many PrescriptionItems to delete.
     */
    limit?: number
  }

  /**
   * PrescriptionItem without action
   */
  export type PrescriptionItemDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
  }


  /**
   * Model Medicine
   */

  export type AggregateMedicine = {
    _count: MedicineCountAggregateOutputType | null
    _avg: MedicineAvgAggregateOutputType | null
    _sum: MedicineSumAggregateOutputType | null
    _min: MedicineMinAggregateOutputType | null
    _max: MedicineMaxAggregateOutputType | null
  }

  export type MedicineAvgAggregateOutputType = {
    price: number | null
    stock: number | null
  }

  export type MedicineSumAggregateOutputType = {
    price: number | null
    stock: number | null
  }

  export type MedicineMinAggregateOutputType = {
    id: string | null
    name: string | null
    description: string | null
    ingredients: string | null
    dosage: string | null
    manufacturer: string | null
    price: number | null
    stock: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type MedicineMaxAggregateOutputType = {
    id: string | null
    name: string | null
    description: string | null
    ingredients: string | null
    dosage: string | null
    manufacturer: string | null
    price: number | null
    stock: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type MedicineCountAggregateOutputType = {
    id: number
    name: number
    description: number
    ingredients: number
    dosage: number
    manufacturer: number
    price: number
    stock: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type MedicineAvgAggregateInputType = {
    price?: true
    stock?: true
  }

  export type MedicineSumAggregateInputType = {
    price?: true
    stock?: true
  }

  export type MedicineMinAggregateInputType = {
    id?: true
    name?: true
    description?: true
    ingredients?: true
    dosage?: true
    manufacturer?: true
    price?: true
    stock?: true
    createdAt?: true
    updatedAt?: true
  }

  export type MedicineMaxAggregateInputType = {
    id?: true
    name?: true
    description?: true
    ingredients?: true
    dosage?: true
    manufacturer?: true
    price?: true
    stock?: true
    createdAt?: true
    updatedAt?: true
  }

  export type MedicineCountAggregateInputType = {
    id?: true
    name?: true
    description?: true
    ingredients?: true
    dosage?: true
    manufacturer?: true
    price?: true
    stock?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type MedicineAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Medicine to aggregate.
     */
    where?: MedicineWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Medicines to fetch.
     */
    orderBy?: MedicineOrderByWithRelationInput | MedicineOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: MedicineWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Medicines from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Medicines.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Medicines
    **/
    _count?: true | MedicineCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: MedicineAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: MedicineSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: MedicineMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: MedicineMaxAggregateInputType
  }

  export type GetMedicineAggregateType<T extends MedicineAggregateArgs> = {
        [P in keyof T & keyof AggregateMedicine]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateMedicine[P]>
      : GetScalarType<T[P], AggregateMedicine[P]>
  }




  export type MedicineGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MedicineWhereInput
    orderBy?: MedicineOrderByWithAggregationInput | MedicineOrderByWithAggregationInput[]
    by: MedicineScalarFieldEnum[] | MedicineScalarFieldEnum
    having?: MedicineScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: MedicineCountAggregateInputType | true
    _avg?: MedicineAvgAggregateInputType
    _sum?: MedicineSumAggregateInputType
    _min?: MedicineMinAggregateInputType
    _max?: MedicineMaxAggregateInputType
  }

  export type MedicineGroupByOutputType = {
    id: string
    name: string
    description: string | null
    ingredients: string | null
    dosage: string | null
    manufacturer: string | null
    price: number | null
    stock: number
    createdAt: Date
    updatedAt: Date
    _count: MedicineCountAggregateOutputType | null
    _avg: MedicineAvgAggregateOutputType | null
    _sum: MedicineSumAggregateOutputType | null
    _min: MedicineMinAggregateOutputType | null
    _max: MedicineMaxAggregateOutputType | null
  }

  type GetMedicineGroupByPayload<T extends MedicineGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<MedicineGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof MedicineGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], MedicineGroupByOutputType[P]>
            : GetScalarType<T[P], MedicineGroupByOutputType[P]>
        }
      >
    >


  export type MedicineSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    description?: boolean
    ingredients?: boolean
    dosage?: boolean
    manufacturer?: boolean
    price?: boolean
    stock?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    prescriptionItems?: boolean | Medicine$prescriptionItemsArgs<ExtArgs>
    _count?: boolean | MedicineCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["medicine"]>

  export type MedicineSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    description?: boolean
    ingredients?: boolean
    dosage?: boolean
    manufacturer?: boolean
    price?: boolean
    stock?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["medicine"]>

  export type MedicineSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    description?: boolean
    ingredients?: boolean
    dosage?: boolean
    manufacturer?: boolean
    price?: boolean
    stock?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["medicine"]>

  export type MedicineSelectScalar = {
    id?: boolean
    name?: boolean
    description?: boolean
    ingredients?: boolean
    dosage?: boolean
    manufacturer?: boolean
    price?: boolean
    stock?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type MedicineOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "name" | "description" | "ingredients" | "dosage" | "manufacturer" | "price" | "stock" | "createdAt" | "updatedAt", ExtArgs["result"]["medicine"]>
  export type MedicineInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    prescriptionItems?: boolean | Medicine$prescriptionItemsArgs<ExtArgs>
    _count?: boolean | MedicineCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type MedicineIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type MedicineIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $MedicinePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Medicine"
    objects: {
      prescriptionItems: Prisma.$PrescriptionItemPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      description: string | null
      ingredients: string | null
      dosage: string | null
      manufacturer: string | null
      price: number | null
      stock: number
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["medicine"]>
    composites: {}
  }

  type MedicineGetPayload<S extends boolean | null | undefined | MedicineDefaultArgs> = $Result.GetResult<Prisma.$MedicinePayload, S>

  type MedicineCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<MedicineFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: MedicineCountAggregateInputType | true
    }

  export interface MedicineDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Medicine'], meta: { name: 'Medicine' } }
    /**
     * Find zero or one Medicine that matches the filter.
     * @param {MedicineFindUniqueArgs} args - Arguments to find a Medicine
     * @example
     * // Get one Medicine
     * const medicine = await prisma.medicine.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends MedicineFindUniqueArgs>(args: SelectSubset<T, MedicineFindUniqueArgs<ExtArgs>>): Prisma__MedicineClient<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Medicine that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {MedicineFindUniqueOrThrowArgs} args - Arguments to find a Medicine
     * @example
     * // Get one Medicine
     * const medicine = await prisma.medicine.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends MedicineFindUniqueOrThrowArgs>(args: SelectSubset<T, MedicineFindUniqueOrThrowArgs<ExtArgs>>): Prisma__MedicineClient<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Medicine that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MedicineFindFirstArgs} args - Arguments to find a Medicine
     * @example
     * // Get one Medicine
     * const medicine = await prisma.medicine.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends MedicineFindFirstArgs>(args?: SelectSubset<T, MedicineFindFirstArgs<ExtArgs>>): Prisma__MedicineClient<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Medicine that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MedicineFindFirstOrThrowArgs} args - Arguments to find a Medicine
     * @example
     * // Get one Medicine
     * const medicine = await prisma.medicine.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends MedicineFindFirstOrThrowArgs>(args?: SelectSubset<T, MedicineFindFirstOrThrowArgs<ExtArgs>>): Prisma__MedicineClient<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Medicines that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MedicineFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Medicines
     * const medicines = await prisma.medicine.findMany()
     * 
     * // Get first 10 Medicines
     * const medicines = await prisma.medicine.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const medicineWithIdOnly = await prisma.medicine.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends MedicineFindManyArgs>(args?: SelectSubset<T, MedicineFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Medicine.
     * @param {MedicineCreateArgs} args - Arguments to create a Medicine.
     * @example
     * // Create one Medicine
     * const Medicine = await prisma.medicine.create({
     *   data: {
     *     // ... data to create a Medicine
     *   }
     * })
     * 
     */
    create<T extends MedicineCreateArgs>(args: SelectSubset<T, MedicineCreateArgs<ExtArgs>>): Prisma__MedicineClient<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Medicines.
     * @param {MedicineCreateManyArgs} args - Arguments to create many Medicines.
     * @example
     * // Create many Medicines
     * const medicine = await prisma.medicine.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends MedicineCreateManyArgs>(args?: SelectSubset<T, MedicineCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Medicines and returns the data saved in the database.
     * @param {MedicineCreateManyAndReturnArgs} args - Arguments to create many Medicines.
     * @example
     * // Create many Medicines
     * const medicine = await prisma.medicine.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Medicines and only return the `id`
     * const medicineWithIdOnly = await prisma.medicine.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends MedicineCreateManyAndReturnArgs>(args?: SelectSubset<T, MedicineCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Medicine.
     * @param {MedicineDeleteArgs} args - Arguments to delete one Medicine.
     * @example
     * // Delete one Medicine
     * const Medicine = await prisma.medicine.delete({
     *   where: {
     *     // ... filter to delete one Medicine
     *   }
     * })
     * 
     */
    delete<T extends MedicineDeleteArgs>(args: SelectSubset<T, MedicineDeleteArgs<ExtArgs>>): Prisma__MedicineClient<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Medicine.
     * @param {MedicineUpdateArgs} args - Arguments to update one Medicine.
     * @example
     * // Update one Medicine
     * const medicine = await prisma.medicine.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends MedicineUpdateArgs>(args: SelectSubset<T, MedicineUpdateArgs<ExtArgs>>): Prisma__MedicineClient<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Medicines.
     * @param {MedicineDeleteManyArgs} args - Arguments to filter Medicines to delete.
     * @example
     * // Delete a few Medicines
     * const { count } = await prisma.medicine.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends MedicineDeleteManyArgs>(args?: SelectSubset<T, MedicineDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Medicines.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MedicineUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Medicines
     * const medicine = await prisma.medicine.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends MedicineUpdateManyArgs>(args: SelectSubset<T, MedicineUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Medicines and returns the data updated in the database.
     * @param {MedicineUpdateManyAndReturnArgs} args - Arguments to update many Medicines.
     * @example
     * // Update many Medicines
     * const medicine = await prisma.medicine.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Medicines and only return the `id`
     * const medicineWithIdOnly = await prisma.medicine.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends MedicineUpdateManyAndReturnArgs>(args: SelectSubset<T, MedicineUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Medicine.
     * @param {MedicineUpsertArgs} args - Arguments to update or create a Medicine.
     * @example
     * // Update or create a Medicine
     * const medicine = await prisma.medicine.upsert({
     *   create: {
     *     // ... data to create a Medicine
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Medicine we want to update
     *   }
     * })
     */
    upsert<T extends MedicineUpsertArgs>(args: SelectSubset<T, MedicineUpsertArgs<ExtArgs>>): Prisma__MedicineClient<$Result.GetResult<Prisma.$MedicinePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Medicines.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MedicineCountArgs} args - Arguments to filter Medicines to count.
     * @example
     * // Count the number of Medicines
     * const count = await prisma.medicine.count({
     *   where: {
     *     // ... the filter for the Medicines we want to count
     *   }
     * })
    **/
    count<T extends MedicineCountArgs>(
      args?: Subset<T, MedicineCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], MedicineCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Medicine.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MedicineAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends MedicineAggregateArgs>(args: Subset<T, MedicineAggregateArgs>): Prisma.PrismaPromise<GetMedicineAggregateType<T>>

    /**
     * Group by Medicine.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MedicineGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends MedicineGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: MedicineGroupByArgs['orderBy'] }
        : { orderBy?: MedicineGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, MedicineGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetMedicineGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Medicine model
   */
  readonly fields: MedicineFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Medicine.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__MedicineClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    prescriptionItems<T extends Medicine$prescriptionItemsArgs<ExtArgs> = {}>(args?: Subset<T, Medicine$prescriptionItemsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrescriptionItemPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Medicine model
   */
  interface MedicineFieldRefs {
    readonly id: FieldRef<"Medicine", 'String'>
    readonly name: FieldRef<"Medicine", 'String'>
    readonly description: FieldRef<"Medicine", 'String'>
    readonly ingredients: FieldRef<"Medicine", 'String'>
    readonly dosage: FieldRef<"Medicine", 'String'>
    readonly manufacturer: FieldRef<"Medicine", 'String'>
    readonly price: FieldRef<"Medicine", 'Float'>
    readonly stock: FieldRef<"Medicine", 'Int'>
    readonly createdAt: FieldRef<"Medicine", 'DateTime'>
    readonly updatedAt: FieldRef<"Medicine", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Medicine findUnique
   */
  export type MedicineFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MedicineInclude<ExtArgs> | null
    /**
     * Filter, which Medicine to fetch.
     */
    where: MedicineWhereUniqueInput
  }

  /**
   * Medicine findUniqueOrThrow
   */
  export type MedicineFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MedicineInclude<ExtArgs> | null
    /**
     * Filter, which Medicine to fetch.
     */
    where: MedicineWhereUniqueInput
  }

  /**
   * Medicine findFirst
   */
  export type MedicineFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MedicineInclude<ExtArgs> | null
    /**
     * Filter, which Medicine to fetch.
     */
    where?: MedicineWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Medicines to fetch.
     */
    orderBy?: MedicineOrderByWithRelationInput | MedicineOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Medicines.
     */
    cursor?: MedicineWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Medicines from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Medicines.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Medicines.
     */
    distinct?: MedicineScalarFieldEnum | MedicineScalarFieldEnum[]
  }

  /**
   * Medicine findFirstOrThrow
   */
  export type MedicineFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MedicineInclude<ExtArgs> | null
    /**
     * Filter, which Medicine to fetch.
     */
    where?: MedicineWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Medicines to fetch.
     */
    orderBy?: MedicineOrderByWithRelationInput | MedicineOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Medicines.
     */
    cursor?: MedicineWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Medicines from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Medicines.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Medicines.
     */
    distinct?: MedicineScalarFieldEnum | MedicineScalarFieldEnum[]
  }

  /**
   * Medicine findMany
   */
  export type MedicineFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MedicineInclude<ExtArgs> | null
    /**
     * Filter, which Medicines to fetch.
     */
    where?: MedicineWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Medicines to fetch.
     */
    orderBy?: MedicineOrderByWithRelationInput | MedicineOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Medicines.
     */
    cursor?: MedicineWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Medicines from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Medicines.
     */
    skip?: number
    distinct?: MedicineScalarFieldEnum | MedicineScalarFieldEnum[]
  }

  /**
   * Medicine create
   */
  export type MedicineCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MedicineInclude<ExtArgs> | null
    /**
     * The data needed to create a Medicine.
     */
    data: XOR<MedicineCreateInput, MedicineUncheckedCreateInput>
  }

  /**
   * Medicine createMany
   */
  export type MedicineCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Medicines.
     */
    data: MedicineCreateManyInput | MedicineCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Medicine createManyAndReturn
   */
  export type MedicineCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * The data used to create many Medicines.
     */
    data: MedicineCreateManyInput | MedicineCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Medicine update
   */
  export type MedicineUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MedicineInclude<ExtArgs> | null
    /**
     * The data needed to update a Medicine.
     */
    data: XOR<MedicineUpdateInput, MedicineUncheckedUpdateInput>
    /**
     * Choose, which Medicine to update.
     */
    where: MedicineWhereUniqueInput
  }

  /**
   * Medicine updateMany
   */
  export type MedicineUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Medicines.
     */
    data: XOR<MedicineUpdateManyMutationInput, MedicineUncheckedUpdateManyInput>
    /**
     * Filter which Medicines to update
     */
    where?: MedicineWhereInput
    /**
     * Limit how many Medicines to update.
     */
    limit?: number
  }

  /**
   * Medicine updateManyAndReturn
   */
  export type MedicineUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * The data used to update Medicines.
     */
    data: XOR<MedicineUpdateManyMutationInput, MedicineUncheckedUpdateManyInput>
    /**
     * Filter which Medicines to update
     */
    where?: MedicineWhereInput
    /**
     * Limit how many Medicines to update.
     */
    limit?: number
  }

  /**
   * Medicine upsert
   */
  export type MedicineUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MedicineInclude<ExtArgs> | null
    /**
     * The filter to search for the Medicine to update in case it exists.
     */
    where: MedicineWhereUniqueInput
    /**
     * In case the Medicine found by the `where` argument doesn't exist, create a new Medicine with this data.
     */
    create: XOR<MedicineCreateInput, MedicineUncheckedCreateInput>
    /**
     * In case the Medicine was found with the provided `where` argument, update it with this data.
     */
    update: XOR<MedicineUpdateInput, MedicineUncheckedUpdateInput>
  }

  /**
   * Medicine delete
   */
  export type MedicineDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MedicineInclude<ExtArgs> | null
    /**
     * Filter which Medicine to delete.
     */
    where: MedicineWhereUniqueInput
  }

  /**
   * Medicine deleteMany
   */
  export type MedicineDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Medicines to delete
     */
    where?: MedicineWhereInput
    /**
     * Limit how many Medicines to delete.
     */
    limit?: number
  }

  /**
   * Medicine.prescriptionItems
   */
  export type Medicine$prescriptionItemsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrescriptionItem
     */
    select?: PrescriptionItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrescriptionItem
     */
    omit?: PrescriptionItemOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PrescriptionItemInclude<ExtArgs> | null
    where?: PrescriptionItemWhereInput
    orderBy?: PrescriptionItemOrderByWithRelationInput | PrescriptionItemOrderByWithRelationInput[]
    cursor?: PrescriptionItemWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PrescriptionItemScalarFieldEnum | PrescriptionItemScalarFieldEnum[]
  }

  /**
   * Medicine without action
   */
  export type MedicineDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Medicine
     */
    select?: MedicineSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Medicine
     */
    omit?: MedicineOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MedicineInclude<ExtArgs> | null
  }


  /**
   * Model HealthRecord
   */

  export type AggregateHealthRecord = {
    _count: HealthRecordCountAggregateOutputType | null
    _min: HealthRecordMinAggregateOutputType | null
    _max: HealthRecordMaxAggregateOutputType | null
  }

  export type HealthRecordMinAggregateOutputType = {
    id: string | null
    patientId: string | null
    doctorId: string | null
    recordType: $Enums.HealthRecordType | null
    report: string | null
    fileUrl: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type HealthRecordMaxAggregateOutputType = {
    id: string | null
    patientId: string | null
    doctorId: string | null
    recordType: $Enums.HealthRecordType | null
    report: string | null
    fileUrl: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type HealthRecordCountAggregateOutputType = {
    id: number
    patientId: number
    doctorId: number
    recordType: number
    report: number
    fileUrl: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type HealthRecordMinAggregateInputType = {
    id?: true
    patientId?: true
    doctorId?: true
    recordType?: true
    report?: true
    fileUrl?: true
    createdAt?: true
    updatedAt?: true
  }

  export type HealthRecordMaxAggregateInputType = {
    id?: true
    patientId?: true
    doctorId?: true
    recordType?: true
    report?: true
    fileUrl?: true
    createdAt?: true
    updatedAt?: true
  }

  export type HealthRecordCountAggregateInputType = {
    id?: true
    patientId?: true
    doctorId?: true
    recordType?: true
    report?: true
    fileUrl?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type HealthRecordAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which HealthRecord to aggregate.
     */
    where?: HealthRecordWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of HealthRecords to fetch.
     */
    orderBy?: HealthRecordOrderByWithRelationInput | HealthRecordOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: HealthRecordWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` HealthRecords from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` HealthRecords.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned HealthRecords
    **/
    _count?: true | HealthRecordCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: HealthRecordMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: HealthRecordMaxAggregateInputType
  }

  export type GetHealthRecordAggregateType<T extends HealthRecordAggregateArgs> = {
        [P in keyof T & keyof AggregateHealthRecord]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateHealthRecord[P]>
      : GetScalarType<T[P], AggregateHealthRecord[P]>
  }




  export type HealthRecordGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: HealthRecordWhereInput
    orderBy?: HealthRecordOrderByWithAggregationInput | HealthRecordOrderByWithAggregationInput[]
    by: HealthRecordScalarFieldEnum[] | HealthRecordScalarFieldEnum
    having?: HealthRecordScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: HealthRecordCountAggregateInputType | true
    _min?: HealthRecordMinAggregateInputType
    _max?: HealthRecordMaxAggregateInputType
  }

  export type HealthRecordGroupByOutputType = {
    id: string
    patientId: string
    doctorId: string
    recordType: $Enums.HealthRecordType
    report: string | null
    fileUrl: string | null
    createdAt: Date
    updatedAt: Date
    _count: HealthRecordCountAggregateOutputType | null
    _min: HealthRecordMinAggregateOutputType | null
    _max: HealthRecordMaxAggregateOutputType | null
  }

  type GetHealthRecordGroupByPayload<T extends HealthRecordGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<HealthRecordGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof HealthRecordGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], HealthRecordGroupByOutputType[P]>
            : GetScalarType<T[P], HealthRecordGroupByOutputType[P]>
        }
      >
    >


  export type HealthRecordSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    patientId?: boolean
    doctorId?: boolean
    recordType?: boolean
    report?: boolean
    fileUrl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["healthRecord"]>

  export type HealthRecordSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    patientId?: boolean
    doctorId?: boolean
    recordType?: boolean
    report?: boolean
    fileUrl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["healthRecord"]>

  export type HealthRecordSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    patientId?: boolean
    doctorId?: boolean
    recordType?: boolean
    report?: boolean
    fileUrl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["healthRecord"]>

  export type HealthRecordSelectScalar = {
    id?: boolean
    patientId?: boolean
    doctorId?: boolean
    recordType?: boolean
    report?: boolean
    fileUrl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type HealthRecordOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "patientId" | "doctorId" | "recordType" | "report" | "fileUrl" | "createdAt" | "updatedAt", ExtArgs["result"]["healthRecord"]>
  export type HealthRecordInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }
  export type HealthRecordIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }
  export type HealthRecordIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }

  export type $HealthRecordPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "HealthRecord"
    objects: {
      doctor: Prisma.$DoctorPayload<ExtArgs>
      patient: Prisma.$PatientPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      patientId: string
      doctorId: string
      recordType: $Enums.HealthRecordType
      report: string | null
      fileUrl: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["healthRecord"]>
    composites: {}
  }

  type HealthRecordGetPayload<S extends boolean | null | undefined | HealthRecordDefaultArgs> = $Result.GetResult<Prisma.$HealthRecordPayload, S>

  type HealthRecordCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<HealthRecordFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: HealthRecordCountAggregateInputType | true
    }

  export interface HealthRecordDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['HealthRecord'], meta: { name: 'HealthRecord' } }
    /**
     * Find zero or one HealthRecord that matches the filter.
     * @param {HealthRecordFindUniqueArgs} args - Arguments to find a HealthRecord
     * @example
     * // Get one HealthRecord
     * const healthRecord = await prisma.healthRecord.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends HealthRecordFindUniqueArgs>(args: SelectSubset<T, HealthRecordFindUniqueArgs<ExtArgs>>): Prisma__HealthRecordClient<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one HealthRecord that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {HealthRecordFindUniqueOrThrowArgs} args - Arguments to find a HealthRecord
     * @example
     * // Get one HealthRecord
     * const healthRecord = await prisma.healthRecord.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends HealthRecordFindUniqueOrThrowArgs>(args: SelectSubset<T, HealthRecordFindUniqueOrThrowArgs<ExtArgs>>): Prisma__HealthRecordClient<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first HealthRecord that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HealthRecordFindFirstArgs} args - Arguments to find a HealthRecord
     * @example
     * // Get one HealthRecord
     * const healthRecord = await prisma.healthRecord.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends HealthRecordFindFirstArgs>(args?: SelectSubset<T, HealthRecordFindFirstArgs<ExtArgs>>): Prisma__HealthRecordClient<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first HealthRecord that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HealthRecordFindFirstOrThrowArgs} args - Arguments to find a HealthRecord
     * @example
     * // Get one HealthRecord
     * const healthRecord = await prisma.healthRecord.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends HealthRecordFindFirstOrThrowArgs>(args?: SelectSubset<T, HealthRecordFindFirstOrThrowArgs<ExtArgs>>): Prisma__HealthRecordClient<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more HealthRecords that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HealthRecordFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all HealthRecords
     * const healthRecords = await prisma.healthRecord.findMany()
     * 
     * // Get first 10 HealthRecords
     * const healthRecords = await prisma.healthRecord.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const healthRecordWithIdOnly = await prisma.healthRecord.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends HealthRecordFindManyArgs>(args?: SelectSubset<T, HealthRecordFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a HealthRecord.
     * @param {HealthRecordCreateArgs} args - Arguments to create a HealthRecord.
     * @example
     * // Create one HealthRecord
     * const HealthRecord = await prisma.healthRecord.create({
     *   data: {
     *     // ... data to create a HealthRecord
     *   }
     * })
     * 
     */
    create<T extends HealthRecordCreateArgs>(args: SelectSubset<T, HealthRecordCreateArgs<ExtArgs>>): Prisma__HealthRecordClient<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many HealthRecords.
     * @param {HealthRecordCreateManyArgs} args - Arguments to create many HealthRecords.
     * @example
     * // Create many HealthRecords
     * const healthRecord = await prisma.healthRecord.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends HealthRecordCreateManyArgs>(args?: SelectSubset<T, HealthRecordCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many HealthRecords and returns the data saved in the database.
     * @param {HealthRecordCreateManyAndReturnArgs} args - Arguments to create many HealthRecords.
     * @example
     * // Create many HealthRecords
     * const healthRecord = await prisma.healthRecord.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many HealthRecords and only return the `id`
     * const healthRecordWithIdOnly = await prisma.healthRecord.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends HealthRecordCreateManyAndReturnArgs>(args?: SelectSubset<T, HealthRecordCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a HealthRecord.
     * @param {HealthRecordDeleteArgs} args - Arguments to delete one HealthRecord.
     * @example
     * // Delete one HealthRecord
     * const HealthRecord = await prisma.healthRecord.delete({
     *   where: {
     *     // ... filter to delete one HealthRecord
     *   }
     * })
     * 
     */
    delete<T extends HealthRecordDeleteArgs>(args: SelectSubset<T, HealthRecordDeleteArgs<ExtArgs>>): Prisma__HealthRecordClient<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one HealthRecord.
     * @param {HealthRecordUpdateArgs} args - Arguments to update one HealthRecord.
     * @example
     * // Update one HealthRecord
     * const healthRecord = await prisma.healthRecord.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends HealthRecordUpdateArgs>(args: SelectSubset<T, HealthRecordUpdateArgs<ExtArgs>>): Prisma__HealthRecordClient<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more HealthRecords.
     * @param {HealthRecordDeleteManyArgs} args - Arguments to filter HealthRecords to delete.
     * @example
     * // Delete a few HealthRecords
     * const { count } = await prisma.healthRecord.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends HealthRecordDeleteManyArgs>(args?: SelectSubset<T, HealthRecordDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more HealthRecords.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HealthRecordUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many HealthRecords
     * const healthRecord = await prisma.healthRecord.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends HealthRecordUpdateManyArgs>(args: SelectSubset<T, HealthRecordUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more HealthRecords and returns the data updated in the database.
     * @param {HealthRecordUpdateManyAndReturnArgs} args - Arguments to update many HealthRecords.
     * @example
     * // Update many HealthRecords
     * const healthRecord = await prisma.healthRecord.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more HealthRecords and only return the `id`
     * const healthRecordWithIdOnly = await prisma.healthRecord.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends HealthRecordUpdateManyAndReturnArgs>(args: SelectSubset<T, HealthRecordUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one HealthRecord.
     * @param {HealthRecordUpsertArgs} args - Arguments to update or create a HealthRecord.
     * @example
     * // Update or create a HealthRecord
     * const healthRecord = await prisma.healthRecord.upsert({
     *   create: {
     *     // ... data to create a HealthRecord
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the HealthRecord we want to update
     *   }
     * })
     */
    upsert<T extends HealthRecordUpsertArgs>(args: SelectSubset<T, HealthRecordUpsertArgs<ExtArgs>>): Prisma__HealthRecordClient<$Result.GetResult<Prisma.$HealthRecordPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of HealthRecords.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HealthRecordCountArgs} args - Arguments to filter HealthRecords to count.
     * @example
     * // Count the number of HealthRecords
     * const count = await prisma.healthRecord.count({
     *   where: {
     *     // ... the filter for the HealthRecords we want to count
     *   }
     * })
    **/
    count<T extends HealthRecordCountArgs>(
      args?: Subset<T, HealthRecordCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], HealthRecordCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a HealthRecord.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HealthRecordAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends HealthRecordAggregateArgs>(args: Subset<T, HealthRecordAggregateArgs>): Prisma.PrismaPromise<GetHealthRecordAggregateType<T>>

    /**
     * Group by HealthRecord.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HealthRecordGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends HealthRecordGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: HealthRecordGroupByArgs['orderBy'] }
        : { orderBy?: HealthRecordGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, HealthRecordGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetHealthRecordGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the HealthRecord model
   */
  readonly fields: HealthRecordFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for HealthRecord.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__HealthRecordClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    doctor<T extends DoctorDefaultArgs<ExtArgs> = {}>(args?: Subset<T, DoctorDefaultArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    patient<T extends PatientDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PatientDefaultArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the HealthRecord model
   */
  interface HealthRecordFieldRefs {
    readonly id: FieldRef<"HealthRecord", 'String'>
    readonly patientId: FieldRef<"HealthRecord", 'String'>
    readonly doctorId: FieldRef<"HealthRecord", 'String'>
    readonly recordType: FieldRef<"HealthRecord", 'HealthRecordType'>
    readonly report: FieldRef<"HealthRecord", 'String'>
    readonly fileUrl: FieldRef<"HealthRecord", 'String'>
    readonly createdAt: FieldRef<"HealthRecord", 'DateTime'>
    readonly updatedAt: FieldRef<"HealthRecord", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * HealthRecord findUnique
   */
  export type HealthRecordFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    /**
     * Filter, which HealthRecord to fetch.
     */
    where: HealthRecordWhereUniqueInput
  }

  /**
   * HealthRecord findUniqueOrThrow
   */
  export type HealthRecordFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    /**
     * Filter, which HealthRecord to fetch.
     */
    where: HealthRecordWhereUniqueInput
  }

  /**
   * HealthRecord findFirst
   */
  export type HealthRecordFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    /**
     * Filter, which HealthRecord to fetch.
     */
    where?: HealthRecordWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of HealthRecords to fetch.
     */
    orderBy?: HealthRecordOrderByWithRelationInput | HealthRecordOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for HealthRecords.
     */
    cursor?: HealthRecordWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` HealthRecords from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` HealthRecords.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of HealthRecords.
     */
    distinct?: HealthRecordScalarFieldEnum | HealthRecordScalarFieldEnum[]
  }

  /**
   * HealthRecord findFirstOrThrow
   */
  export type HealthRecordFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    /**
     * Filter, which HealthRecord to fetch.
     */
    where?: HealthRecordWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of HealthRecords to fetch.
     */
    orderBy?: HealthRecordOrderByWithRelationInput | HealthRecordOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for HealthRecords.
     */
    cursor?: HealthRecordWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` HealthRecords from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` HealthRecords.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of HealthRecords.
     */
    distinct?: HealthRecordScalarFieldEnum | HealthRecordScalarFieldEnum[]
  }

  /**
   * HealthRecord findMany
   */
  export type HealthRecordFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    /**
     * Filter, which HealthRecords to fetch.
     */
    where?: HealthRecordWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of HealthRecords to fetch.
     */
    orderBy?: HealthRecordOrderByWithRelationInput | HealthRecordOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing HealthRecords.
     */
    cursor?: HealthRecordWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` HealthRecords from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` HealthRecords.
     */
    skip?: number
    distinct?: HealthRecordScalarFieldEnum | HealthRecordScalarFieldEnum[]
  }

  /**
   * HealthRecord create
   */
  export type HealthRecordCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    /**
     * The data needed to create a HealthRecord.
     */
    data: XOR<HealthRecordCreateInput, HealthRecordUncheckedCreateInput>
  }

  /**
   * HealthRecord createMany
   */
  export type HealthRecordCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many HealthRecords.
     */
    data: HealthRecordCreateManyInput | HealthRecordCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * HealthRecord createManyAndReturn
   */
  export type HealthRecordCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * The data used to create many HealthRecords.
     */
    data: HealthRecordCreateManyInput | HealthRecordCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * HealthRecord update
   */
  export type HealthRecordUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    /**
     * The data needed to update a HealthRecord.
     */
    data: XOR<HealthRecordUpdateInput, HealthRecordUncheckedUpdateInput>
    /**
     * Choose, which HealthRecord to update.
     */
    where: HealthRecordWhereUniqueInput
  }

  /**
   * HealthRecord updateMany
   */
  export type HealthRecordUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update HealthRecords.
     */
    data: XOR<HealthRecordUpdateManyMutationInput, HealthRecordUncheckedUpdateManyInput>
    /**
     * Filter which HealthRecords to update
     */
    where?: HealthRecordWhereInput
    /**
     * Limit how many HealthRecords to update.
     */
    limit?: number
  }

  /**
   * HealthRecord updateManyAndReturn
   */
  export type HealthRecordUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * The data used to update HealthRecords.
     */
    data: XOR<HealthRecordUpdateManyMutationInput, HealthRecordUncheckedUpdateManyInput>
    /**
     * Filter which HealthRecords to update
     */
    where?: HealthRecordWhereInput
    /**
     * Limit how many HealthRecords to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * HealthRecord upsert
   */
  export type HealthRecordUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    /**
     * The filter to search for the HealthRecord to update in case it exists.
     */
    where: HealthRecordWhereUniqueInput
    /**
     * In case the HealthRecord found by the `where` argument doesn't exist, create a new HealthRecord with this data.
     */
    create: XOR<HealthRecordCreateInput, HealthRecordUncheckedCreateInput>
    /**
     * In case the HealthRecord was found with the provided `where` argument, update it with this data.
     */
    update: XOR<HealthRecordUpdateInput, HealthRecordUncheckedUpdateInput>
  }

  /**
   * HealthRecord delete
   */
  export type HealthRecordDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
    /**
     * Filter which HealthRecord to delete.
     */
    where: HealthRecordWhereUniqueInput
  }

  /**
   * HealthRecord deleteMany
   */
  export type HealthRecordDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which HealthRecords to delete
     */
    where?: HealthRecordWhereInput
    /**
     * Limit how many HealthRecords to delete.
     */
    limit?: number
  }

  /**
   * HealthRecord without action
   */
  export type HealthRecordDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HealthRecord
     */
    select?: HealthRecordSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HealthRecord
     */
    omit?: HealthRecordOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: HealthRecordInclude<ExtArgs> | null
  }


  /**
   * Model Review
   */

  export type AggregateReview = {
    _count: ReviewCountAggregateOutputType | null
    _avg: ReviewAvgAggregateOutputType | null
    _sum: ReviewSumAggregateOutputType | null
    _min: ReviewMinAggregateOutputType | null
    _max: ReviewMaxAggregateOutputType | null
  }

  export type ReviewAvgAggregateOutputType = {
    rating: number | null
  }

  export type ReviewSumAggregateOutputType = {
    rating: number | null
  }

  export type ReviewMinAggregateOutputType = {
    id: string | null
    rating: number | null
    comment: string | null
    patientId: string | null
    doctorId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ReviewMaxAggregateOutputType = {
    id: string | null
    rating: number | null
    comment: string | null
    patientId: string | null
    doctorId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ReviewCountAggregateOutputType = {
    id: number
    rating: number
    comment: number
    patientId: number
    doctorId: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type ReviewAvgAggregateInputType = {
    rating?: true
  }

  export type ReviewSumAggregateInputType = {
    rating?: true
  }

  export type ReviewMinAggregateInputType = {
    id?: true
    rating?: true
    comment?: true
    patientId?: true
    doctorId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ReviewMaxAggregateInputType = {
    id?: true
    rating?: true
    comment?: true
    patientId?: true
    doctorId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ReviewCountAggregateInputType = {
    id?: true
    rating?: true
    comment?: true
    patientId?: true
    doctorId?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type ReviewAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Review to aggregate.
     */
    where?: ReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Reviews to fetch.
     */
    orderBy?: ReviewOrderByWithRelationInput | ReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Reviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Reviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Reviews
    **/
    _count?: true | ReviewCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ReviewAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ReviewSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ReviewMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ReviewMaxAggregateInputType
  }

  export type GetReviewAggregateType<T extends ReviewAggregateArgs> = {
        [P in keyof T & keyof AggregateReview]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateReview[P]>
      : GetScalarType<T[P], AggregateReview[P]>
  }




  export type ReviewGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ReviewWhereInput
    orderBy?: ReviewOrderByWithAggregationInput | ReviewOrderByWithAggregationInput[]
    by: ReviewScalarFieldEnum[] | ReviewScalarFieldEnum
    having?: ReviewScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ReviewCountAggregateInputType | true
    _avg?: ReviewAvgAggregateInputType
    _sum?: ReviewSumAggregateInputType
    _min?: ReviewMinAggregateInputType
    _max?: ReviewMaxAggregateInputType
  }

  export type ReviewGroupByOutputType = {
    id: string
    rating: number
    comment: string | null
    patientId: string
    doctorId: string
    createdAt: Date
    updatedAt: Date
    _count: ReviewCountAggregateOutputType | null
    _avg: ReviewAvgAggregateOutputType | null
    _sum: ReviewSumAggregateOutputType | null
    _min: ReviewMinAggregateOutputType | null
    _max: ReviewMaxAggregateOutputType | null
  }

  type GetReviewGroupByPayload<T extends ReviewGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ReviewGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ReviewGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ReviewGroupByOutputType[P]>
            : GetScalarType<T[P], ReviewGroupByOutputType[P]>
        }
      >
    >


  export type ReviewSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    rating?: boolean
    comment?: boolean
    patientId?: boolean
    doctorId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["review"]>

  export type ReviewSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    rating?: boolean
    comment?: boolean
    patientId?: boolean
    doctorId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["review"]>

  export type ReviewSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    rating?: boolean
    comment?: boolean
    patientId?: boolean
    doctorId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["review"]>

  export type ReviewSelectScalar = {
    id?: boolean
    rating?: boolean
    comment?: boolean
    patientId?: boolean
    doctorId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type ReviewOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "rating" | "comment" | "patientId" | "doctorId" | "createdAt" | "updatedAt", ExtArgs["result"]["review"]>
  export type ReviewInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }
  export type ReviewIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }
  export type ReviewIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    doctor?: boolean | DoctorDefaultArgs<ExtArgs>
    patient?: boolean | PatientDefaultArgs<ExtArgs>
  }

  export type $ReviewPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Review"
    objects: {
      doctor: Prisma.$DoctorPayload<ExtArgs>
      patient: Prisma.$PatientPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      rating: number
      comment: string | null
      patientId: string
      doctorId: string
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["review"]>
    composites: {}
  }

  type ReviewGetPayload<S extends boolean | null | undefined | ReviewDefaultArgs> = $Result.GetResult<Prisma.$ReviewPayload, S>

  type ReviewCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<ReviewFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: ReviewCountAggregateInputType | true
    }

  export interface ReviewDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Review'], meta: { name: 'Review' } }
    /**
     * Find zero or one Review that matches the filter.
     * @param {ReviewFindUniqueArgs} args - Arguments to find a Review
     * @example
     * // Get one Review
     * const review = await prisma.review.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ReviewFindUniqueArgs>(args: SelectSubset<T, ReviewFindUniqueArgs<ExtArgs>>): Prisma__ReviewClient<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Review that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {ReviewFindUniqueOrThrowArgs} args - Arguments to find a Review
     * @example
     * // Get one Review
     * const review = await prisma.review.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ReviewFindUniqueOrThrowArgs>(args: SelectSubset<T, ReviewFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ReviewClient<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Review that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReviewFindFirstArgs} args - Arguments to find a Review
     * @example
     * // Get one Review
     * const review = await prisma.review.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ReviewFindFirstArgs>(args?: SelectSubset<T, ReviewFindFirstArgs<ExtArgs>>): Prisma__ReviewClient<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Review that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReviewFindFirstOrThrowArgs} args - Arguments to find a Review
     * @example
     * // Get one Review
     * const review = await prisma.review.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ReviewFindFirstOrThrowArgs>(args?: SelectSubset<T, ReviewFindFirstOrThrowArgs<ExtArgs>>): Prisma__ReviewClient<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Reviews that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReviewFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Reviews
     * const reviews = await prisma.review.findMany()
     * 
     * // Get first 10 Reviews
     * const reviews = await prisma.review.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const reviewWithIdOnly = await prisma.review.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ReviewFindManyArgs>(args?: SelectSubset<T, ReviewFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Review.
     * @param {ReviewCreateArgs} args - Arguments to create a Review.
     * @example
     * // Create one Review
     * const Review = await prisma.review.create({
     *   data: {
     *     // ... data to create a Review
     *   }
     * })
     * 
     */
    create<T extends ReviewCreateArgs>(args: SelectSubset<T, ReviewCreateArgs<ExtArgs>>): Prisma__ReviewClient<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Reviews.
     * @param {ReviewCreateManyArgs} args - Arguments to create many Reviews.
     * @example
     * // Create many Reviews
     * const review = await prisma.review.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ReviewCreateManyArgs>(args?: SelectSubset<T, ReviewCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Reviews and returns the data saved in the database.
     * @param {ReviewCreateManyAndReturnArgs} args - Arguments to create many Reviews.
     * @example
     * // Create many Reviews
     * const review = await prisma.review.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Reviews and only return the `id`
     * const reviewWithIdOnly = await prisma.review.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ReviewCreateManyAndReturnArgs>(args?: SelectSubset<T, ReviewCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Review.
     * @param {ReviewDeleteArgs} args - Arguments to delete one Review.
     * @example
     * // Delete one Review
     * const Review = await prisma.review.delete({
     *   where: {
     *     // ... filter to delete one Review
     *   }
     * })
     * 
     */
    delete<T extends ReviewDeleteArgs>(args: SelectSubset<T, ReviewDeleteArgs<ExtArgs>>): Prisma__ReviewClient<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Review.
     * @param {ReviewUpdateArgs} args - Arguments to update one Review.
     * @example
     * // Update one Review
     * const review = await prisma.review.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ReviewUpdateArgs>(args: SelectSubset<T, ReviewUpdateArgs<ExtArgs>>): Prisma__ReviewClient<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Reviews.
     * @param {ReviewDeleteManyArgs} args - Arguments to filter Reviews to delete.
     * @example
     * // Delete a few Reviews
     * const { count } = await prisma.review.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ReviewDeleteManyArgs>(args?: SelectSubset<T, ReviewDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Reviews.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReviewUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Reviews
     * const review = await prisma.review.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ReviewUpdateManyArgs>(args: SelectSubset<T, ReviewUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Reviews and returns the data updated in the database.
     * @param {ReviewUpdateManyAndReturnArgs} args - Arguments to update many Reviews.
     * @example
     * // Update many Reviews
     * const review = await prisma.review.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Reviews and only return the `id`
     * const reviewWithIdOnly = await prisma.review.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends ReviewUpdateManyAndReturnArgs>(args: SelectSubset<T, ReviewUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Review.
     * @param {ReviewUpsertArgs} args - Arguments to update or create a Review.
     * @example
     * // Update or create a Review
     * const review = await prisma.review.upsert({
     *   create: {
     *     // ... data to create a Review
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Review we want to update
     *   }
     * })
     */
    upsert<T extends ReviewUpsertArgs>(args: SelectSubset<T, ReviewUpsertArgs<ExtArgs>>): Prisma__ReviewClient<$Result.GetResult<Prisma.$ReviewPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Reviews.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReviewCountArgs} args - Arguments to filter Reviews to count.
     * @example
     * // Count the number of Reviews
     * const count = await prisma.review.count({
     *   where: {
     *     // ... the filter for the Reviews we want to count
     *   }
     * })
    **/
    count<T extends ReviewCountArgs>(
      args?: Subset<T, ReviewCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ReviewCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Review.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReviewAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ReviewAggregateArgs>(args: Subset<T, ReviewAggregateArgs>): Prisma.PrismaPromise<GetReviewAggregateType<T>>

    /**
     * Group by Review.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReviewGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ReviewGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ReviewGroupByArgs['orderBy'] }
        : { orderBy?: ReviewGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ReviewGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetReviewGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Review model
   */
  readonly fields: ReviewFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Review.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ReviewClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    doctor<T extends DoctorDefaultArgs<ExtArgs> = {}>(args?: Subset<T, DoctorDefaultArgs<ExtArgs>>): Prisma__DoctorClient<$Result.GetResult<Prisma.$DoctorPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    patient<T extends PatientDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PatientDefaultArgs<ExtArgs>>): Prisma__PatientClient<$Result.GetResult<Prisma.$PatientPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Review model
   */
  interface ReviewFieldRefs {
    readonly id: FieldRef<"Review", 'String'>
    readonly rating: FieldRef<"Review", 'Int'>
    readonly comment: FieldRef<"Review", 'String'>
    readonly patientId: FieldRef<"Review", 'String'>
    readonly doctorId: FieldRef<"Review", 'String'>
    readonly createdAt: FieldRef<"Review", 'DateTime'>
    readonly updatedAt: FieldRef<"Review", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Review findUnique
   */
  export type ReviewFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    /**
     * Filter, which Review to fetch.
     */
    where: ReviewWhereUniqueInput
  }

  /**
   * Review findUniqueOrThrow
   */
  export type ReviewFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    /**
     * Filter, which Review to fetch.
     */
    where: ReviewWhereUniqueInput
  }

  /**
   * Review findFirst
   */
  export type ReviewFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    /**
     * Filter, which Review to fetch.
     */
    where?: ReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Reviews to fetch.
     */
    orderBy?: ReviewOrderByWithRelationInput | ReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Reviews.
     */
    cursor?: ReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Reviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Reviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Reviews.
     */
    distinct?: ReviewScalarFieldEnum | ReviewScalarFieldEnum[]
  }

  /**
   * Review findFirstOrThrow
   */
  export type ReviewFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    /**
     * Filter, which Review to fetch.
     */
    where?: ReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Reviews to fetch.
     */
    orderBy?: ReviewOrderByWithRelationInput | ReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Reviews.
     */
    cursor?: ReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Reviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Reviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Reviews.
     */
    distinct?: ReviewScalarFieldEnum | ReviewScalarFieldEnum[]
  }

  /**
   * Review findMany
   */
  export type ReviewFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    /**
     * Filter, which Reviews to fetch.
     */
    where?: ReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Reviews to fetch.
     */
    orderBy?: ReviewOrderByWithRelationInput | ReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Reviews.
     */
    cursor?: ReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Reviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Reviews.
     */
    skip?: number
    distinct?: ReviewScalarFieldEnum | ReviewScalarFieldEnum[]
  }

  /**
   * Review create
   */
  export type ReviewCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    /**
     * The data needed to create a Review.
     */
    data: XOR<ReviewCreateInput, ReviewUncheckedCreateInput>
  }

  /**
   * Review createMany
   */
  export type ReviewCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Reviews.
     */
    data: ReviewCreateManyInput | ReviewCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Review createManyAndReturn
   */
  export type ReviewCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * The data used to create many Reviews.
     */
    data: ReviewCreateManyInput | ReviewCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Review update
   */
  export type ReviewUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    /**
     * The data needed to update a Review.
     */
    data: XOR<ReviewUpdateInput, ReviewUncheckedUpdateInput>
    /**
     * Choose, which Review to update.
     */
    where: ReviewWhereUniqueInput
  }

  /**
   * Review updateMany
   */
  export type ReviewUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Reviews.
     */
    data: XOR<ReviewUpdateManyMutationInput, ReviewUncheckedUpdateManyInput>
    /**
     * Filter which Reviews to update
     */
    where?: ReviewWhereInput
    /**
     * Limit how many Reviews to update.
     */
    limit?: number
  }

  /**
   * Review updateManyAndReturn
   */
  export type ReviewUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * The data used to update Reviews.
     */
    data: XOR<ReviewUpdateManyMutationInput, ReviewUncheckedUpdateManyInput>
    /**
     * Filter which Reviews to update
     */
    where?: ReviewWhereInput
    /**
     * Limit how many Reviews to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * Review upsert
   */
  export type ReviewUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    /**
     * The filter to search for the Review to update in case it exists.
     */
    where: ReviewWhereUniqueInput
    /**
     * In case the Review found by the `where` argument doesn't exist, create a new Review with this data.
     */
    create: XOR<ReviewCreateInput, ReviewUncheckedCreateInput>
    /**
     * In case the Review was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ReviewUpdateInput, ReviewUncheckedUpdateInput>
  }

  /**
   * Review delete
   */
  export type ReviewDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
    /**
     * Filter which Review to delete.
     */
    where: ReviewWhereUniqueInput
  }

  /**
   * Review deleteMany
   */
  export type ReviewDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Reviews to delete
     */
    where?: ReviewWhereInput
    /**
     * Limit how many Reviews to delete.
     */
    limit?: number
  }

  /**
   * Review without action
   */
  export type ReviewDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Review
     */
    select?: ReviewSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Review
     */
    omit?: ReviewOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReviewInclude<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const PatientScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    prakriti: 'prakriti',
    dosha: 'dosha',
    firstName: 'firstName',
    lastName: 'lastName',
    email: 'email',
    phone: 'phone',
    gender: 'gender',
    dateOfBirth: 'dateOfBirth',
    address: 'address',
    city: 'city',
    state: 'state',
    country: 'country',
    zipCode: 'zipCode',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type PatientScalarFieldEnum = (typeof PatientScalarFieldEnum)[keyof typeof PatientScalarFieldEnum]


  export const DoctorScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    firstName: 'firstName',
    lastName: 'lastName',
    email: 'email',
    phone: 'phone',
    specialization: 'specialization',
    experience: 'experience',
    qualification: 'qualification',
    consultationFee: 'consultationFee',
    rating: 'rating',
    isAvailable: 'isAvailable',
    workingHours: 'workingHours',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type DoctorScalarFieldEnum = (typeof DoctorScalarFieldEnum)[keyof typeof DoctorScalarFieldEnum]


  export const DoctorLocationScalarFieldEnum: {
    doctorId: 'doctorId',
    locationId: 'locationId',
    startTime: 'startTime',
    endTime: 'endTime'
  };

  export type DoctorLocationScalarFieldEnum = (typeof DoctorLocationScalarFieldEnum)[keyof typeof DoctorLocationScalarFieldEnum]


  export const LocationScalarFieldEnum: {
    id: 'id',
    name: 'name',
    address: 'address',
    city: 'city',
    state: 'state',
    country: 'country',
    zipCode: 'zipCode',
    phone: 'phone',
    email: 'email',
    isActive: 'isActive',
    isMainBranch: 'isMainBranch',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    latitude: 'latitude',
    longitude: 'longitude',
    timezone: 'timezone',
    workingHours: 'workingHours'
  };

  export type LocationScalarFieldEnum = (typeof LocationScalarFieldEnum)[keyof typeof LocationScalarFieldEnum]


  export const AppointmentScalarFieldEnum: {
    id: 'id',
    type: 'type',
    doctorId: 'doctorId',
    patientId: 'patientId',
    locationId: 'locationId',
    date: 'date',
    time: 'time',
    duration: 'duration',
    status: 'status',
    notes: 'notes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    therapyId: 'therapyId',
    startedAt: 'startedAt',
    checkedInAt: 'checkedInAt',
    completedAt: 'completedAt'
  };

  export type AppointmentScalarFieldEnum = (typeof AppointmentScalarFieldEnum)[keyof typeof AppointmentScalarFieldEnum]


  export const TherapyScalarFieldEnum: {
    id: 'id',
    name: 'name',
    description: 'description',
    duration: 'duration',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type TherapyScalarFieldEnum = (typeof TherapyScalarFieldEnum)[keyof typeof TherapyScalarFieldEnum]


  export const PaymentScalarFieldEnum: {
    id: 'id',
    appointmentId: 'appointmentId',
    amount: 'amount',
    status: 'status',
    method: 'method',
    transactionId: 'transactionId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type PaymentScalarFieldEnum = (typeof PaymentScalarFieldEnum)[keyof typeof PaymentScalarFieldEnum]


  export const QueueItemScalarFieldEnum: {
    id: 'id',
    appointmentId: 'appointmentId',
    queueNumber: 'queueNumber',
    estimatedWaitTime: 'estimatedWaitTime',
    status: 'status',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type QueueItemScalarFieldEnum = (typeof QueueItemScalarFieldEnum)[keyof typeof QueueItemScalarFieldEnum]


  export const PrescriptionScalarFieldEnum: {
    id: 'id',
    patientId: 'patientId',
    doctorId: 'doctorId',
    date: 'date',
    notes: 'notes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type PrescriptionScalarFieldEnum = (typeof PrescriptionScalarFieldEnum)[keyof typeof PrescriptionScalarFieldEnum]


  export const PrescriptionItemScalarFieldEnum: {
    id: 'id',
    prescriptionId: 'prescriptionId',
    medicineId: 'medicineId',
    dosage: 'dosage',
    frequency: 'frequency',
    duration: 'duration',
    instructions: 'instructions',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type PrescriptionItemScalarFieldEnum = (typeof PrescriptionItemScalarFieldEnum)[keyof typeof PrescriptionItemScalarFieldEnum]


  export const MedicineScalarFieldEnum: {
    id: 'id',
    name: 'name',
    description: 'description',
    ingredients: 'ingredients',
    dosage: 'dosage',
    manufacturer: 'manufacturer',
    price: 'price',
    stock: 'stock',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type MedicineScalarFieldEnum = (typeof MedicineScalarFieldEnum)[keyof typeof MedicineScalarFieldEnum]


  export const HealthRecordScalarFieldEnum: {
    id: 'id',
    patientId: 'patientId',
    doctorId: 'doctorId',
    recordType: 'recordType',
    report: 'report',
    fileUrl: 'fileUrl',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type HealthRecordScalarFieldEnum = (typeof HealthRecordScalarFieldEnum)[keyof typeof HealthRecordScalarFieldEnum]


  export const ReviewScalarFieldEnum: {
    id: 'id',
    rating: 'rating',
    comment: 'comment',
    patientId: 'patientId',
    doctorId: 'doctorId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type ReviewScalarFieldEnum = (typeof ReviewScalarFieldEnum)[keyof typeof ReviewScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const NullableJsonNullValueInput: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull
  };

  export type NullableJsonNullValueInput = (typeof NullableJsonNullValueInput)[keyof typeof NullableJsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  /**
   * Field references
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'Prakriti'
   */
  export type EnumPrakritiFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Prakriti'>
    


  /**
   * Reference to a field of type 'Prakriti[]'
   */
  export type ListEnumPrakritiFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Prakriti[]'>
    


  /**
   * Reference to a field of type 'Dosha'
   */
  export type EnumDoshaFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Dosha'>
    


  /**
   * Reference to a field of type 'Dosha[]'
   */
  export type ListEnumDoshaFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Dosha[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'QueryMode'
   */
  export type EnumQueryModeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'QueryMode'>
    


  /**
   * Reference to a field of type 'AppointmentType'
   */
  export type EnumAppointmentTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AppointmentType'>
    


  /**
   * Reference to a field of type 'AppointmentType[]'
   */
  export type ListEnumAppointmentTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AppointmentType[]'>
    


  /**
   * Reference to a field of type 'AppointmentStatus'
   */
  export type EnumAppointmentStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AppointmentStatus'>
    


  /**
   * Reference to a field of type 'AppointmentStatus[]'
   */
  export type ListEnumAppointmentStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AppointmentStatus[]'>
    


  /**
   * Reference to a field of type 'PaymentStatus'
   */
  export type EnumPaymentStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PaymentStatus'>
    


  /**
   * Reference to a field of type 'PaymentStatus[]'
   */
  export type ListEnumPaymentStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PaymentStatus[]'>
    


  /**
   * Reference to a field of type 'PaymentMethod'
   */
  export type EnumPaymentMethodFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PaymentMethod'>
    


  /**
   * Reference to a field of type 'PaymentMethod[]'
   */
  export type ListEnumPaymentMethodFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PaymentMethod[]'>
    


  /**
   * Reference to a field of type 'QueueStatus'
   */
  export type EnumQueueStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'QueueStatus'>
    


  /**
   * Reference to a field of type 'QueueStatus[]'
   */
  export type ListEnumQueueStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'QueueStatus[]'>
    


  /**
   * Reference to a field of type 'HealthRecordType'
   */
  export type EnumHealthRecordTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'HealthRecordType'>
    


  /**
   * Reference to a field of type 'HealthRecordType[]'
   */
  export type ListEnumHealthRecordTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'HealthRecordType[]'>
    
  /**
   * Deep Input Types
   */


  export type PatientWhereInput = {
    AND?: PatientWhereInput | PatientWhereInput[]
    OR?: PatientWhereInput[]
    NOT?: PatientWhereInput | PatientWhereInput[]
    id?: StringFilter<"Patient"> | string
    userId?: StringFilter<"Patient"> | string
    prakriti?: EnumPrakritiNullableFilter<"Patient"> | $Enums.Prakriti | null
    dosha?: EnumDoshaNullableFilter<"Patient"> | $Enums.Dosha | null
    firstName?: StringFilter<"Patient"> | string
    lastName?: StringFilter<"Patient"> | string
    email?: StringFilter<"Patient"> | string
    phone?: StringNullableFilter<"Patient"> | string | null
    gender?: StringNullableFilter<"Patient"> | string | null
    dateOfBirth?: DateTimeNullableFilter<"Patient"> | Date | string | null
    address?: StringNullableFilter<"Patient"> | string | null
    city?: StringNullableFilter<"Patient"> | string | null
    state?: StringNullableFilter<"Patient"> | string | null
    country?: StringNullableFilter<"Patient"> | string | null
    zipCode?: StringNullableFilter<"Patient"> | string | null
    createdAt?: DateTimeFilter<"Patient"> | Date | string
    updatedAt?: DateTimeFilter<"Patient"> | Date | string
    appointments?: AppointmentListRelationFilter
    healthRecords?: HealthRecordListRelationFilter
    prescriptions?: PrescriptionListRelationFilter
    reviews?: ReviewListRelationFilter
  }

  export type PatientOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    prakriti?: SortOrderInput | SortOrder
    dosha?: SortOrderInput | SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    email?: SortOrder
    phone?: SortOrderInput | SortOrder
    gender?: SortOrderInput | SortOrder
    dateOfBirth?: SortOrderInput | SortOrder
    address?: SortOrderInput | SortOrder
    city?: SortOrderInput | SortOrder
    state?: SortOrderInput | SortOrder
    country?: SortOrderInput | SortOrder
    zipCode?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    appointments?: AppointmentOrderByRelationAggregateInput
    healthRecords?: HealthRecordOrderByRelationAggregateInput
    prescriptions?: PrescriptionOrderByRelationAggregateInput
    reviews?: ReviewOrderByRelationAggregateInput
  }

  export type PatientWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    userId?: string
    email?: string
    AND?: PatientWhereInput | PatientWhereInput[]
    OR?: PatientWhereInput[]
    NOT?: PatientWhereInput | PatientWhereInput[]
    prakriti?: EnumPrakritiNullableFilter<"Patient"> | $Enums.Prakriti | null
    dosha?: EnumDoshaNullableFilter<"Patient"> | $Enums.Dosha | null
    firstName?: StringFilter<"Patient"> | string
    lastName?: StringFilter<"Patient"> | string
    phone?: StringNullableFilter<"Patient"> | string | null
    gender?: StringNullableFilter<"Patient"> | string | null
    dateOfBirth?: DateTimeNullableFilter<"Patient"> | Date | string | null
    address?: StringNullableFilter<"Patient"> | string | null
    city?: StringNullableFilter<"Patient"> | string | null
    state?: StringNullableFilter<"Patient"> | string | null
    country?: StringNullableFilter<"Patient"> | string | null
    zipCode?: StringNullableFilter<"Patient"> | string | null
    createdAt?: DateTimeFilter<"Patient"> | Date | string
    updatedAt?: DateTimeFilter<"Patient"> | Date | string
    appointments?: AppointmentListRelationFilter
    healthRecords?: HealthRecordListRelationFilter
    prescriptions?: PrescriptionListRelationFilter
    reviews?: ReviewListRelationFilter
  }, "id" | "userId" | "email">

  export type PatientOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    prakriti?: SortOrderInput | SortOrder
    dosha?: SortOrderInput | SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    email?: SortOrder
    phone?: SortOrderInput | SortOrder
    gender?: SortOrderInput | SortOrder
    dateOfBirth?: SortOrderInput | SortOrder
    address?: SortOrderInput | SortOrder
    city?: SortOrderInput | SortOrder
    state?: SortOrderInput | SortOrder
    country?: SortOrderInput | SortOrder
    zipCode?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: PatientCountOrderByAggregateInput
    _max?: PatientMaxOrderByAggregateInput
    _min?: PatientMinOrderByAggregateInput
  }

  export type PatientScalarWhereWithAggregatesInput = {
    AND?: PatientScalarWhereWithAggregatesInput | PatientScalarWhereWithAggregatesInput[]
    OR?: PatientScalarWhereWithAggregatesInput[]
    NOT?: PatientScalarWhereWithAggregatesInput | PatientScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Patient"> | string
    userId?: StringWithAggregatesFilter<"Patient"> | string
    prakriti?: EnumPrakritiNullableWithAggregatesFilter<"Patient"> | $Enums.Prakriti | null
    dosha?: EnumDoshaNullableWithAggregatesFilter<"Patient"> | $Enums.Dosha | null
    firstName?: StringWithAggregatesFilter<"Patient"> | string
    lastName?: StringWithAggregatesFilter<"Patient"> | string
    email?: StringWithAggregatesFilter<"Patient"> | string
    phone?: StringNullableWithAggregatesFilter<"Patient"> | string | null
    gender?: StringNullableWithAggregatesFilter<"Patient"> | string | null
    dateOfBirth?: DateTimeNullableWithAggregatesFilter<"Patient"> | Date | string | null
    address?: StringNullableWithAggregatesFilter<"Patient"> | string | null
    city?: StringNullableWithAggregatesFilter<"Patient"> | string | null
    state?: StringNullableWithAggregatesFilter<"Patient"> | string | null
    country?: StringNullableWithAggregatesFilter<"Patient"> | string | null
    zipCode?: StringNullableWithAggregatesFilter<"Patient"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Patient"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Patient"> | Date | string
  }

  export type DoctorWhereInput = {
    AND?: DoctorWhereInput | DoctorWhereInput[]
    OR?: DoctorWhereInput[]
    NOT?: DoctorWhereInput | DoctorWhereInput[]
    id?: StringFilter<"Doctor"> | string
    userId?: StringFilter<"Doctor"> | string
    firstName?: StringFilter<"Doctor"> | string
    lastName?: StringFilter<"Doctor"> | string
    email?: StringFilter<"Doctor"> | string
    phone?: StringNullableFilter<"Doctor"> | string | null
    specialization?: StringFilter<"Doctor"> | string
    experience?: IntFilter<"Doctor"> | number
    qualification?: StringNullableFilter<"Doctor"> | string | null
    consultationFee?: FloatNullableFilter<"Doctor"> | number | null
    rating?: FloatNullableFilter<"Doctor"> | number | null
    isAvailable?: BoolFilter<"Doctor"> | boolean
    workingHours?: JsonNullableFilter<"Doctor">
    createdAt?: DateTimeFilter<"Doctor"> | Date | string
    updatedAt?: DateTimeFilter<"Doctor"> | Date | string
    appointments?: AppointmentListRelationFilter
    healthRecords?: HealthRecordListRelationFilter
    prescriptions?: PrescriptionListRelationFilter
    reviews?: ReviewListRelationFilter
    locations?: DoctorLocationListRelationFilter
  }

  export type DoctorOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    email?: SortOrder
    phone?: SortOrderInput | SortOrder
    specialization?: SortOrder
    experience?: SortOrder
    qualification?: SortOrderInput | SortOrder
    consultationFee?: SortOrderInput | SortOrder
    rating?: SortOrderInput | SortOrder
    isAvailable?: SortOrder
    workingHours?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    appointments?: AppointmentOrderByRelationAggregateInput
    healthRecords?: HealthRecordOrderByRelationAggregateInput
    prescriptions?: PrescriptionOrderByRelationAggregateInput
    reviews?: ReviewOrderByRelationAggregateInput
    locations?: DoctorLocationOrderByRelationAggregateInput
  }

  export type DoctorWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    userId?: string
    email?: string
    AND?: DoctorWhereInput | DoctorWhereInput[]
    OR?: DoctorWhereInput[]
    NOT?: DoctorWhereInput | DoctorWhereInput[]
    firstName?: StringFilter<"Doctor"> | string
    lastName?: StringFilter<"Doctor"> | string
    phone?: StringNullableFilter<"Doctor"> | string | null
    specialization?: StringFilter<"Doctor"> | string
    experience?: IntFilter<"Doctor"> | number
    qualification?: StringNullableFilter<"Doctor"> | string | null
    consultationFee?: FloatNullableFilter<"Doctor"> | number | null
    rating?: FloatNullableFilter<"Doctor"> | number | null
    isAvailable?: BoolFilter<"Doctor"> | boolean
    workingHours?: JsonNullableFilter<"Doctor">
    createdAt?: DateTimeFilter<"Doctor"> | Date | string
    updatedAt?: DateTimeFilter<"Doctor"> | Date | string
    appointments?: AppointmentListRelationFilter
    healthRecords?: HealthRecordListRelationFilter
    prescriptions?: PrescriptionListRelationFilter
    reviews?: ReviewListRelationFilter
    locations?: DoctorLocationListRelationFilter
  }, "id" | "userId" | "email">

  export type DoctorOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    email?: SortOrder
    phone?: SortOrderInput | SortOrder
    specialization?: SortOrder
    experience?: SortOrder
    qualification?: SortOrderInput | SortOrder
    consultationFee?: SortOrderInput | SortOrder
    rating?: SortOrderInput | SortOrder
    isAvailable?: SortOrder
    workingHours?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: DoctorCountOrderByAggregateInput
    _avg?: DoctorAvgOrderByAggregateInput
    _max?: DoctorMaxOrderByAggregateInput
    _min?: DoctorMinOrderByAggregateInput
    _sum?: DoctorSumOrderByAggregateInput
  }

  export type DoctorScalarWhereWithAggregatesInput = {
    AND?: DoctorScalarWhereWithAggregatesInput | DoctorScalarWhereWithAggregatesInput[]
    OR?: DoctorScalarWhereWithAggregatesInput[]
    NOT?: DoctorScalarWhereWithAggregatesInput | DoctorScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Doctor"> | string
    userId?: StringWithAggregatesFilter<"Doctor"> | string
    firstName?: StringWithAggregatesFilter<"Doctor"> | string
    lastName?: StringWithAggregatesFilter<"Doctor"> | string
    email?: StringWithAggregatesFilter<"Doctor"> | string
    phone?: StringNullableWithAggregatesFilter<"Doctor"> | string | null
    specialization?: StringWithAggregatesFilter<"Doctor"> | string
    experience?: IntWithAggregatesFilter<"Doctor"> | number
    qualification?: StringNullableWithAggregatesFilter<"Doctor"> | string | null
    consultationFee?: FloatNullableWithAggregatesFilter<"Doctor"> | number | null
    rating?: FloatNullableWithAggregatesFilter<"Doctor"> | number | null
    isAvailable?: BoolWithAggregatesFilter<"Doctor"> | boolean
    workingHours?: JsonNullableWithAggregatesFilter<"Doctor">
    createdAt?: DateTimeWithAggregatesFilter<"Doctor"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Doctor"> | Date | string
  }

  export type DoctorLocationWhereInput = {
    AND?: DoctorLocationWhereInput | DoctorLocationWhereInput[]
    OR?: DoctorLocationWhereInput[]
    NOT?: DoctorLocationWhereInput | DoctorLocationWhereInput[]
    doctorId?: StringFilter<"DoctorLocation"> | string
    locationId?: StringFilter<"DoctorLocation"> | string
    startTime?: DateTimeNullableFilter<"DoctorLocation"> | Date | string | null
    endTime?: DateTimeNullableFilter<"DoctorLocation"> | Date | string | null
    doctor?: XOR<DoctorScalarRelationFilter, DoctorWhereInput>
    location?: XOR<LocationScalarRelationFilter, LocationWhereInput>
  }

  export type DoctorLocationOrderByWithRelationInput = {
    doctorId?: SortOrder
    locationId?: SortOrder
    startTime?: SortOrderInput | SortOrder
    endTime?: SortOrderInput | SortOrder
    doctor?: DoctorOrderByWithRelationInput
    location?: LocationOrderByWithRelationInput
  }

  export type DoctorLocationWhereUniqueInput = Prisma.AtLeast<{
    doctorId_locationId?: DoctorLocationDoctorIdLocationIdCompoundUniqueInput
    AND?: DoctorLocationWhereInput | DoctorLocationWhereInput[]
    OR?: DoctorLocationWhereInput[]
    NOT?: DoctorLocationWhereInput | DoctorLocationWhereInput[]
    doctorId?: StringFilter<"DoctorLocation"> | string
    locationId?: StringFilter<"DoctorLocation"> | string
    startTime?: DateTimeNullableFilter<"DoctorLocation"> | Date | string | null
    endTime?: DateTimeNullableFilter<"DoctorLocation"> | Date | string | null
    doctor?: XOR<DoctorScalarRelationFilter, DoctorWhereInput>
    location?: XOR<LocationScalarRelationFilter, LocationWhereInput>
  }, "doctorId_locationId">

  export type DoctorLocationOrderByWithAggregationInput = {
    doctorId?: SortOrder
    locationId?: SortOrder
    startTime?: SortOrderInput | SortOrder
    endTime?: SortOrderInput | SortOrder
    _count?: DoctorLocationCountOrderByAggregateInput
    _max?: DoctorLocationMaxOrderByAggregateInput
    _min?: DoctorLocationMinOrderByAggregateInput
  }

  export type DoctorLocationScalarWhereWithAggregatesInput = {
    AND?: DoctorLocationScalarWhereWithAggregatesInput | DoctorLocationScalarWhereWithAggregatesInput[]
    OR?: DoctorLocationScalarWhereWithAggregatesInput[]
    NOT?: DoctorLocationScalarWhereWithAggregatesInput | DoctorLocationScalarWhereWithAggregatesInput[]
    doctorId?: StringWithAggregatesFilter<"DoctorLocation"> | string
    locationId?: StringWithAggregatesFilter<"DoctorLocation"> | string
    startTime?: DateTimeNullableWithAggregatesFilter<"DoctorLocation"> | Date | string | null
    endTime?: DateTimeNullableWithAggregatesFilter<"DoctorLocation"> | Date | string | null
  }

  export type LocationWhereInput = {
    AND?: LocationWhereInput | LocationWhereInput[]
    OR?: LocationWhereInput[]
    NOT?: LocationWhereInput | LocationWhereInput[]
    id?: StringFilter<"Location"> | string
    name?: StringFilter<"Location"> | string
    address?: StringFilter<"Location"> | string
    city?: StringFilter<"Location"> | string
    state?: StringFilter<"Location"> | string
    country?: StringFilter<"Location"> | string
    zipCode?: StringFilter<"Location"> | string
    phone?: StringNullableFilter<"Location"> | string | null
    email?: StringNullableFilter<"Location"> | string | null
    isActive?: BoolFilter<"Location"> | boolean
    isMainBranch?: BoolFilter<"Location"> | boolean
    createdAt?: DateTimeFilter<"Location"> | Date | string
    updatedAt?: DateTimeFilter<"Location"> | Date | string
    latitude?: FloatNullableFilter<"Location"> | number | null
    longitude?: FloatNullableFilter<"Location"> | number | null
    timezone?: StringFilter<"Location"> | string
    workingHours?: JsonNullableFilter<"Location">
    appointments?: AppointmentListRelationFilter
    doctors?: DoctorLocationListRelationFilter
  }

  export type LocationOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    address?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    phone?: SortOrderInput | SortOrder
    email?: SortOrderInput | SortOrder
    isActive?: SortOrder
    isMainBranch?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    latitude?: SortOrderInput | SortOrder
    longitude?: SortOrderInput | SortOrder
    timezone?: SortOrder
    workingHours?: SortOrderInput | SortOrder
    appointments?: AppointmentOrderByRelationAggregateInput
    doctors?: DoctorLocationOrderByRelationAggregateInput
  }

  export type LocationWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: LocationWhereInput | LocationWhereInput[]
    OR?: LocationWhereInput[]
    NOT?: LocationWhereInput | LocationWhereInput[]
    name?: StringFilter<"Location"> | string
    address?: StringFilter<"Location"> | string
    city?: StringFilter<"Location"> | string
    state?: StringFilter<"Location"> | string
    country?: StringFilter<"Location"> | string
    zipCode?: StringFilter<"Location"> | string
    phone?: StringNullableFilter<"Location"> | string | null
    email?: StringNullableFilter<"Location"> | string | null
    isActive?: BoolFilter<"Location"> | boolean
    isMainBranch?: BoolFilter<"Location"> | boolean
    createdAt?: DateTimeFilter<"Location"> | Date | string
    updatedAt?: DateTimeFilter<"Location"> | Date | string
    latitude?: FloatNullableFilter<"Location"> | number | null
    longitude?: FloatNullableFilter<"Location"> | number | null
    timezone?: StringFilter<"Location"> | string
    workingHours?: JsonNullableFilter<"Location">
    appointments?: AppointmentListRelationFilter
    doctors?: DoctorLocationListRelationFilter
  }, "id">

  export type LocationOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    address?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    phone?: SortOrderInput | SortOrder
    email?: SortOrderInput | SortOrder
    isActive?: SortOrder
    isMainBranch?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    latitude?: SortOrderInput | SortOrder
    longitude?: SortOrderInput | SortOrder
    timezone?: SortOrder
    workingHours?: SortOrderInput | SortOrder
    _count?: LocationCountOrderByAggregateInput
    _avg?: LocationAvgOrderByAggregateInput
    _max?: LocationMaxOrderByAggregateInput
    _min?: LocationMinOrderByAggregateInput
    _sum?: LocationSumOrderByAggregateInput
  }

  export type LocationScalarWhereWithAggregatesInput = {
    AND?: LocationScalarWhereWithAggregatesInput | LocationScalarWhereWithAggregatesInput[]
    OR?: LocationScalarWhereWithAggregatesInput[]
    NOT?: LocationScalarWhereWithAggregatesInput | LocationScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Location"> | string
    name?: StringWithAggregatesFilter<"Location"> | string
    address?: StringWithAggregatesFilter<"Location"> | string
    city?: StringWithAggregatesFilter<"Location"> | string
    state?: StringWithAggregatesFilter<"Location"> | string
    country?: StringWithAggregatesFilter<"Location"> | string
    zipCode?: StringWithAggregatesFilter<"Location"> | string
    phone?: StringNullableWithAggregatesFilter<"Location"> | string | null
    email?: StringNullableWithAggregatesFilter<"Location"> | string | null
    isActive?: BoolWithAggregatesFilter<"Location"> | boolean
    isMainBranch?: BoolWithAggregatesFilter<"Location"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"Location"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Location"> | Date | string
    latitude?: FloatNullableWithAggregatesFilter<"Location"> | number | null
    longitude?: FloatNullableWithAggregatesFilter<"Location"> | number | null
    timezone?: StringWithAggregatesFilter<"Location"> | string
    workingHours?: JsonNullableWithAggregatesFilter<"Location">
  }

  export type AppointmentWhereInput = {
    AND?: AppointmentWhereInput | AppointmentWhereInput[]
    OR?: AppointmentWhereInput[]
    NOT?: AppointmentWhereInput | AppointmentWhereInput[]
    id?: StringFilter<"Appointment"> | string
    type?: EnumAppointmentTypeFilter<"Appointment"> | $Enums.AppointmentType
    doctorId?: StringFilter<"Appointment"> | string
    patientId?: StringFilter<"Appointment"> | string
    locationId?: StringFilter<"Appointment"> | string
    date?: DateTimeFilter<"Appointment"> | Date | string
    time?: StringFilter<"Appointment"> | string
    duration?: IntFilter<"Appointment"> | number
    status?: EnumAppointmentStatusFilter<"Appointment"> | $Enums.AppointmentStatus
    notes?: StringNullableFilter<"Appointment"> | string | null
    createdAt?: DateTimeFilter<"Appointment"> | Date | string
    updatedAt?: DateTimeFilter<"Appointment"> | Date | string
    therapyId?: StringNullableFilter<"Appointment"> | string | null
    startedAt?: DateTimeNullableFilter<"Appointment"> | Date | string | null
    checkedInAt?: DateTimeNullableFilter<"Appointment"> | Date | string | null
    completedAt?: DateTimeNullableFilter<"Appointment"> | Date | string | null
    doctor?: XOR<DoctorScalarRelationFilter, DoctorWhereInput>
    patient?: XOR<PatientScalarRelationFilter, PatientWhereInput>
    location?: XOR<LocationScalarRelationFilter, LocationWhereInput>
    therapy?: XOR<TherapyNullableScalarRelationFilter, TherapyWhereInput> | null
    payment?: XOR<PaymentNullableScalarRelationFilter, PaymentWhereInput> | null
    queueItem?: XOR<QueueItemNullableScalarRelationFilter, QueueItemWhereInput> | null
  }

  export type AppointmentOrderByWithRelationInput = {
    id?: SortOrder
    type?: SortOrder
    doctorId?: SortOrder
    patientId?: SortOrder
    locationId?: SortOrder
    date?: SortOrder
    time?: SortOrder
    duration?: SortOrder
    status?: SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    therapyId?: SortOrderInput | SortOrder
    startedAt?: SortOrderInput | SortOrder
    checkedInAt?: SortOrderInput | SortOrder
    completedAt?: SortOrderInput | SortOrder
    doctor?: DoctorOrderByWithRelationInput
    patient?: PatientOrderByWithRelationInput
    location?: LocationOrderByWithRelationInput
    therapy?: TherapyOrderByWithRelationInput
    payment?: PaymentOrderByWithRelationInput
    queueItem?: QueueItemOrderByWithRelationInput
  }

  export type AppointmentWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: AppointmentWhereInput | AppointmentWhereInput[]
    OR?: AppointmentWhereInput[]
    NOT?: AppointmentWhereInput | AppointmentWhereInput[]
    type?: EnumAppointmentTypeFilter<"Appointment"> | $Enums.AppointmentType
    doctorId?: StringFilter<"Appointment"> | string
    patientId?: StringFilter<"Appointment"> | string
    locationId?: StringFilter<"Appointment"> | string
    date?: DateTimeFilter<"Appointment"> | Date | string
    time?: StringFilter<"Appointment"> | string
    duration?: IntFilter<"Appointment"> | number
    status?: EnumAppointmentStatusFilter<"Appointment"> | $Enums.AppointmentStatus
    notes?: StringNullableFilter<"Appointment"> | string | null
    createdAt?: DateTimeFilter<"Appointment"> | Date | string
    updatedAt?: DateTimeFilter<"Appointment"> | Date | string
    therapyId?: StringNullableFilter<"Appointment"> | string | null
    startedAt?: DateTimeNullableFilter<"Appointment"> | Date | string | null
    checkedInAt?: DateTimeNullableFilter<"Appointment"> | Date | string | null
    completedAt?: DateTimeNullableFilter<"Appointment"> | Date | string | null
    doctor?: XOR<DoctorScalarRelationFilter, DoctorWhereInput>
    patient?: XOR<PatientScalarRelationFilter, PatientWhereInput>
    location?: XOR<LocationScalarRelationFilter, LocationWhereInput>
    therapy?: XOR<TherapyNullableScalarRelationFilter, TherapyWhereInput> | null
    payment?: XOR<PaymentNullableScalarRelationFilter, PaymentWhereInput> | null
    queueItem?: XOR<QueueItemNullableScalarRelationFilter, QueueItemWhereInput> | null
  }, "id">

  export type AppointmentOrderByWithAggregationInput = {
    id?: SortOrder
    type?: SortOrder
    doctorId?: SortOrder
    patientId?: SortOrder
    locationId?: SortOrder
    date?: SortOrder
    time?: SortOrder
    duration?: SortOrder
    status?: SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    therapyId?: SortOrderInput | SortOrder
    startedAt?: SortOrderInput | SortOrder
    checkedInAt?: SortOrderInput | SortOrder
    completedAt?: SortOrderInput | SortOrder
    _count?: AppointmentCountOrderByAggregateInput
    _avg?: AppointmentAvgOrderByAggregateInput
    _max?: AppointmentMaxOrderByAggregateInput
    _min?: AppointmentMinOrderByAggregateInput
    _sum?: AppointmentSumOrderByAggregateInput
  }

  export type AppointmentScalarWhereWithAggregatesInput = {
    AND?: AppointmentScalarWhereWithAggregatesInput | AppointmentScalarWhereWithAggregatesInput[]
    OR?: AppointmentScalarWhereWithAggregatesInput[]
    NOT?: AppointmentScalarWhereWithAggregatesInput | AppointmentScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Appointment"> | string
    type?: EnumAppointmentTypeWithAggregatesFilter<"Appointment"> | $Enums.AppointmentType
    doctorId?: StringWithAggregatesFilter<"Appointment"> | string
    patientId?: StringWithAggregatesFilter<"Appointment"> | string
    locationId?: StringWithAggregatesFilter<"Appointment"> | string
    date?: DateTimeWithAggregatesFilter<"Appointment"> | Date | string
    time?: StringWithAggregatesFilter<"Appointment"> | string
    duration?: IntWithAggregatesFilter<"Appointment"> | number
    status?: EnumAppointmentStatusWithAggregatesFilter<"Appointment"> | $Enums.AppointmentStatus
    notes?: StringNullableWithAggregatesFilter<"Appointment"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Appointment"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Appointment"> | Date | string
    therapyId?: StringNullableWithAggregatesFilter<"Appointment"> | string | null
    startedAt?: DateTimeNullableWithAggregatesFilter<"Appointment"> | Date | string | null
    checkedInAt?: DateTimeNullableWithAggregatesFilter<"Appointment"> | Date | string | null
    completedAt?: DateTimeNullableWithAggregatesFilter<"Appointment"> | Date | string | null
  }

  export type TherapyWhereInput = {
    AND?: TherapyWhereInput | TherapyWhereInput[]
    OR?: TherapyWhereInput[]
    NOT?: TherapyWhereInput | TherapyWhereInput[]
    id?: StringFilter<"Therapy"> | string
    name?: StringFilter<"Therapy"> | string
    description?: StringNullableFilter<"Therapy"> | string | null
    duration?: IntNullableFilter<"Therapy"> | number | null
    createdAt?: DateTimeFilter<"Therapy"> | Date | string
    updatedAt?: DateTimeFilter<"Therapy"> | Date | string
    appointments?: AppointmentListRelationFilter
  }

  export type TherapyOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    appointments?: AppointmentOrderByRelationAggregateInput
  }

  export type TherapyWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: TherapyWhereInput | TherapyWhereInput[]
    OR?: TherapyWhereInput[]
    NOT?: TherapyWhereInput | TherapyWhereInput[]
    name?: StringFilter<"Therapy"> | string
    description?: StringNullableFilter<"Therapy"> | string | null
    duration?: IntNullableFilter<"Therapy"> | number | null
    createdAt?: DateTimeFilter<"Therapy"> | Date | string
    updatedAt?: DateTimeFilter<"Therapy"> | Date | string
    appointments?: AppointmentListRelationFilter
  }, "id">

  export type TherapyOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: TherapyCountOrderByAggregateInput
    _avg?: TherapyAvgOrderByAggregateInput
    _max?: TherapyMaxOrderByAggregateInput
    _min?: TherapyMinOrderByAggregateInput
    _sum?: TherapySumOrderByAggregateInput
  }

  export type TherapyScalarWhereWithAggregatesInput = {
    AND?: TherapyScalarWhereWithAggregatesInput | TherapyScalarWhereWithAggregatesInput[]
    OR?: TherapyScalarWhereWithAggregatesInput[]
    NOT?: TherapyScalarWhereWithAggregatesInput | TherapyScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Therapy"> | string
    name?: StringWithAggregatesFilter<"Therapy"> | string
    description?: StringNullableWithAggregatesFilter<"Therapy"> | string | null
    duration?: IntNullableWithAggregatesFilter<"Therapy"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"Therapy"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Therapy"> | Date | string
  }

  export type PaymentWhereInput = {
    AND?: PaymentWhereInput | PaymentWhereInput[]
    OR?: PaymentWhereInput[]
    NOT?: PaymentWhereInput | PaymentWhereInput[]
    id?: StringFilter<"Payment"> | string
    appointmentId?: StringFilter<"Payment"> | string
    amount?: FloatFilter<"Payment"> | number
    status?: EnumPaymentStatusFilter<"Payment"> | $Enums.PaymentStatus
    method?: EnumPaymentMethodNullableFilter<"Payment"> | $Enums.PaymentMethod | null
    transactionId?: StringNullableFilter<"Payment"> | string | null
    createdAt?: DateTimeFilter<"Payment"> | Date | string
    updatedAt?: DateTimeFilter<"Payment"> | Date | string
    appointment?: XOR<AppointmentScalarRelationFilter, AppointmentWhereInput>
  }

  export type PaymentOrderByWithRelationInput = {
    id?: SortOrder
    appointmentId?: SortOrder
    amount?: SortOrder
    status?: SortOrder
    method?: SortOrderInput | SortOrder
    transactionId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    appointment?: AppointmentOrderByWithRelationInput
  }

  export type PaymentWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    appointmentId?: string
    AND?: PaymentWhereInput | PaymentWhereInput[]
    OR?: PaymentWhereInput[]
    NOT?: PaymentWhereInput | PaymentWhereInput[]
    amount?: FloatFilter<"Payment"> | number
    status?: EnumPaymentStatusFilter<"Payment"> | $Enums.PaymentStatus
    method?: EnumPaymentMethodNullableFilter<"Payment"> | $Enums.PaymentMethod | null
    transactionId?: StringNullableFilter<"Payment"> | string | null
    createdAt?: DateTimeFilter<"Payment"> | Date | string
    updatedAt?: DateTimeFilter<"Payment"> | Date | string
    appointment?: XOR<AppointmentScalarRelationFilter, AppointmentWhereInput>
  }, "id" | "appointmentId">

  export type PaymentOrderByWithAggregationInput = {
    id?: SortOrder
    appointmentId?: SortOrder
    amount?: SortOrder
    status?: SortOrder
    method?: SortOrderInput | SortOrder
    transactionId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: PaymentCountOrderByAggregateInput
    _avg?: PaymentAvgOrderByAggregateInput
    _max?: PaymentMaxOrderByAggregateInput
    _min?: PaymentMinOrderByAggregateInput
    _sum?: PaymentSumOrderByAggregateInput
  }

  export type PaymentScalarWhereWithAggregatesInput = {
    AND?: PaymentScalarWhereWithAggregatesInput | PaymentScalarWhereWithAggregatesInput[]
    OR?: PaymentScalarWhereWithAggregatesInput[]
    NOT?: PaymentScalarWhereWithAggregatesInput | PaymentScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Payment"> | string
    appointmentId?: StringWithAggregatesFilter<"Payment"> | string
    amount?: FloatWithAggregatesFilter<"Payment"> | number
    status?: EnumPaymentStatusWithAggregatesFilter<"Payment"> | $Enums.PaymentStatus
    method?: EnumPaymentMethodNullableWithAggregatesFilter<"Payment"> | $Enums.PaymentMethod | null
    transactionId?: StringNullableWithAggregatesFilter<"Payment"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Payment"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Payment"> | Date | string
  }

  export type QueueItemWhereInput = {
    AND?: QueueItemWhereInput | QueueItemWhereInput[]
    OR?: QueueItemWhereInput[]
    NOT?: QueueItemWhereInput | QueueItemWhereInput[]
    id?: StringFilter<"QueueItem"> | string
    appointmentId?: StringFilter<"QueueItem"> | string
    queueNumber?: IntFilter<"QueueItem"> | number
    estimatedWaitTime?: IntNullableFilter<"QueueItem"> | number | null
    status?: EnumQueueStatusFilter<"QueueItem"> | $Enums.QueueStatus
    createdAt?: DateTimeFilter<"QueueItem"> | Date | string
    updatedAt?: DateTimeFilter<"QueueItem"> | Date | string
    appointment?: XOR<AppointmentScalarRelationFilter, AppointmentWhereInput>
  }

  export type QueueItemOrderByWithRelationInput = {
    id?: SortOrder
    appointmentId?: SortOrder
    queueNumber?: SortOrder
    estimatedWaitTime?: SortOrderInput | SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    appointment?: AppointmentOrderByWithRelationInput
  }

  export type QueueItemWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    appointmentId?: string
    AND?: QueueItemWhereInput | QueueItemWhereInput[]
    OR?: QueueItemWhereInput[]
    NOT?: QueueItemWhereInput | QueueItemWhereInput[]
    queueNumber?: IntFilter<"QueueItem"> | number
    estimatedWaitTime?: IntNullableFilter<"QueueItem"> | number | null
    status?: EnumQueueStatusFilter<"QueueItem"> | $Enums.QueueStatus
    createdAt?: DateTimeFilter<"QueueItem"> | Date | string
    updatedAt?: DateTimeFilter<"QueueItem"> | Date | string
    appointment?: XOR<AppointmentScalarRelationFilter, AppointmentWhereInput>
  }, "id" | "appointmentId">

  export type QueueItemOrderByWithAggregationInput = {
    id?: SortOrder
    appointmentId?: SortOrder
    queueNumber?: SortOrder
    estimatedWaitTime?: SortOrderInput | SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: QueueItemCountOrderByAggregateInput
    _avg?: QueueItemAvgOrderByAggregateInput
    _max?: QueueItemMaxOrderByAggregateInput
    _min?: QueueItemMinOrderByAggregateInput
    _sum?: QueueItemSumOrderByAggregateInput
  }

  export type QueueItemScalarWhereWithAggregatesInput = {
    AND?: QueueItemScalarWhereWithAggregatesInput | QueueItemScalarWhereWithAggregatesInput[]
    OR?: QueueItemScalarWhereWithAggregatesInput[]
    NOT?: QueueItemScalarWhereWithAggregatesInput | QueueItemScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"QueueItem"> | string
    appointmentId?: StringWithAggregatesFilter<"QueueItem"> | string
    queueNumber?: IntWithAggregatesFilter<"QueueItem"> | number
    estimatedWaitTime?: IntNullableWithAggregatesFilter<"QueueItem"> | number | null
    status?: EnumQueueStatusWithAggregatesFilter<"QueueItem"> | $Enums.QueueStatus
    createdAt?: DateTimeWithAggregatesFilter<"QueueItem"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"QueueItem"> | Date | string
  }

  export type PrescriptionWhereInput = {
    AND?: PrescriptionWhereInput | PrescriptionWhereInput[]
    OR?: PrescriptionWhereInput[]
    NOT?: PrescriptionWhereInput | PrescriptionWhereInput[]
    id?: StringFilter<"Prescription"> | string
    patientId?: StringFilter<"Prescription"> | string
    doctorId?: StringFilter<"Prescription"> | string
    date?: DateTimeFilter<"Prescription"> | Date | string
    notes?: StringNullableFilter<"Prescription"> | string | null
    createdAt?: DateTimeFilter<"Prescription"> | Date | string
    updatedAt?: DateTimeFilter<"Prescription"> | Date | string
    doctor?: XOR<DoctorScalarRelationFilter, DoctorWhereInput>
    patient?: XOR<PatientScalarRelationFilter, PatientWhereInput>
    items?: PrescriptionItemListRelationFilter
  }

  export type PrescriptionOrderByWithRelationInput = {
    id?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    date?: SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    doctor?: DoctorOrderByWithRelationInput
    patient?: PatientOrderByWithRelationInput
    items?: PrescriptionItemOrderByRelationAggregateInput
  }

  export type PrescriptionWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: PrescriptionWhereInput | PrescriptionWhereInput[]
    OR?: PrescriptionWhereInput[]
    NOT?: PrescriptionWhereInput | PrescriptionWhereInput[]
    patientId?: StringFilter<"Prescription"> | string
    doctorId?: StringFilter<"Prescription"> | string
    date?: DateTimeFilter<"Prescription"> | Date | string
    notes?: StringNullableFilter<"Prescription"> | string | null
    createdAt?: DateTimeFilter<"Prescription"> | Date | string
    updatedAt?: DateTimeFilter<"Prescription"> | Date | string
    doctor?: XOR<DoctorScalarRelationFilter, DoctorWhereInput>
    patient?: XOR<PatientScalarRelationFilter, PatientWhereInput>
    items?: PrescriptionItemListRelationFilter
  }, "id">

  export type PrescriptionOrderByWithAggregationInput = {
    id?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    date?: SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: PrescriptionCountOrderByAggregateInput
    _max?: PrescriptionMaxOrderByAggregateInput
    _min?: PrescriptionMinOrderByAggregateInput
  }

  export type PrescriptionScalarWhereWithAggregatesInput = {
    AND?: PrescriptionScalarWhereWithAggregatesInput | PrescriptionScalarWhereWithAggregatesInput[]
    OR?: PrescriptionScalarWhereWithAggregatesInput[]
    NOT?: PrescriptionScalarWhereWithAggregatesInput | PrescriptionScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Prescription"> | string
    patientId?: StringWithAggregatesFilter<"Prescription"> | string
    doctorId?: StringWithAggregatesFilter<"Prescription"> | string
    date?: DateTimeWithAggregatesFilter<"Prescription"> | Date | string
    notes?: StringNullableWithAggregatesFilter<"Prescription"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Prescription"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Prescription"> | Date | string
  }

  export type PrescriptionItemWhereInput = {
    AND?: PrescriptionItemWhereInput | PrescriptionItemWhereInput[]
    OR?: PrescriptionItemWhereInput[]
    NOT?: PrescriptionItemWhereInput | PrescriptionItemWhereInput[]
    id?: StringFilter<"PrescriptionItem"> | string
    prescriptionId?: StringFilter<"PrescriptionItem"> | string
    medicineId?: StringFilter<"PrescriptionItem"> | string
    dosage?: StringNullableFilter<"PrescriptionItem"> | string | null
    frequency?: StringNullableFilter<"PrescriptionItem"> | string | null
    duration?: StringNullableFilter<"PrescriptionItem"> | string | null
    instructions?: StringNullableFilter<"PrescriptionItem"> | string | null
    createdAt?: DateTimeFilter<"PrescriptionItem"> | Date | string
    updatedAt?: DateTimeFilter<"PrescriptionItem"> | Date | string
    medicine?: XOR<MedicineScalarRelationFilter, MedicineWhereInput>
    prescription?: XOR<PrescriptionScalarRelationFilter, PrescriptionWhereInput>
  }

  export type PrescriptionItemOrderByWithRelationInput = {
    id?: SortOrder
    prescriptionId?: SortOrder
    medicineId?: SortOrder
    dosage?: SortOrderInput | SortOrder
    frequency?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    instructions?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    medicine?: MedicineOrderByWithRelationInput
    prescription?: PrescriptionOrderByWithRelationInput
  }

  export type PrescriptionItemWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: PrescriptionItemWhereInput | PrescriptionItemWhereInput[]
    OR?: PrescriptionItemWhereInput[]
    NOT?: PrescriptionItemWhereInput | PrescriptionItemWhereInput[]
    prescriptionId?: StringFilter<"PrescriptionItem"> | string
    medicineId?: StringFilter<"PrescriptionItem"> | string
    dosage?: StringNullableFilter<"PrescriptionItem"> | string | null
    frequency?: StringNullableFilter<"PrescriptionItem"> | string | null
    duration?: StringNullableFilter<"PrescriptionItem"> | string | null
    instructions?: StringNullableFilter<"PrescriptionItem"> | string | null
    createdAt?: DateTimeFilter<"PrescriptionItem"> | Date | string
    updatedAt?: DateTimeFilter<"PrescriptionItem"> | Date | string
    medicine?: XOR<MedicineScalarRelationFilter, MedicineWhereInput>
    prescription?: XOR<PrescriptionScalarRelationFilter, PrescriptionWhereInput>
  }, "id">

  export type PrescriptionItemOrderByWithAggregationInput = {
    id?: SortOrder
    prescriptionId?: SortOrder
    medicineId?: SortOrder
    dosage?: SortOrderInput | SortOrder
    frequency?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    instructions?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: PrescriptionItemCountOrderByAggregateInput
    _max?: PrescriptionItemMaxOrderByAggregateInput
    _min?: PrescriptionItemMinOrderByAggregateInput
  }

  export type PrescriptionItemScalarWhereWithAggregatesInput = {
    AND?: PrescriptionItemScalarWhereWithAggregatesInput | PrescriptionItemScalarWhereWithAggregatesInput[]
    OR?: PrescriptionItemScalarWhereWithAggregatesInput[]
    NOT?: PrescriptionItemScalarWhereWithAggregatesInput | PrescriptionItemScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PrescriptionItem"> | string
    prescriptionId?: StringWithAggregatesFilter<"PrescriptionItem"> | string
    medicineId?: StringWithAggregatesFilter<"PrescriptionItem"> | string
    dosage?: StringNullableWithAggregatesFilter<"PrescriptionItem"> | string | null
    frequency?: StringNullableWithAggregatesFilter<"PrescriptionItem"> | string | null
    duration?: StringNullableWithAggregatesFilter<"PrescriptionItem"> | string | null
    instructions?: StringNullableWithAggregatesFilter<"PrescriptionItem"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PrescriptionItem"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"PrescriptionItem"> | Date | string
  }

  export type MedicineWhereInput = {
    AND?: MedicineWhereInput | MedicineWhereInput[]
    OR?: MedicineWhereInput[]
    NOT?: MedicineWhereInput | MedicineWhereInput[]
    id?: StringFilter<"Medicine"> | string
    name?: StringFilter<"Medicine"> | string
    description?: StringNullableFilter<"Medicine"> | string | null
    ingredients?: StringNullableFilter<"Medicine"> | string | null
    dosage?: StringNullableFilter<"Medicine"> | string | null
    manufacturer?: StringNullableFilter<"Medicine"> | string | null
    price?: FloatNullableFilter<"Medicine"> | number | null
    stock?: IntFilter<"Medicine"> | number
    createdAt?: DateTimeFilter<"Medicine"> | Date | string
    updatedAt?: DateTimeFilter<"Medicine"> | Date | string
    prescriptionItems?: PrescriptionItemListRelationFilter
  }

  export type MedicineOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    ingredients?: SortOrderInput | SortOrder
    dosage?: SortOrderInput | SortOrder
    manufacturer?: SortOrderInput | SortOrder
    price?: SortOrderInput | SortOrder
    stock?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    prescriptionItems?: PrescriptionItemOrderByRelationAggregateInput
  }

  export type MedicineWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: MedicineWhereInput | MedicineWhereInput[]
    OR?: MedicineWhereInput[]
    NOT?: MedicineWhereInput | MedicineWhereInput[]
    name?: StringFilter<"Medicine"> | string
    description?: StringNullableFilter<"Medicine"> | string | null
    ingredients?: StringNullableFilter<"Medicine"> | string | null
    dosage?: StringNullableFilter<"Medicine"> | string | null
    manufacturer?: StringNullableFilter<"Medicine"> | string | null
    price?: FloatNullableFilter<"Medicine"> | number | null
    stock?: IntFilter<"Medicine"> | number
    createdAt?: DateTimeFilter<"Medicine"> | Date | string
    updatedAt?: DateTimeFilter<"Medicine"> | Date | string
    prescriptionItems?: PrescriptionItemListRelationFilter
  }, "id">

  export type MedicineOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    ingredients?: SortOrderInput | SortOrder
    dosage?: SortOrderInput | SortOrder
    manufacturer?: SortOrderInput | SortOrder
    price?: SortOrderInput | SortOrder
    stock?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: MedicineCountOrderByAggregateInput
    _avg?: MedicineAvgOrderByAggregateInput
    _max?: MedicineMaxOrderByAggregateInput
    _min?: MedicineMinOrderByAggregateInput
    _sum?: MedicineSumOrderByAggregateInput
  }

  export type MedicineScalarWhereWithAggregatesInput = {
    AND?: MedicineScalarWhereWithAggregatesInput | MedicineScalarWhereWithAggregatesInput[]
    OR?: MedicineScalarWhereWithAggregatesInput[]
    NOT?: MedicineScalarWhereWithAggregatesInput | MedicineScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Medicine"> | string
    name?: StringWithAggregatesFilter<"Medicine"> | string
    description?: StringNullableWithAggregatesFilter<"Medicine"> | string | null
    ingredients?: StringNullableWithAggregatesFilter<"Medicine"> | string | null
    dosage?: StringNullableWithAggregatesFilter<"Medicine"> | string | null
    manufacturer?: StringNullableWithAggregatesFilter<"Medicine"> | string | null
    price?: FloatNullableWithAggregatesFilter<"Medicine"> | number | null
    stock?: IntWithAggregatesFilter<"Medicine"> | number
    createdAt?: DateTimeWithAggregatesFilter<"Medicine"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Medicine"> | Date | string
  }

  export type HealthRecordWhereInput = {
    AND?: HealthRecordWhereInput | HealthRecordWhereInput[]
    OR?: HealthRecordWhereInput[]
    NOT?: HealthRecordWhereInput | HealthRecordWhereInput[]
    id?: StringFilter<"HealthRecord"> | string
    patientId?: StringFilter<"HealthRecord"> | string
    doctorId?: StringFilter<"HealthRecord"> | string
    recordType?: EnumHealthRecordTypeFilter<"HealthRecord"> | $Enums.HealthRecordType
    report?: StringNullableFilter<"HealthRecord"> | string | null
    fileUrl?: StringNullableFilter<"HealthRecord"> | string | null
    createdAt?: DateTimeFilter<"HealthRecord"> | Date | string
    updatedAt?: DateTimeFilter<"HealthRecord"> | Date | string
    doctor?: XOR<DoctorScalarRelationFilter, DoctorWhereInput>
    patient?: XOR<PatientScalarRelationFilter, PatientWhereInput>
  }

  export type HealthRecordOrderByWithRelationInput = {
    id?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    recordType?: SortOrder
    report?: SortOrderInput | SortOrder
    fileUrl?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    doctor?: DoctorOrderByWithRelationInput
    patient?: PatientOrderByWithRelationInput
  }

  export type HealthRecordWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: HealthRecordWhereInput | HealthRecordWhereInput[]
    OR?: HealthRecordWhereInput[]
    NOT?: HealthRecordWhereInput | HealthRecordWhereInput[]
    patientId?: StringFilter<"HealthRecord"> | string
    doctorId?: StringFilter<"HealthRecord"> | string
    recordType?: EnumHealthRecordTypeFilter<"HealthRecord"> | $Enums.HealthRecordType
    report?: StringNullableFilter<"HealthRecord"> | string | null
    fileUrl?: StringNullableFilter<"HealthRecord"> | string | null
    createdAt?: DateTimeFilter<"HealthRecord"> | Date | string
    updatedAt?: DateTimeFilter<"HealthRecord"> | Date | string
    doctor?: XOR<DoctorScalarRelationFilter, DoctorWhereInput>
    patient?: XOR<PatientScalarRelationFilter, PatientWhereInput>
  }, "id">

  export type HealthRecordOrderByWithAggregationInput = {
    id?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    recordType?: SortOrder
    report?: SortOrderInput | SortOrder
    fileUrl?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: HealthRecordCountOrderByAggregateInput
    _max?: HealthRecordMaxOrderByAggregateInput
    _min?: HealthRecordMinOrderByAggregateInput
  }

  export type HealthRecordScalarWhereWithAggregatesInput = {
    AND?: HealthRecordScalarWhereWithAggregatesInput | HealthRecordScalarWhereWithAggregatesInput[]
    OR?: HealthRecordScalarWhereWithAggregatesInput[]
    NOT?: HealthRecordScalarWhereWithAggregatesInput | HealthRecordScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"HealthRecord"> | string
    patientId?: StringWithAggregatesFilter<"HealthRecord"> | string
    doctorId?: StringWithAggregatesFilter<"HealthRecord"> | string
    recordType?: EnumHealthRecordTypeWithAggregatesFilter<"HealthRecord"> | $Enums.HealthRecordType
    report?: StringNullableWithAggregatesFilter<"HealthRecord"> | string | null
    fileUrl?: StringNullableWithAggregatesFilter<"HealthRecord"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"HealthRecord"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"HealthRecord"> | Date | string
  }

  export type ReviewWhereInput = {
    AND?: ReviewWhereInput | ReviewWhereInput[]
    OR?: ReviewWhereInput[]
    NOT?: ReviewWhereInput | ReviewWhereInput[]
    id?: StringFilter<"Review"> | string
    rating?: IntFilter<"Review"> | number
    comment?: StringNullableFilter<"Review"> | string | null
    patientId?: StringFilter<"Review"> | string
    doctorId?: StringFilter<"Review"> | string
    createdAt?: DateTimeFilter<"Review"> | Date | string
    updatedAt?: DateTimeFilter<"Review"> | Date | string
    doctor?: XOR<DoctorScalarRelationFilter, DoctorWhereInput>
    patient?: XOR<PatientScalarRelationFilter, PatientWhereInput>
  }

  export type ReviewOrderByWithRelationInput = {
    id?: SortOrder
    rating?: SortOrder
    comment?: SortOrderInput | SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    doctor?: DoctorOrderByWithRelationInput
    patient?: PatientOrderByWithRelationInput
  }

  export type ReviewWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: ReviewWhereInput | ReviewWhereInput[]
    OR?: ReviewWhereInput[]
    NOT?: ReviewWhereInput | ReviewWhereInput[]
    rating?: IntFilter<"Review"> | number
    comment?: StringNullableFilter<"Review"> | string | null
    patientId?: StringFilter<"Review"> | string
    doctorId?: StringFilter<"Review"> | string
    createdAt?: DateTimeFilter<"Review"> | Date | string
    updatedAt?: DateTimeFilter<"Review"> | Date | string
    doctor?: XOR<DoctorScalarRelationFilter, DoctorWhereInput>
    patient?: XOR<PatientScalarRelationFilter, PatientWhereInput>
  }, "id">

  export type ReviewOrderByWithAggregationInput = {
    id?: SortOrder
    rating?: SortOrder
    comment?: SortOrderInput | SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: ReviewCountOrderByAggregateInput
    _avg?: ReviewAvgOrderByAggregateInput
    _max?: ReviewMaxOrderByAggregateInput
    _min?: ReviewMinOrderByAggregateInput
    _sum?: ReviewSumOrderByAggregateInput
  }

  export type ReviewScalarWhereWithAggregatesInput = {
    AND?: ReviewScalarWhereWithAggregatesInput | ReviewScalarWhereWithAggregatesInput[]
    OR?: ReviewScalarWhereWithAggregatesInput[]
    NOT?: ReviewScalarWhereWithAggregatesInput | ReviewScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Review"> | string
    rating?: IntWithAggregatesFilter<"Review"> | number
    comment?: StringNullableWithAggregatesFilter<"Review"> | string | null
    patientId?: StringWithAggregatesFilter<"Review"> | string
    doctorId?: StringWithAggregatesFilter<"Review"> | string
    createdAt?: DateTimeWithAggregatesFilter<"Review"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Review"> | Date | string
  }

  export type PatientCreateInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentCreateNestedManyWithoutPatientInput
    healthRecords?: HealthRecordCreateNestedManyWithoutPatientInput
    prescriptions?: PrescriptionCreateNestedManyWithoutPatientInput
    reviews?: ReviewCreateNestedManyWithoutPatientInput
  }

  export type PatientUncheckedCreateInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentUncheckedCreateNestedManyWithoutPatientInput
    healthRecords?: HealthRecordUncheckedCreateNestedManyWithoutPatientInput
    prescriptions?: PrescriptionUncheckedCreateNestedManyWithoutPatientInput
    reviews?: ReviewUncheckedCreateNestedManyWithoutPatientInput
  }

  export type PatientUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUpdateManyWithoutPatientNestedInput
    healthRecords?: HealthRecordUpdateManyWithoutPatientNestedInput
    prescriptions?: PrescriptionUpdateManyWithoutPatientNestedInput
    reviews?: ReviewUpdateManyWithoutPatientNestedInput
  }

  export type PatientUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUncheckedUpdateManyWithoutPatientNestedInput
    healthRecords?: HealthRecordUncheckedUpdateManyWithoutPatientNestedInput
    prescriptions?: PrescriptionUncheckedUpdateManyWithoutPatientNestedInput
    reviews?: ReviewUncheckedUpdateManyWithoutPatientNestedInput
  }

  export type PatientCreateManyInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PatientUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PatientUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type DoctorCreateInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentCreateNestedManyWithoutDoctorInput
    healthRecords?: HealthRecordCreateNestedManyWithoutDoctorInput
    prescriptions?: PrescriptionCreateNestedManyWithoutDoctorInput
    reviews?: ReviewCreateNestedManyWithoutDoctorInput
    locations?: DoctorLocationCreateNestedManyWithoutDoctorInput
  }

  export type DoctorUncheckedCreateInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentUncheckedCreateNestedManyWithoutDoctorInput
    healthRecords?: HealthRecordUncheckedCreateNestedManyWithoutDoctorInput
    prescriptions?: PrescriptionUncheckedCreateNestedManyWithoutDoctorInput
    reviews?: ReviewUncheckedCreateNestedManyWithoutDoctorInput
    locations?: DoctorLocationUncheckedCreateNestedManyWithoutDoctorInput
  }

  export type DoctorUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUpdateManyWithoutDoctorNestedInput
    healthRecords?: HealthRecordUpdateManyWithoutDoctorNestedInput
    prescriptions?: PrescriptionUpdateManyWithoutDoctorNestedInput
    reviews?: ReviewUpdateManyWithoutDoctorNestedInput
    locations?: DoctorLocationUpdateManyWithoutDoctorNestedInput
  }

  export type DoctorUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUncheckedUpdateManyWithoutDoctorNestedInput
    healthRecords?: HealthRecordUncheckedUpdateManyWithoutDoctorNestedInput
    prescriptions?: PrescriptionUncheckedUpdateManyWithoutDoctorNestedInput
    reviews?: ReviewUncheckedUpdateManyWithoutDoctorNestedInput
    locations?: DoctorLocationUncheckedUpdateManyWithoutDoctorNestedInput
  }

  export type DoctorCreateManyInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type DoctorUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type DoctorUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type DoctorLocationCreateInput = {
    startTime?: Date | string | null
    endTime?: Date | string | null
    doctor: DoctorCreateNestedOneWithoutLocationsInput
    location: LocationCreateNestedOneWithoutDoctorsInput
  }

  export type DoctorLocationUncheckedCreateInput = {
    doctorId: string
    locationId: string
    startTime?: Date | string | null
    endTime?: Date | string | null
  }

  export type DoctorLocationUpdateInput = {
    startTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    doctor?: DoctorUpdateOneRequiredWithoutLocationsNestedInput
    location?: LocationUpdateOneRequiredWithoutDoctorsNestedInput
  }

  export type DoctorLocationUncheckedUpdateInput = {
    doctorId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    startTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type DoctorLocationCreateManyInput = {
    doctorId: string
    locationId: string
    startTime?: Date | string | null
    endTime?: Date | string | null
  }

  export type DoctorLocationUpdateManyMutationInput = {
    startTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type DoctorLocationUncheckedUpdateManyInput = {
    doctorId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    startTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type LocationCreateInput = {
    id?: string
    name: string
    address: string
    city: string
    state: string
    country: string
    zipCode: string
    phone?: string | null
    email?: string | null
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    latitude?: number | null
    longitude?: number | null
    timezone?: string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    appointments?: AppointmentCreateNestedManyWithoutLocationInput
    doctors?: DoctorLocationCreateNestedManyWithoutLocationInput
  }

  export type LocationUncheckedCreateInput = {
    id?: string
    name: string
    address: string
    city: string
    state: string
    country: string
    zipCode: string
    phone?: string | null
    email?: string | null
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    latitude?: number | null
    longitude?: number | null
    timezone?: string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    appointments?: AppointmentUncheckedCreateNestedManyWithoutLocationInput
    doctors?: DoctorLocationUncheckedCreateNestedManyWithoutLocationInput
  }

  export type LocationUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    address?: StringFieldUpdateOperationsInput | string
    city?: StringFieldUpdateOperationsInput | string
    state?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    isActive?: BoolFieldUpdateOperationsInput | boolean
    isMainBranch?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    latitude?: NullableFloatFieldUpdateOperationsInput | number | null
    longitude?: NullableFloatFieldUpdateOperationsInput | number | null
    timezone?: StringFieldUpdateOperationsInput | string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    appointments?: AppointmentUpdateManyWithoutLocationNestedInput
    doctors?: DoctorLocationUpdateManyWithoutLocationNestedInput
  }

  export type LocationUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    address?: StringFieldUpdateOperationsInput | string
    city?: StringFieldUpdateOperationsInput | string
    state?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    isActive?: BoolFieldUpdateOperationsInput | boolean
    isMainBranch?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    latitude?: NullableFloatFieldUpdateOperationsInput | number | null
    longitude?: NullableFloatFieldUpdateOperationsInput | number | null
    timezone?: StringFieldUpdateOperationsInput | string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    appointments?: AppointmentUncheckedUpdateManyWithoutLocationNestedInput
    doctors?: DoctorLocationUncheckedUpdateManyWithoutLocationNestedInput
  }

  export type LocationCreateManyInput = {
    id?: string
    name: string
    address: string
    city: string
    state: string
    country: string
    zipCode: string
    phone?: string | null
    email?: string | null
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    latitude?: number | null
    longitude?: number | null
    timezone?: string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
  }

  export type LocationUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    address?: StringFieldUpdateOperationsInput | string
    city?: StringFieldUpdateOperationsInput | string
    state?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    isActive?: BoolFieldUpdateOperationsInput | boolean
    isMainBranch?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    latitude?: NullableFloatFieldUpdateOperationsInput | number | null
    longitude?: NullableFloatFieldUpdateOperationsInput | number | null
    timezone?: StringFieldUpdateOperationsInput | string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
  }

  export type LocationUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    address?: StringFieldUpdateOperationsInput | string
    city?: StringFieldUpdateOperationsInput | string
    state?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    isActive?: BoolFieldUpdateOperationsInput | boolean
    isMainBranch?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    latitude?: NullableFloatFieldUpdateOperationsInput | number | null
    longitude?: NullableFloatFieldUpdateOperationsInput | number | null
    timezone?: StringFieldUpdateOperationsInput | string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
  }

  export type AppointmentCreateInput = {
    id?: string
    type?: $Enums.AppointmentType
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    doctor: DoctorCreateNestedOneWithoutAppointmentsInput
    patient: PatientCreateNestedOneWithoutAppointmentsInput
    location: LocationCreateNestedOneWithoutAppointmentsInput
    therapy?: TherapyCreateNestedOneWithoutAppointmentsInput
    payment?: PaymentCreateNestedOneWithoutAppointmentInput
    queueItem?: QueueItemCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentUncheckedCreateInput = {
    id?: string
    type?: $Enums.AppointmentType
    doctorId: string
    patientId: string
    locationId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    therapyId?: string | null
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    payment?: PaymentUncheckedCreateNestedOneWithoutAppointmentInput
    queueItem?: QueueItemUncheckedCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    doctor?: DoctorUpdateOneRequiredWithoutAppointmentsNestedInput
    patient?: PatientUpdateOneRequiredWithoutAppointmentsNestedInput
    location?: LocationUpdateOneRequiredWithoutAppointmentsNestedInput
    therapy?: TherapyUpdateOneWithoutAppointmentsNestedInput
    payment?: PaymentUpdateOneWithoutAppointmentNestedInput
    queueItem?: QueueItemUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    doctorId?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    therapyId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    payment?: PaymentUncheckedUpdateOneWithoutAppointmentNestedInput
    queueItem?: QueueItemUncheckedUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentCreateManyInput = {
    id?: string
    type?: $Enums.AppointmentType
    doctorId: string
    patientId: string
    locationId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    therapyId?: string | null
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
  }

  export type AppointmentUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type AppointmentUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    doctorId?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    therapyId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type TherapyCreateInput = {
    id?: string
    name: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentCreateNestedManyWithoutTherapyInput
  }

  export type TherapyUncheckedCreateInput = {
    id?: string
    name: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentUncheckedCreateNestedManyWithoutTherapyInput
  }

  export type TherapyUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUpdateManyWithoutTherapyNestedInput
  }

  export type TherapyUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUncheckedUpdateManyWithoutTherapyNestedInput
  }

  export type TherapyCreateManyInput = {
    id?: string
    name: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TherapyUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TherapyUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentCreateInput = {
    id?: string
    amount: number
    status?: $Enums.PaymentStatus
    method?: $Enums.PaymentMethod | null
    transactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointment: AppointmentCreateNestedOneWithoutPaymentInput
  }

  export type PaymentUncheckedCreateInput = {
    id?: string
    appointmentId: string
    amount: number
    status?: $Enums.PaymentStatus
    method?: $Enums.PaymentMethod | null
    transactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PaymentUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    amount?: FloatFieldUpdateOperationsInput | number
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    method?: NullableEnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod | null
    transactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointment?: AppointmentUpdateOneRequiredWithoutPaymentNestedInput
  }

  export type PaymentUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    appointmentId?: StringFieldUpdateOperationsInput | string
    amount?: FloatFieldUpdateOperationsInput | number
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    method?: NullableEnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod | null
    transactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentCreateManyInput = {
    id?: string
    appointmentId: string
    amount: number
    status?: $Enums.PaymentStatus
    method?: $Enums.PaymentMethod | null
    transactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PaymentUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    amount?: FloatFieldUpdateOperationsInput | number
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    method?: NullableEnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod | null
    transactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    appointmentId?: StringFieldUpdateOperationsInput | string
    amount?: FloatFieldUpdateOperationsInput | number
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    method?: NullableEnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod | null
    transactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type QueueItemCreateInput = {
    id?: string
    queueNumber: number
    estimatedWaitTime?: number | null
    status?: $Enums.QueueStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    appointment: AppointmentCreateNestedOneWithoutQueueItemInput
  }

  export type QueueItemUncheckedCreateInput = {
    id?: string
    appointmentId: string
    queueNumber: number
    estimatedWaitTime?: number | null
    status?: $Enums.QueueStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type QueueItemUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    queueNumber?: IntFieldUpdateOperationsInput | number
    estimatedWaitTime?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumQueueStatusFieldUpdateOperationsInput | $Enums.QueueStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointment?: AppointmentUpdateOneRequiredWithoutQueueItemNestedInput
  }

  export type QueueItemUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    appointmentId?: StringFieldUpdateOperationsInput | string
    queueNumber?: IntFieldUpdateOperationsInput | number
    estimatedWaitTime?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumQueueStatusFieldUpdateOperationsInput | $Enums.QueueStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type QueueItemCreateManyInput = {
    id?: string
    appointmentId: string
    queueNumber: number
    estimatedWaitTime?: number | null
    status?: $Enums.QueueStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type QueueItemUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    queueNumber?: IntFieldUpdateOperationsInput | number
    estimatedWaitTime?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumQueueStatusFieldUpdateOperationsInput | $Enums.QueueStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type QueueItemUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    appointmentId?: StringFieldUpdateOperationsInput | string
    queueNumber?: IntFieldUpdateOperationsInput | number
    estimatedWaitTime?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumQueueStatusFieldUpdateOperationsInput | $Enums.QueueStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionCreateInput = {
    id?: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    doctor: DoctorCreateNestedOneWithoutPrescriptionsInput
    patient: PatientCreateNestedOneWithoutPrescriptionsInput
    items?: PrescriptionItemCreateNestedManyWithoutPrescriptionInput
  }

  export type PrescriptionUncheckedCreateInput = {
    id?: string
    patientId: string
    doctorId: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    items?: PrescriptionItemUncheckedCreateNestedManyWithoutPrescriptionInput
  }

  export type PrescriptionUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    doctor?: DoctorUpdateOneRequiredWithoutPrescriptionsNestedInput
    patient?: PatientUpdateOneRequiredWithoutPrescriptionsNestedInput
    items?: PrescriptionItemUpdateManyWithoutPrescriptionNestedInput
  }

  export type PrescriptionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    items?: PrescriptionItemUncheckedUpdateManyWithoutPrescriptionNestedInput
  }

  export type PrescriptionCreateManyInput = {
    id?: string
    patientId: string
    doctorId: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PrescriptionUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionItemCreateInput = {
    id?: string
    dosage?: string | null
    frequency?: string | null
    duration?: string | null
    instructions?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    medicine: MedicineCreateNestedOneWithoutPrescriptionItemsInput
    prescription: PrescriptionCreateNestedOneWithoutItemsInput
  }

  export type PrescriptionItemUncheckedCreateInput = {
    id?: string
    prescriptionId: string
    medicineId: string
    dosage?: string | null
    frequency?: string | null
    duration?: string | null
    instructions?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PrescriptionItemUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    frequency?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableStringFieldUpdateOperationsInput | string | null
    instructions?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    medicine?: MedicineUpdateOneRequiredWithoutPrescriptionItemsNestedInput
    prescription?: PrescriptionUpdateOneRequiredWithoutItemsNestedInput
  }

  export type PrescriptionItemUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    prescriptionId?: StringFieldUpdateOperationsInput | string
    medicineId?: StringFieldUpdateOperationsInput | string
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    frequency?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableStringFieldUpdateOperationsInput | string | null
    instructions?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionItemCreateManyInput = {
    id?: string
    prescriptionId: string
    medicineId: string
    dosage?: string | null
    frequency?: string | null
    duration?: string | null
    instructions?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PrescriptionItemUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    frequency?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableStringFieldUpdateOperationsInput | string | null
    instructions?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionItemUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    prescriptionId?: StringFieldUpdateOperationsInput | string
    medicineId?: StringFieldUpdateOperationsInput | string
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    frequency?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableStringFieldUpdateOperationsInput | string | null
    instructions?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MedicineCreateInput = {
    id?: string
    name: string
    description?: string | null
    ingredients?: string | null
    dosage?: string | null
    manufacturer?: string | null
    price?: number | null
    stock?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    prescriptionItems?: PrescriptionItemCreateNestedManyWithoutMedicineInput
  }

  export type MedicineUncheckedCreateInput = {
    id?: string
    name: string
    description?: string | null
    ingredients?: string | null
    dosage?: string | null
    manufacturer?: string | null
    price?: number | null
    stock?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    prescriptionItems?: PrescriptionItemUncheckedCreateNestedManyWithoutMedicineInput
  }

  export type MedicineUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    ingredients?: NullableStringFieldUpdateOperationsInput | string | null
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    manufacturer?: NullableStringFieldUpdateOperationsInput | string | null
    price?: NullableFloatFieldUpdateOperationsInput | number | null
    stock?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    prescriptionItems?: PrescriptionItemUpdateManyWithoutMedicineNestedInput
  }

  export type MedicineUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    ingredients?: NullableStringFieldUpdateOperationsInput | string | null
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    manufacturer?: NullableStringFieldUpdateOperationsInput | string | null
    price?: NullableFloatFieldUpdateOperationsInput | number | null
    stock?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    prescriptionItems?: PrescriptionItemUncheckedUpdateManyWithoutMedicineNestedInput
  }

  export type MedicineCreateManyInput = {
    id?: string
    name: string
    description?: string | null
    ingredients?: string | null
    dosage?: string | null
    manufacturer?: string | null
    price?: number | null
    stock?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MedicineUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    ingredients?: NullableStringFieldUpdateOperationsInput | string | null
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    manufacturer?: NullableStringFieldUpdateOperationsInput | string | null
    price?: NullableFloatFieldUpdateOperationsInput | number | null
    stock?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MedicineUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    ingredients?: NullableStringFieldUpdateOperationsInput | string | null
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    manufacturer?: NullableStringFieldUpdateOperationsInput | string | null
    price?: NullableFloatFieldUpdateOperationsInput | number | null
    stock?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type HealthRecordCreateInput = {
    id?: string
    recordType: $Enums.HealthRecordType
    report?: string | null
    fileUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    doctor: DoctorCreateNestedOneWithoutHealthRecordsInput
    patient: PatientCreateNestedOneWithoutHealthRecordsInput
  }

  export type HealthRecordUncheckedCreateInput = {
    id?: string
    patientId: string
    doctorId: string
    recordType: $Enums.HealthRecordType
    report?: string | null
    fileUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type HealthRecordUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    recordType?: EnumHealthRecordTypeFieldUpdateOperationsInput | $Enums.HealthRecordType
    report?: NullableStringFieldUpdateOperationsInput | string | null
    fileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    doctor?: DoctorUpdateOneRequiredWithoutHealthRecordsNestedInput
    patient?: PatientUpdateOneRequiredWithoutHealthRecordsNestedInput
  }

  export type HealthRecordUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    recordType?: EnumHealthRecordTypeFieldUpdateOperationsInput | $Enums.HealthRecordType
    report?: NullableStringFieldUpdateOperationsInput | string | null
    fileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type HealthRecordCreateManyInput = {
    id?: string
    patientId: string
    doctorId: string
    recordType: $Enums.HealthRecordType
    report?: string | null
    fileUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type HealthRecordUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    recordType?: EnumHealthRecordTypeFieldUpdateOperationsInput | $Enums.HealthRecordType
    report?: NullableStringFieldUpdateOperationsInput | string | null
    fileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type HealthRecordUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    recordType?: EnumHealthRecordTypeFieldUpdateOperationsInput | $Enums.HealthRecordType
    report?: NullableStringFieldUpdateOperationsInput | string | null
    fileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ReviewCreateInput = {
    id?: string
    rating?: number
    comment?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    doctor: DoctorCreateNestedOneWithoutReviewsInput
    patient: PatientCreateNestedOneWithoutReviewsInput
  }

  export type ReviewUncheckedCreateInput = {
    id?: string
    rating?: number
    comment?: string | null
    patientId: string
    doctorId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ReviewUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    doctor?: DoctorUpdateOneRequiredWithoutReviewsNestedInput
    patient?: PatientUpdateOneRequiredWithoutReviewsNestedInput
  }

  export type ReviewUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    patientId?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ReviewCreateManyInput = {
    id?: string
    rating?: number
    comment?: string | null
    patientId: string
    doctorId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ReviewUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ReviewUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    patientId?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type EnumPrakritiNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.Prakriti | EnumPrakritiFieldRefInput<$PrismaModel> | null
    in?: $Enums.Prakriti[] | ListEnumPrakritiFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Prakriti[] | ListEnumPrakritiFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPrakritiNullableFilter<$PrismaModel> | $Enums.Prakriti | null
  }

  export type EnumDoshaNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.Dosha | EnumDoshaFieldRefInput<$PrismaModel> | null
    in?: $Enums.Dosha[] | ListEnumDoshaFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Dosha[] | ListEnumDoshaFieldRefInput<$PrismaModel> | null
    not?: NestedEnumDoshaNullableFilter<$PrismaModel> | $Enums.Dosha | null
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type AppointmentListRelationFilter = {
    every?: AppointmentWhereInput
    some?: AppointmentWhereInput
    none?: AppointmentWhereInput
  }

  export type HealthRecordListRelationFilter = {
    every?: HealthRecordWhereInput
    some?: HealthRecordWhereInput
    none?: HealthRecordWhereInput
  }

  export type PrescriptionListRelationFilter = {
    every?: PrescriptionWhereInput
    some?: PrescriptionWhereInput
    none?: PrescriptionWhereInput
  }

  export type ReviewListRelationFilter = {
    every?: ReviewWhereInput
    some?: ReviewWhereInput
    none?: ReviewWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type AppointmentOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type HealthRecordOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PrescriptionOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ReviewOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PatientCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    prakriti?: SortOrder
    dosha?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    email?: SortOrder
    phone?: SortOrder
    gender?: SortOrder
    dateOfBirth?: SortOrder
    address?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PatientMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    prakriti?: SortOrder
    dosha?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    email?: SortOrder
    phone?: SortOrder
    gender?: SortOrder
    dateOfBirth?: SortOrder
    address?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PatientMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    prakriti?: SortOrder
    dosha?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    email?: SortOrder
    phone?: SortOrder
    gender?: SortOrder
    dateOfBirth?: SortOrder
    address?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type EnumPrakritiNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Prakriti | EnumPrakritiFieldRefInput<$PrismaModel> | null
    in?: $Enums.Prakriti[] | ListEnumPrakritiFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Prakriti[] | ListEnumPrakritiFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPrakritiNullableWithAggregatesFilter<$PrismaModel> | $Enums.Prakriti | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumPrakritiNullableFilter<$PrismaModel>
    _max?: NestedEnumPrakritiNullableFilter<$PrismaModel>
  }

  export type EnumDoshaNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Dosha | EnumDoshaFieldRefInput<$PrismaModel> | null
    in?: $Enums.Dosha[] | ListEnumDoshaFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Dosha[] | ListEnumDoshaFieldRefInput<$PrismaModel> | null
    not?: NestedEnumDoshaNullableWithAggregatesFilter<$PrismaModel> | $Enums.Dosha | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumDoshaNullableFilter<$PrismaModel>
    _max?: NestedEnumDoshaNullableFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type FloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }
  export type JsonNullableFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type DoctorLocationListRelationFilter = {
    every?: DoctorLocationWhereInput
    some?: DoctorLocationWhereInput
    none?: DoctorLocationWhereInput
  }

  export type DoctorLocationOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type DoctorCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    email?: SortOrder
    phone?: SortOrder
    specialization?: SortOrder
    experience?: SortOrder
    qualification?: SortOrder
    consultationFee?: SortOrder
    rating?: SortOrder
    isAvailable?: SortOrder
    workingHours?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type DoctorAvgOrderByAggregateInput = {
    experience?: SortOrder
    consultationFee?: SortOrder
    rating?: SortOrder
  }

  export type DoctorMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    email?: SortOrder
    phone?: SortOrder
    specialization?: SortOrder
    experience?: SortOrder
    qualification?: SortOrder
    consultationFee?: SortOrder
    rating?: SortOrder
    isAvailable?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type DoctorMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    email?: SortOrder
    phone?: SortOrder
    specialization?: SortOrder
    experience?: SortOrder
    qualification?: SortOrder
    consultationFee?: SortOrder
    rating?: SortOrder
    isAvailable?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type DoctorSumOrderByAggregateInput = {
    experience?: SortOrder
    consultationFee?: SortOrder
    rating?: SortOrder
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type FloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }
  export type JsonNullableWithAggregatesFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedJsonNullableFilter<$PrismaModel>
    _max?: NestedJsonNullableFilter<$PrismaModel>
  }

  export type DoctorScalarRelationFilter = {
    is?: DoctorWhereInput
    isNot?: DoctorWhereInput
  }

  export type LocationScalarRelationFilter = {
    is?: LocationWhereInput
    isNot?: LocationWhereInput
  }

  export type DoctorLocationDoctorIdLocationIdCompoundUniqueInput = {
    doctorId: string
    locationId: string
  }

  export type DoctorLocationCountOrderByAggregateInput = {
    doctorId?: SortOrder
    locationId?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrder
  }

  export type DoctorLocationMaxOrderByAggregateInput = {
    doctorId?: SortOrder
    locationId?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrder
  }

  export type DoctorLocationMinOrderByAggregateInput = {
    doctorId?: SortOrder
    locationId?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrder
  }

  export type LocationCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    address?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    phone?: SortOrder
    email?: SortOrder
    isActive?: SortOrder
    isMainBranch?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    latitude?: SortOrder
    longitude?: SortOrder
    timezone?: SortOrder
    workingHours?: SortOrder
  }

  export type LocationAvgOrderByAggregateInput = {
    latitude?: SortOrder
    longitude?: SortOrder
  }

  export type LocationMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    address?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    phone?: SortOrder
    email?: SortOrder
    isActive?: SortOrder
    isMainBranch?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    latitude?: SortOrder
    longitude?: SortOrder
    timezone?: SortOrder
  }

  export type LocationMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    address?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    phone?: SortOrder
    email?: SortOrder
    isActive?: SortOrder
    isMainBranch?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    latitude?: SortOrder
    longitude?: SortOrder
    timezone?: SortOrder
  }

  export type LocationSumOrderByAggregateInput = {
    latitude?: SortOrder
    longitude?: SortOrder
  }

  export type EnumAppointmentTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.AppointmentType | EnumAppointmentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AppointmentType[] | ListEnumAppointmentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AppointmentType[] | ListEnumAppointmentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAppointmentTypeFilter<$PrismaModel> | $Enums.AppointmentType
  }

  export type EnumAppointmentStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.AppointmentStatus | EnumAppointmentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.AppointmentStatus[] | ListEnumAppointmentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.AppointmentStatus[] | ListEnumAppointmentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumAppointmentStatusFilter<$PrismaModel> | $Enums.AppointmentStatus
  }

  export type PatientScalarRelationFilter = {
    is?: PatientWhereInput
    isNot?: PatientWhereInput
  }

  export type TherapyNullableScalarRelationFilter = {
    is?: TherapyWhereInput | null
    isNot?: TherapyWhereInput | null
  }

  export type PaymentNullableScalarRelationFilter = {
    is?: PaymentWhereInput | null
    isNot?: PaymentWhereInput | null
  }

  export type QueueItemNullableScalarRelationFilter = {
    is?: QueueItemWhereInput | null
    isNot?: QueueItemWhereInput | null
  }

  export type AppointmentCountOrderByAggregateInput = {
    id?: SortOrder
    type?: SortOrder
    doctorId?: SortOrder
    patientId?: SortOrder
    locationId?: SortOrder
    date?: SortOrder
    time?: SortOrder
    duration?: SortOrder
    status?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    therapyId?: SortOrder
    startedAt?: SortOrder
    checkedInAt?: SortOrder
    completedAt?: SortOrder
  }

  export type AppointmentAvgOrderByAggregateInput = {
    duration?: SortOrder
  }

  export type AppointmentMaxOrderByAggregateInput = {
    id?: SortOrder
    type?: SortOrder
    doctorId?: SortOrder
    patientId?: SortOrder
    locationId?: SortOrder
    date?: SortOrder
    time?: SortOrder
    duration?: SortOrder
    status?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    therapyId?: SortOrder
    startedAt?: SortOrder
    checkedInAt?: SortOrder
    completedAt?: SortOrder
  }

  export type AppointmentMinOrderByAggregateInput = {
    id?: SortOrder
    type?: SortOrder
    doctorId?: SortOrder
    patientId?: SortOrder
    locationId?: SortOrder
    date?: SortOrder
    time?: SortOrder
    duration?: SortOrder
    status?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    therapyId?: SortOrder
    startedAt?: SortOrder
    checkedInAt?: SortOrder
    completedAt?: SortOrder
  }

  export type AppointmentSumOrderByAggregateInput = {
    duration?: SortOrder
  }

  export type EnumAppointmentTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AppointmentType | EnumAppointmentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AppointmentType[] | ListEnumAppointmentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AppointmentType[] | ListEnumAppointmentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAppointmentTypeWithAggregatesFilter<$PrismaModel> | $Enums.AppointmentType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAppointmentTypeFilter<$PrismaModel>
    _max?: NestedEnumAppointmentTypeFilter<$PrismaModel>
  }

  export type EnumAppointmentStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AppointmentStatus | EnumAppointmentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.AppointmentStatus[] | ListEnumAppointmentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.AppointmentStatus[] | ListEnumAppointmentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumAppointmentStatusWithAggregatesFilter<$PrismaModel> | $Enums.AppointmentStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAppointmentStatusFilter<$PrismaModel>
    _max?: NestedEnumAppointmentStatusFilter<$PrismaModel>
  }

  export type IntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type TherapyCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrder
    duration?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TherapyAvgOrderByAggregateInput = {
    duration?: SortOrder
  }

  export type TherapyMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrder
    duration?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TherapyMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrder
    duration?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TherapySumOrderByAggregateInput = {
    duration?: SortOrder
  }

  export type IntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type FloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type EnumPaymentStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentStatus | EnumPaymentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentStatusFilter<$PrismaModel> | $Enums.PaymentStatus
  }

  export type EnumPaymentMethodNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentMethod | EnumPaymentMethodFieldRefInput<$PrismaModel> | null
    in?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPaymentMethodNullableFilter<$PrismaModel> | $Enums.PaymentMethod | null
  }

  export type AppointmentScalarRelationFilter = {
    is?: AppointmentWhereInput
    isNot?: AppointmentWhereInput
  }

  export type PaymentCountOrderByAggregateInput = {
    id?: SortOrder
    appointmentId?: SortOrder
    amount?: SortOrder
    status?: SortOrder
    method?: SortOrder
    transactionId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PaymentAvgOrderByAggregateInput = {
    amount?: SortOrder
  }

  export type PaymentMaxOrderByAggregateInput = {
    id?: SortOrder
    appointmentId?: SortOrder
    amount?: SortOrder
    status?: SortOrder
    method?: SortOrder
    transactionId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PaymentMinOrderByAggregateInput = {
    id?: SortOrder
    appointmentId?: SortOrder
    amount?: SortOrder
    status?: SortOrder
    method?: SortOrder
    transactionId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PaymentSumOrderByAggregateInput = {
    amount?: SortOrder
  }

  export type FloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type EnumPaymentStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentStatus | EnumPaymentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentStatusWithAggregatesFilter<$PrismaModel> | $Enums.PaymentStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPaymentStatusFilter<$PrismaModel>
    _max?: NestedEnumPaymentStatusFilter<$PrismaModel>
  }

  export type EnumPaymentMethodNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentMethod | EnumPaymentMethodFieldRefInput<$PrismaModel> | null
    in?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPaymentMethodNullableWithAggregatesFilter<$PrismaModel> | $Enums.PaymentMethod | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumPaymentMethodNullableFilter<$PrismaModel>
    _max?: NestedEnumPaymentMethodNullableFilter<$PrismaModel>
  }

  export type EnumQueueStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.QueueStatus | EnumQueueStatusFieldRefInput<$PrismaModel>
    in?: $Enums.QueueStatus[] | ListEnumQueueStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.QueueStatus[] | ListEnumQueueStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumQueueStatusFilter<$PrismaModel> | $Enums.QueueStatus
  }

  export type QueueItemCountOrderByAggregateInput = {
    id?: SortOrder
    appointmentId?: SortOrder
    queueNumber?: SortOrder
    estimatedWaitTime?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type QueueItemAvgOrderByAggregateInput = {
    queueNumber?: SortOrder
    estimatedWaitTime?: SortOrder
  }

  export type QueueItemMaxOrderByAggregateInput = {
    id?: SortOrder
    appointmentId?: SortOrder
    queueNumber?: SortOrder
    estimatedWaitTime?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type QueueItemMinOrderByAggregateInput = {
    id?: SortOrder
    appointmentId?: SortOrder
    queueNumber?: SortOrder
    estimatedWaitTime?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type QueueItemSumOrderByAggregateInput = {
    queueNumber?: SortOrder
    estimatedWaitTime?: SortOrder
  }

  export type EnumQueueStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.QueueStatus | EnumQueueStatusFieldRefInput<$PrismaModel>
    in?: $Enums.QueueStatus[] | ListEnumQueueStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.QueueStatus[] | ListEnumQueueStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumQueueStatusWithAggregatesFilter<$PrismaModel> | $Enums.QueueStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumQueueStatusFilter<$PrismaModel>
    _max?: NestedEnumQueueStatusFilter<$PrismaModel>
  }

  export type PrescriptionItemListRelationFilter = {
    every?: PrescriptionItemWhereInput
    some?: PrescriptionItemWhereInput
    none?: PrescriptionItemWhereInput
  }

  export type PrescriptionItemOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PrescriptionCountOrderByAggregateInput = {
    id?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    date?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PrescriptionMaxOrderByAggregateInput = {
    id?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    date?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PrescriptionMinOrderByAggregateInput = {
    id?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    date?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MedicineScalarRelationFilter = {
    is?: MedicineWhereInput
    isNot?: MedicineWhereInput
  }

  export type PrescriptionScalarRelationFilter = {
    is?: PrescriptionWhereInput
    isNot?: PrescriptionWhereInput
  }

  export type PrescriptionItemCountOrderByAggregateInput = {
    id?: SortOrder
    prescriptionId?: SortOrder
    medicineId?: SortOrder
    dosage?: SortOrder
    frequency?: SortOrder
    duration?: SortOrder
    instructions?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PrescriptionItemMaxOrderByAggregateInput = {
    id?: SortOrder
    prescriptionId?: SortOrder
    medicineId?: SortOrder
    dosage?: SortOrder
    frequency?: SortOrder
    duration?: SortOrder
    instructions?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PrescriptionItemMinOrderByAggregateInput = {
    id?: SortOrder
    prescriptionId?: SortOrder
    medicineId?: SortOrder
    dosage?: SortOrder
    frequency?: SortOrder
    duration?: SortOrder
    instructions?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MedicineCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrder
    ingredients?: SortOrder
    dosage?: SortOrder
    manufacturer?: SortOrder
    price?: SortOrder
    stock?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MedicineAvgOrderByAggregateInput = {
    price?: SortOrder
    stock?: SortOrder
  }

  export type MedicineMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrder
    ingredients?: SortOrder
    dosage?: SortOrder
    manufacturer?: SortOrder
    price?: SortOrder
    stock?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MedicineMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrder
    ingredients?: SortOrder
    dosage?: SortOrder
    manufacturer?: SortOrder
    price?: SortOrder
    stock?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MedicineSumOrderByAggregateInput = {
    price?: SortOrder
    stock?: SortOrder
  }

  export type EnumHealthRecordTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.HealthRecordType | EnumHealthRecordTypeFieldRefInput<$PrismaModel>
    in?: $Enums.HealthRecordType[] | ListEnumHealthRecordTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.HealthRecordType[] | ListEnumHealthRecordTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumHealthRecordTypeFilter<$PrismaModel> | $Enums.HealthRecordType
  }

  export type HealthRecordCountOrderByAggregateInput = {
    id?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    recordType?: SortOrder
    report?: SortOrder
    fileUrl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type HealthRecordMaxOrderByAggregateInput = {
    id?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    recordType?: SortOrder
    report?: SortOrder
    fileUrl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type HealthRecordMinOrderByAggregateInput = {
    id?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    recordType?: SortOrder
    report?: SortOrder
    fileUrl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EnumHealthRecordTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.HealthRecordType | EnumHealthRecordTypeFieldRefInput<$PrismaModel>
    in?: $Enums.HealthRecordType[] | ListEnumHealthRecordTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.HealthRecordType[] | ListEnumHealthRecordTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumHealthRecordTypeWithAggregatesFilter<$PrismaModel> | $Enums.HealthRecordType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumHealthRecordTypeFilter<$PrismaModel>
    _max?: NestedEnumHealthRecordTypeFilter<$PrismaModel>
  }

  export type ReviewCountOrderByAggregateInput = {
    id?: SortOrder
    rating?: SortOrder
    comment?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ReviewAvgOrderByAggregateInput = {
    rating?: SortOrder
  }

  export type ReviewMaxOrderByAggregateInput = {
    id?: SortOrder
    rating?: SortOrder
    comment?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ReviewMinOrderByAggregateInput = {
    id?: SortOrder
    rating?: SortOrder
    comment?: SortOrder
    patientId?: SortOrder
    doctorId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ReviewSumOrderByAggregateInput = {
    rating?: SortOrder
  }

  export type AppointmentCreateNestedManyWithoutPatientInput = {
    create?: XOR<AppointmentCreateWithoutPatientInput, AppointmentUncheckedCreateWithoutPatientInput> | AppointmentCreateWithoutPatientInput[] | AppointmentUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutPatientInput | AppointmentCreateOrConnectWithoutPatientInput[]
    createMany?: AppointmentCreateManyPatientInputEnvelope
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
  }

  export type HealthRecordCreateNestedManyWithoutPatientInput = {
    create?: XOR<HealthRecordCreateWithoutPatientInput, HealthRecordUncheckedCreateWithoutPatientInput> | HealthRecordCreateWithoutPatientInput[] | HealthRecordUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: HealthRecordCreateOrConnectWithoutPatientInput | HealthRecordCreateOrConnectWithoutPatientInput[]
    createMany?: HealthRecordCreateManyPatientInputEnvelope
    connect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
  }

  export type PrescriptionCreateNestedManyWithoutPatientInput = {
    create?: XOR<PrescriptionCreateWithoutPatientInput, PrescriptionUncheckedCreateWithoutPatientInput> | PrescriptionCreateWithoutPatientInput[] | PrescriptionUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: PrescriptionCreateOrConnectWithoutPatientInput | PrescriptionCreateOrConnectWithoutPatientInput[]
    createMany?: PrescriptionCreateManyPatientInputEnvelope
    connect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
  }

  export type ReviewCreateNestedManyWithoutPatientInput = {
    create?: XOR<ReviewCreateWithoutPatientInput, ReviewUncheckedCreateWithoutPatientInput> | ReviewCreateWithoutPatientInput[] | ReviewUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: ReviewCreateOrConnectWithoutPatientInput | ReviewCreateOrConnectWithoutPatientInput[]
    createMany?: ReviewCreateManyPatientInputEnvelope
    connect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
  }

  export type AppointmentUncheckedCreateNestedManyWithoutPatientInput = {
    create?: XOR<AppointmentCreateWithoutPatientInput, AppointmentUncheckedCreateWithoutPatientInput> | AppointmentCreateWithoutPatientInput[] | AppointmentUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutPatientInput | AppointmentCreateOrConnectWithoutPatientInput[]
    createMany?: AppointmentCreateManyPatientInputEnvelope
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
  }

  export type HealthRecordUncheckedCreateNestedManyWithoutPatientInput = {
    create?: XOR<HealthRecordCreateWithoutPatientInput, HealthRecordUncheckedCreateWithoutPatientInput> | HealthRecordCreateWithoutPatientInput[] | HealthRecordUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: HealthRecordCreateOrConnectWithoutPatientInput | HealthRecordCreateOrConnectWithoutPatientInput[]
    createMany?: HealthRecordCreateManyPatientInputEnvelope
    connect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
  }

  export type PrescriptionUncheckedCreateNestedManyWithoutPatientInput = {
    create?: XOR<PrescriptionCreateWithoutPatientInput, PrescriptionUncheckedCreateWithoutPatientInput> | PrescriptionCreateWithoutPatientInput[] | PrescriptionUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: PrescriptionCreateOrConnectWithoutPatientInput | PrescriptionCreateOrConnectWithoutPatientInput[]
    createMany?: PrescriptionCreateManyPatientInputEnvelope
    connect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
  }

  export type ReviewUncheckedCreateNestedManyWithoutPatientInput = {
    create?: XOR<ReviewCreateWithoutPatientInput, ReviewUncheckedCreateWithoutPatientInput> | ReviewCreateWithoutPatientInput[] | ReviewUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: ReviewCreateOrConnectWithoutPatientInput | ReviewCreateOrConnectWithoutPatientInput[]
    createMany?: ReviewCreateManyPatientInputEnvelope
    connect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableEnumPrakritiFieldUpdateOperationsInput = {
    set?: $Enums.Prakriti | null
  }

  export type NullableEnumDoshaFieldUpdateOperationsInput = {
    set?: $Enums.Dosha | null
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type AppointmentUpdateManyWithoutPatientNestedInput = {
    create?: XOR<AppointmentCreateWithoutPatientInput, AppointmentUncheckedCreateWithoutPatientInput> | AppointmentCreateWithoutPatientInput[] | AppointmentUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutPatientInput | AppointmentCreateOrConnectWithoutPatientInput[]
    upsert?: AppointmentUpsertWithWhereUniqueWithoutPatientInput | AppointmentUpsertWithWhereUniqueWithoutPatientInput[]
    createMany?: AppointmentCreateManyPatientInputEnvelope
    set?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    disconnect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    delete?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    update?: AppointmentUpdateWithWhereUniqueWithoutPatientInput | AppointmentUpdateWithWhereUniqueWithoutPatientInput[]
    updateMany?: AppointmentUpdateManyWithWhereWithoutPatientInput | AppointmentUpdateManyWithWhereWithoutPatientInput[]
    deleteMany?: AppointmentScalarWhereInput | AppointmentScalarWhereInput[]
  }

  export type HealthRecordUpdateManyWithoutPatientNestedInput = {
    create?: XOR<HealthRecordCreateWithoutPatientInput, HealthRecordUncheckedCreateWithoutPatientInput> | HealthRecordCreateWithoutPatientInput[] | HealthRecordUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: HealthRecordCreateOrConnectWithoutPatientInput | HealthRecordCreateOrConnectWithoutPatientInput[]
    upsert?: HealthRecordUpsertWithWhereUniqueWithoutPatientInput | HealthRecordUpsertWithWhereUniqueWithoutPatientInput[]
    createMany?: HealthRecordCreateManyPatientInputEnvelope
    set?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    disconnect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    delete?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    connect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    update?: HealthRecordUpdateWithWhereUniqueWithoutPatientInput | HealthRecordUpdateWithWhereUniqueWithoutPatientInput[]
    updateMany?: HealthRecordUpdateManyWithWhereWithoutPatientInput | HealthRecordUpdateManyWithWhereWithoutPatientInput[]
    deleteMany?: HealthRecordScalarWhereInput | HealthRecordScalarWhereInput[]
  }

  export type PrescriptionUpdateManyWithoutPatientNestedInput = {
    create?: XOR<PrescriptionCreateWithoutPatientInput, PrescriptionUncheckedCreateWithoutPatientInput> | PrescriptionCreateWithoutPatientInput[] | PrescriptionUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: PrescriptionCreateOrConnectWithoutPatientInput | PrescriptionCreateOrConnectWithoutPatientInput[]
    upsert?: PrescriptionUpsertWithWhereUniqueWithoutPatientInput | PrescriptionUpsertWithWhereUniqueWithoutPatientInput[]
    createMany?: PrescriptionCreateManyPatientInputEnvelope
    set?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    disconnect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    delete?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    connect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    update?: PrescriptionUpdateWithWhereUniqueWithoutPatientInput | PrescriptionUpdateWithWhereUniqueWithoutPatientInput[]
    updateMany?: PrescriptionUpdateManyWithWhereWithoutPatientInput | PrescriptionUpdateManyWithWhereWithoutPatientInput[]
    deleteMany?: PrescriptionScalarWhereInput | PrescriptionScalarWhereInput[]
  }

  export type ReviewUpdateManyWithoutPatientNestedInput = {
    create?: XOR<ReviewCreateWithoutPatientInput, ReviewUncheckedCreateWithoutPatientInput> | ReviewCreateWithoutPatientInput[] | ReviewUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: ReviewCreateOrConnectWithoutPatientInput | ReviewCreateOrConnectWithoutPatientInput[]
    upsert?: ReviewUpsertWithWhereUniqueWithoutPatientInput | ReviewUpsertWithWhereUniqueWithoutPatientInput[]
    createMany?: ReviewCreateManyPatientInputEnvelope
    set?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    disconnect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    delete?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    connect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    update?: ReviewUpdateWithWhereUniqueWithoutPatientInput | ReviewUpdateWithWhereUniqueWithoutPatientInput[]
    updateMany?: ReviewUpdateManyWithWhereWithoutPatientInput | ReviewUpdateManyWithWhereWithoutPatientInput[]
    deleteMany?: ReviewScalarWhereInput | ReviewScalarWhereInput[]
  }

  export type AppointmentUncheckedUpdateManyWithoutPatientNestedInput = {
    create?: XOR<AppointmentCreateWithoutPatientInput, AppointmentUncheckedCreateWithoutPatientInput> | AppointmentCreateWithoutPatientInput[] | AppointmentUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutPatientInput | AppointmentCreateOrConnectWithoutPatientInput[]
    upsert?: AppointmentUpsertWithWhereUniqueWithoutPatientInput | AppointmentUpsertWithWhereUniqueWithoutPatientInput[]
    createMany?: AppointmentCreateManyPatientInputEnvelope
    set?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    disconnect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    delete?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    update?: AppointmentUpdateWithWhereUniqueWithoutPatientInput | AppointmentUpdateWithWhereUniqueWithoutPatientInput[]
    updateMany?: AppointmentUpdateManyWithWhereWithoutPatientInput | AppointmentUpdateManyWithWhereWithoutPatientInput[]
    deleteMany?: AppointmentScalarWhereInput | AppointmentScalarWhereInput[]
  }

  export type HealthRecordUncheckedUpdateManyWithoutPatientNestedInput = {
    create?: XOR<HealthRecordCreateWithoutPatientInput, HealthRecordUncheckedCreateWithoutPatientInput> | HealthRecordCreateWithoutPatientInput[] | HealthRecordUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: HealthRecordCreateOrConnectWithoutPatientInput | HealthRecordCreateOrConnectWithoutPatientInput[]
    upsert?: HealthRecordUpsertWithWhereUniqueWithoutPatientInput | HealthRecordUpsertWithWhereUniqueWithoutPatientInput[]
    createMany?: HealthRecordCreateManyPatientInputEnvelope
    set?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    disconnect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    delete?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    connect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    update?: HealthRecordUpdateWithWhereUniqueWithoutPatientInput | HealthRecordUpdateWithWhereUniqueWithoutPatientInput[]
    updateMany?: HealthRecordUpdateManyWithWhereWithoutPatientInput | HealthRecordUpdateManyWithWhereWithoutPatientInput[]
    deleteMany?: HealthRecordScalarWhereInput | HealthRecordScalarWhereInput[]
  }

  export type PrescriptionUncheckedUpdateManyWithoutPatientNestedInput = {
    create?: XOR<PrescriptionCreateWithoutPatientInput, PrescriptionUncheckedCreateWithoutPatientInput> | PrescriptionCreateWithoutPatientInput[] | PrescriptionUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: PrescriptionCreateOrConnectWithoutPatientInput | PrescriptionCreateOrConnectWithoutPatientInput[]
    upsert?: PrescriptionUpsertWithWhereUniqueWithoutPatientInput | PrescriptionUpsertWithWhereUniqueWithoutPatientInput[]
    createMany?: PrescriptionCreateManyPatientInputEnvelope
    set?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    disconnect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    delete?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    connect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    update?: PrescriptionUpdateWithWhereUniqueWithoutPatientInput | PrescriptionUpdateWithWhereUniqueWithoutPatientInput[]
    updateMany?: PrescriptionUpdateManyWithWhereWithoutPatientInput | PrescriptionUpdateManyWithWhereWithoutPatientInput[]
    deleteMany?: PrescriptionScalarWhereInput | PrescriptionScalarWhereInput[]
  }

  export type ReviewUncheckedUpdateManyWithoutPatientNestedInput = {
    create?: XOR<ReviewCreateWithoutPatientInput, ReviewUncheckedCreateWithoutPatientInput> | ReviewCreateWithoutPatientInput[] | ReviewUncheckedCreateWithoutPatientInput[]
    connectOrCreate?: ReviewCreateOrConnectWithoutPatientInput | ReviewCreateOrConnectWithoutPatientInput[]
    upsert?: ReviewUpsertWithWhereUniqueWithoutPatientInput | ReviewUpsertWithWhereUniqueWithoutPatientInput[]
    createMany?: ReviewCreateManyPatientInputEnvelope
    set?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    disconnect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    delete?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    connect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    update?: ReviewUpdateWithWhereUniqueWithoutPatientInput | ReviewUpdateWithWhereUniqueWithoutPatientInput[]
    updateMany?: ReviewUpdateManyWithWhereWithoutPatientInput | ReviewUpdateManyWithWhereWithoutPatientInput[]
    deleteMany?: ReviewScalarWhereInput | ReviewScalarWhereInput[]
  }

  export type AppointmentCreateNestedManyWithoutDoctorInput = {
    create?: XOR<AppointmentCreateWithoutDoctorInput, AppointmentUncheckedCreateWithoutDoctorInput> | AppointmentCreateWithoutDoctorInput[] | AppointmentUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutDoctorInput | AppointmentCreateOrConnectWithoutDoctorInput[]
    createMany?: AppointmentCreateManyDoctorInputEnvelope
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
  }

  export type HealthRecordCreateNestedManyWithoutDoctorInput = {
    create?: XOR<HealthRecordCreateWithoutDoctorInput, HealthRecordUncheckedCreateWithoutDoctorInput> | HealthRecordCreateWithoutDoctorInput[] | HealthRecordUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: HealthRecordCreateOrConnectWithoutDoctorInput | HealthRecordCreateOrConnectWithoutDoctorInput[]
    createMany?: HealthRecordCreateManyDoctorInputEnvelope
    connect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
  }

  export type PrescriptionCreateNestedManyWithoutDoctorInput = {
    create?: XOR<PrescriptionCreateWithoutDoctorInput, PrescriptionUncheckedCreateWithoutDoctorInput> | PrescriptionCreateWithoutDoctorInput[] | PrescriptionUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: PrescriptionCreateOrConnectWithoutDoctorInput | PrescriptionCreateOrConnectWithoutDoctorInput[]
    createMany?: PrescriptionCreateManyDoctorInputEnvelope
    connect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
  }

  export type ReviewCreateNestedManyWithoutDoctorInput = {
    create?: XOR<ReviewCreateWithoutDoctorInput, ReviewUncheckedCreateWithoutDoctorInput> | ReviewCreateWithoutDoctorInput[] | ReviewUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: ReviewCreateOrConnectWithoutDoctorInput | ReviewCreateOrConnectWithoutDoctorInput[]
    createMany?: ReviewCreateManyDoctorInputEnvelope
    connect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
  }

  export type DoctorLocationCreateNestedManyWithoutDoctorInput = {
    create?: XOR<DoctorLocationCreateWithoutDoctorInput, DoctorLocationUncheckedCreateWithoutDoctorInput> | DoctorLocationCreateWithoutDoctorInput[] | DoctorLocationUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: DoctorLocationCreateOrConnectWithoutDoctorInput | DoctorLocationCreateOrConnectWithoutDoctorInput[]
    createMany?: DoctorLocationCreateManyDoctorInputEnvelope
    connect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
  }

  export type AppointmentUncheckedCreateNestedManyWithoutDoctorInput = {
    create?: XOR<AppointmentCreateWithoutDoctorInput, AppointmentUncheckedCreateWithoutDoctorInput> | AppointmentCreateWithoutDoctorInput[] | AppointmentUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutDoctorInput | AppointmentCreateOrConnectWithoutDoctorInput[]
    createMany?: AppointmentCreateManyDoctorInputEnvelope
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
  }

  export type HealthRecordUncheckedCreateNestedManyWithoutDoctorInput = {
    create?: XOR<HealthRecordCreateWithoutDoctorInput, HealthRecordUncheckedCreateWithoutDoctorInput> | HealthRecordCreateWithoutDoctorInput[] | HealthRecordUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: HealthRecordCreateOrConnectWithoutDoctorInput | HealthRecordCreateOrConnectWithoutDoctorInput[]
    createMany?: HealthRecordCreateManyDoctorInputEnvelope
    connect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
  }

  export type PrescriptionUncheckedCreateNestedManyWithoutDoctorInput = {
    create?: XOR<PrescriptionCreateWithoutDoctorInput, PrescriptionUncheckedCreateWithoutDoctorInput> | PrescriptionCreateWithoutDoctorInput[] | PrescriptionUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: PrescriptionCreateOrConnectWithoutDoctorInput | PrescriptionCreateOrConnectWithoutDoctorInput[]
    createMany?: PrescriptionCreateManyDoctorInputEnvelope
    connect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
  }

  export type ReviewUncheckedCreateNestedManyWithoutDoctorInput = {
    create?: XOR<ReviewCreateWithoutDoctorInput, ReviewUncheckedCreateWithoutDoctorInput> | ReviewCreateWithoutDoctorInput[] | ReviewUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: ReviewCreateOrConnectWithoutDoctorInput | ReviewCreateOrConnectWithoutDoctorInput[]
    createMany?: ReviewCreateManyDoctorInputEnvelope
    connect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
  }

  export type DoctorLocationUncheckedCreateNestedManyWithoutDoctorInput = {
    create?: XOR<DoctorLocationCreateWithoutDoctorInput, DoctorLocationUncheckedCreateWithoutDoctorInput> | DoctorLocationCreateWithoutDoctorInput[] | DoctorLocationUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: DoctorLocationCreateOrConnectWithoutDoctorInput | DoctorLocationCreateOrConnectWithoutDoctorInput[]
    createMany?: DoctorLocationCreateManyDoctorInputEnvelope
    connect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NullableFloatFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type AppointmentUpdateManyWithoutDoctorNestedInput = {
    create?: XOR<AppointmentCreateWithoutDoctorInput, AppointmentUncheckedCreateWithoutDoctorInput> | AppointmentCreateWithoutDoctorInput[] | AppointmentUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutDoctorInput | AppointmentCreateOrConnectWithoutDoctorInput[]
    upsert?: AppointmentUpsertWithWhereUniqueWithoutDoctorInput | AppointmentUpsertWithWhereUniqueWithoutDoctorInput[]
    createMany?: AppointmentCreateManyDoctorInputEnvelope
    set?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    disconnect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    delete?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    update?: AppointmentUpdateWithWhereUniqueWithoutDoctorInput | AppointmentUpdateWithWhereUniqueWithoutDoctorInput[]
    updateMany?: AppointmentUpdateManyWithWhereWithoutDoctorInput | AppointmentUpdateManyWithWhereWithoutDoctorInput[]
    deleteMany?: AppointmentScalarWhereInput | AppointmentScalarWhereInput[]
  }

  export type HealthRecordUpdateManyWithoutDoctorNestedInput = {
    create?: XOR<HealthRecordCreateWithoutDoctorInput, HealthRecordUncheckedCreateWithoutDoctorInput> | HealthRecordCreateWithoutDoctorInput[] | HealthRecordUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: HealthRecordCreateOrConnectWithoutDoctorInput | HealthRecordCreateOrConnectWithoutDoctorInput[]
    upsert?: HealthRecordUpsertWithWhereUniqueWithoutDoctorInput | HealthRecordUpsertWithWhereUniqueWithoutDoctorInput[]
    createMany?: HealthRecordCreateManyDoctorInputEnvelope
    set?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    disconnect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    delete?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    connect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    update?: HealthRecordUpdateWithWhereUniqueWithoutDoctorInput | HealthRecordUpdateWithWhereUniqueWithoutDoctorInput[]
    updateMany?: HealthRecordUpdateManyWithWhereWithoutDoctorInput | HealthRecordUpdateManyWithWhereWithoutDoctorInput[]
    deleteMany?: HealthRecordScalarWhereInput | HealthRecordScalarWhereInput[]
  }

  export type PrescriptionUpdateManyWithoutDoctorNestedInput = {
    create?: XOR<PrescriptionCreateWithoutDoctorInput, PrescriptionUncheckedCreateWithoutDoctorInput> | PrescriptionCreateWithoutDoctorInput[] | PrescriptionUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: PrescriptionCreateOrConnectWithoutDoctorInput | PrescriptionCreateOrConnectWithoutDoctorInput[]
    upsert?: PrescriptionUpsertWithWhereUniqueWithoutDoctorInput | PrescriptionUpsertWithWhereUniqueWithoutDoctorInput[]
    createMany?: PrescriptionCreateManyDoctorInputEnvelope
    set?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    disconnect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    delete?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    connect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    update?: PrescriptionUpdateWithWhereUniqueWithoutDoctorInput | PrescriptionUpdateWithWhereUniqueWithoutDoctorInput[]
    updateMany?: PrescriptionUpdateManyWithWhereWithoutDoctorInput | PrescriptionUpdateManyWithWhereWithoutDoctorInput[]
    deleteMany?: PrescriptionScalarWhereInput | PrescriptionScalarWhereInput[]
  }

  export type ReviewUpdateManyWithoutDoctorNestedInput = {
    create?: XOR<ReviewCreateWithoutDoctorInput, ReviewUncheckedCreateWithoutDoctorInput> | ReviewCreateWithoutDoctorInput[] | ReviewUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: ReviewCreateOrConnectWithoutDoctorInput | ReviewCreateOrConnectWithoutDoctorInput[]
    upsert?: ReviewUpsertWithWhereUniqueWithoutDoctorInput | ReviewUpsertWithWhereUniqueWithoutDoctorInput[]
    createMany?: ReviewCreateManyDoctorInputEnvelope
    set?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    disconnect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    delete?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    connect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    update?: ReviewUpdateWithWhereUniqueWithoutDoctorInput | ReviewUpdateWithWhereUniqueWithoutDoctorInput[]
    updateMany?: ReviewUpdateManyWithWhereWithoutDoctorInput | ReviewUpdateManyWithWhereWithoutDoctorInput[]
    deleteMany?: ReviewScalarWhereInput | ReviewScalarWhereInput[]
  }

  export type DoctorLocationUpdateManyWithoutDoctorNestedInput = {
    create?: XOR<DoctorLocationCreateWithoutDoctorInput, DoctorLocationUncheckedCreateWithoutDoctorInput> | DoctorLocationCreateWithoutDoctorInput[] | DoctorLocationUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: DoctorLocationCreateOrConnectWithoutDoctorInput | DoctorLocationCreateOrConnectWithoutDoctorInput[]
    upsert?: DoctorLocationUpsertWithWhereUniqueWithoutDoctorInput | DoctorLocationUpsertWithWhereUniqueWithoutDoctorInput[]
    createMany?: DoctorLocationCreateManyDoctorInputEnvelope
    set?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    disconnect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    delete?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    connect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    update?: DoctorLocationUpdateWithWhereUniqueWithoutDoctorInput | DoctorLocationUpdateWithWhereUniqueWithoutDoctorInput[]
    updateMany?: DoctorLocationUpdateManyWithWhereWithoutDoctorInput | DoctorLocationUpdateManyWithWhereWithoutDoctorInput[]
    deleteMany?: DoctorLocationScalarWhereInput | DoctorLocationScalarWhereInput[]
  }

  export type AppointmentUncheckedUpdateManyWithoutDoctorNestedInput = {
    create?: XOR<AppointmentCreateWithoutDoctorInput, AppointmentUncheckedCreateWithoutDoctorInput> | AppointmentCreateWithoutDoctorInput[] | AppointmentUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutDoctorInput | AppointmentCreateOrConnectWithoutDoctorInput[]
    upsert?: AppointmentUpsertWithWhereUniqueWithoutDoctorInput | AppointmentUpsertWithWhereUniqueWithoutDoctorInput[]
    createMany?: AppointmentCreateManyDoctorInputEnvelope
    set?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    disconnect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    delete?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    update?: AppointmentUpdateWithWhereUniqueWithoutDoctorInput | AppointmentUpdateWithWhereUniqueWithoutDoctorInput[]
    updateMany?: AppointmentUpdateManyWithWhereWithoutDoctorInput | AppointmentUpdateManyWithWhereWithoutDoctorInput[]
    deleteMany?: AppointmentScalarWhereInput | AppointmentScalarWhereInput[]
  }

  export type HealthRecordUncheckedUpdateManyWithoutDoctorNestedInput = {
    create?: XOR<HealthRecordCreateWithoutDoctorInput, HealthRecordUncheckedCreateWithoutDoctorInput> | HealthRecordCreateWithoutDoctorInput[] | HealthRecordUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: HealthRecordCreateOrConnectWithoutDoctorInput | HealthRecordCreateOrConnectWithoutDoctorInput[]
    upsert?: HealthRecordUpsertWithWhereUniqueWithoutDoctorInput | HealthRecordUpsertWithWhereUniqueWithoutDoctorInput[]
    createMany?: HealthRecordCreateManyDoctorInputEnvelope
    set?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    disconnect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    delete?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    connect?: HealthRecordWhereUniqueInput | HealthRecordWhereUniqueInput[]
    update?: HealthRecordUpdateWithWhereUniqueWithoutDoctorInput | HealthRecordUpdateWithWhereUniqueWithoutDoctorInput[]
    updateMany?: HealthRecordUpdateManyWithWhereWithoutDoctorInput | HealthRecordUpdateManyWithWhereWithoutDoctorInput[]
    deleteMany?: HealthRecordScalarWhereInput | HealthRecordScalarWhereInput[]
  }

  export type PrescriptionUncheckedUpdateManyWithoutDoctorNestedInput = {
    create?: XOR<PrescriptionCreateWithoutDoctorInput, PrescriptionUncheckedCreateWithoutDoctorInput> | PrescriptionCreateWithoutDoctorInput[] | PrescriptionUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: PrescriptionCreateOrConnectWithoutDoctorInput | PrescriptionCreateOrConnectWithoutDoctorInput[]
    upsert?: PrescriptionUpsertWithWhereUniqueWithoutDoctorInput | PrescriptionUpsertWithWhereUniqueWithoutDoctorInput[]
    createMany?: PrescriptionCreateManyDoctorInputEnvelope
    set?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    disconnect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    delete?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    connect?: PrescriptionWhereUniqueInput | PrescriptionWhereUniqueInput[]
    update?: PrescriptionUpdateWithWhereUniqueWithoutDoctorInput | PrescriptionUpdateWithWhereUniqueWithoutDoctorInput[]
    updateMany?: PrescriptionUpdateManyWithWhereWithoutDoctorInput | PrescriptionUpdateManyWithWhereWithoutDoctorInput[]
    deleteMany?: PrescriptionScalarWhereInput | PrescriptionScalarWhereInput[]
  }

  export type ReviewUncheckedUpdateManyWithoutDoctorNestedInput = {
    create?: XOR<ReviewCreateWithoutDoctorInput, ReviewUncheckedCreateWithoutDoctorInput> | ReviewCreateWithoutDoctorInput[] | ReviewUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: ReviewCreateOrConnectWithoutDoctorInput | ReviewCreateOrConnectWithoutDoctorInput[]
    upsert?: ReviewUpsertWithWhereUniqueWithoutDoctorInput | ReviewUpsertWithWhereUniqueWithoutDoctorInput[]
    createMany?: ReviewCreateManyDoctorInputEnvelope
    set?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    disconnect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    delete?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    connect?: ReviewWhereUniqueInput | ReviewWhereUniqueInput[]
    update?: ReviewUpdateWithWhereUniqueWithoutDoctorInput | ReviewUpdateWithWhereUniqueWithoutDoctorInput[]
    updateMany?: ReviewUpdateManyWithWhereWithoutDoctorInput | ReviewUpdateManyWithWhereWithoutDoctorInput[]
    deleteMany?: ReviewScalarWhereInput | ReviewScalarWhereInput[]
  }

  export type DoctorLocationUncheckedUpdateManyWithoutDoctorNestedInput = {
    create?: XOR<DoctorLocationCreateWithoutDoctorInput, DoctorLocationUncheckedCreateWithoutDoctorInput> | DoctorLocationCreateWithoutDoctorInput[] | DoctorLocationUncheckedCreateWithoutDoctorInput[]
    connectOrCreate?: DoctorLocationCreateOrConnectWithoutDoctorInput | DoctorLocationCreateOrConnectWithoutDoctorInput[]
    upsert?: DoctorLocationUpsertWithWhereUniqueWithoutDoctorInput | DoctorLocationUpsertWithWhereUniqueWithoutDoctorInput[]
    createMany?: DoctorLocationCreateManyDoctorInputEnvelope
    set?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    disconnect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    delete?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    connect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    update?: DoctorLocationUpdateWithWhereUniqueWithoutDoctorInput | DoctorLocationUpdateWithWhereUniqueWithoutDoctorInput[]
    updateMany?: DoctorLocationUpdateManyWithWhereWithoutDoctorInput | DoctorLocationUpdateManyWithWhereWithoutDoctorInput[]
    deleteMany?: DoctorLocationScalarWhereInput | DoctorLocationScalarWhereInput[]
  }

  export type DoctorCreateNestedOneWithoutLocationsInput = {
    create?: XOR<DoctorCreateWithoutLocationsInput, DoctorUncheckedCreateWithoutLocationsInput>
    connectOrCreate?: DoctorCreateOrConnectWithoutLocationsInput
    connect?: DoctorWhereUniqueInput
  }

  export type LocationCreateNestedOneWithoutDoctorsInput = {
    create?: XOR<LocationCreateWithoutDoctorsInput, LocationUncheckedCreateWithoutDoctorsInput>
    connectOrCreate?: LocationCreateOrConnectWithoutDoctorsInput
    connect?: LocationWhereUniqueInput
  }

  export type DoctorUpdateOneRequiredWithoutLocationsNestedInput = {
    create?: XOR<DoctorCreateWithoutLocationsInput, DoctorUncheckedCreateWithoutLocationsInput>
    connectOrCreate?: DoctorCreateOrConnectWithoutLocationsInput
    upsert?: DoctorUpsertWithoutLocationsInput
    connect?: DoctorWhereUniqueInput
    update?: XOR<XOR<DoctorUpdateToOneWithWhereWithoutLocationsInput, DoctorUpdateWithoutLocationsInput>, DoctorUncheckedUpdateWithoutLocationsInput>
  }

  export type LocationUpdateOneRequiredWithoutDoctorsNestedInput = {
    create?: XOR<LocationCreateWithoutDoctorsInput, LocationUncheckedCreateWithoutDoctorsInput>
    connectOrCreate?: LocationCreateOrConnectWithoutDoctorsInput
    upsert?: LocationUpsertWithoutDoctorsInput
    connect?: LocationWhereUniqueInput
    update?: XOR<XOR<LocationUpdateToOneWithWhereWithoutDoctorsInput, LocationUpdateWithoutDoctorsInput>, LocationUncheckedUpdateWithoutDoctorsInput>
  }

  export type AppointmentCreateNestedManyWithoutLocationInput = {
    create?: XOR<AppointmentCreateWithoutLocationInput, AppointmentUncheckedCreateWithoutLocationInput> | AppointmentCreateWithoutLocationInput[] | AppointmentUncheckedCreateWithoutLocationInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutLocationInput | AppointmentCreateOrConnectWithoutLocationInput[]
    createMany?: AppointmentCreateManyLocationInputEnvelope
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
  }

  export type DoctorLocationCreateNestedManyWithoutLocationInput = {
    create?: XOR<DoctorLocationCreateWithoutLocationInput, DoctorLocationUncheckedCreateWithoutLocationInput> | DoctorLocationCreateWithoutLocationInput[] | DoctorLocationUncheckedCreateWithoutLocationInput[]
    connectOrCreate?: DoctorLocationCreateOrConnectWithoutLocationInput | DoctorLocationCreateOrConnectWithoutLocationInput[]
    createMany?: DoctorLocationCreateManyLocationInputEnvelope
    connect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
  }

  export type AppointmentUncheckedCreateNestedManyWithoutLocationInput = {
    create?: XOR<AppointmentCreateWithoutLocationInput, AppointmentUncheckedCreateWithoutLocationInput> | AppointmentCreateWithoutLocationInput[] | AppointmentUncheckedCreateWithoutLocationInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutLocationInput | AppointmentCreateOrConnectWithoutLocationInput[]
    createMany?: AppointmentCreateManyLocationInputEnvelope
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
  }

  export type DoctorLocationUncheckedCreateNestedManyWithoutLocationInput = {
    create?: XOR<DoctorLocationCreateWithoutLocationInput, DoctorLocationUncheckedCreateWithoutLocationInput> | DoctorLocationCreateWithoutLocationInput[] | DoctorLocationUncheckedCreateWithoutLocationInput[]
    connectOrCreate?: DoctorLocationCreateOrConnectWithoutLocationInput | DoctorLocationCreateOrConnectWithoutLocationInput[]
    createMany?: DoctorLocationCreateManyLocationInputEnvelope
    connect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
  }

  export type AppointmentUpdateManyWithoutLocationNestedInput = {
    create?: XOR<AppointmentCreateWithoutLocationInput, AppointmentUncheckedCreateWithoutLocationInput> | AppointmentCreateWithoutLocationInput[] | AppointmentUncheckedCreateWithoutLocationInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutLocationInput | AppointmentCreateOrConnectWithoutLocationInput[]
    upsert?: AppointmentUpsertWithWhereUniqueWithoutLocationInput | AppointmentUpsertWithWhereUniqueWithoutLocationInput[]
    createMany?: AppointmentCreateManyLocationInputEnvelope
    set?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    disconnect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    delete?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    update?: AppointmentUpdateWithWhereUniqueWithoutLocationInput | AppointmentUpdateWithWhereUniqueWithoutLocationInput[]
    updateMany?: AppointmentUpdateManyWithWhereWithoutLocationInput | AppointmentUpdateManyWithWhereWithoutLocationInput[]
    deleteMany?: AppointmentScalarWhereInput | AppointmentScalarWhereInput[]
  }

  export type DoctorLocationUpdateManyWithoutLocationNestedInput = {
    create?: XOR<DoctorLocationCreateWithoutLocationInput, DoctorLocationUncheckedCreateWithoutLocationInput> | DoctorLocationCreateWithoutLocationInput[] | DoctorLocationUncheckedCreateWithoutLocationInput[]
    connectOrCreate?: DoctorLocationCreateOrConnectWithoutLocationInput | DoctorLocationCreateOrConnectWithoutLocationInput[]
    upsert?: DoctorLocationUpsertWithWhereUniqueWithoutLocationInput | DoctorLocationUpsertWithWhereUniqueWithoutLocationInput[]
    createMany?: DoctorLocationCreateManyLocationInputEnvelope
    set?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    disconnect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    delete?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    connect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    update?: DoctorLocationUpdateWithWhereUniqueWithoutLocationInput | DoctorLocationUpdateWithWhereUniqueWithoutLocationInput[]
    updateMany?: DoctorLocationUpdateManyWithWhereWithoutLocationInput | DoctorLocationUpdateManyWithWhereWithoutLocationInput[]
    deleteMany?: DoctorLocationScalarWhereInput | DoctorLocationScalarWhereInput[]
  }

  export type AppointmentUncheckedUpdateManyWithoutLocationNestedInput = {
    create?: XOR<AppointmentCreateWithoutLocationInput, AppointmentUncheckedCreateWithoutLocationInput> | AppointmentCreateWithoutLocationInput[] | AppointmentUncheckedCreateWithoutLocationInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutLocationInput | AppointmentCreateOrConnectWithoutLocationInput[]
    upsert?: AppointmentUpsertWithWhereUniqueWithoutLocationInput | AppointmentUpsertWithWhereUniqueWithoutLocationInput[]
    createMany?: AppointmentCreateManyLocationInputEnvelope
    set?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    disconnect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    delete?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    update?: AppointmentUpdateWithWhereUniqueWithoutLocationInput | AppointmentUpdateWithWhereUniqueWithoutLocationInput[]
    updateMany?: AppointmentUpdateManyWithWhereWithoutLocationInput | AppointmentUpdateManyWithWhereWithoutLocationInput[]
    deleteMany?: AppointmentScalarWhereInput | AppointmentScalarWhereInput[]
  }

  export type DoctorLocationUncheckedUpdateManyWithoutLocationNestedInput = {
    create?: XOR<DoctorLocationCreateWithoutLocationInput, DoctorLocationUncheckedCreateWithoutLocationInput> | DoctorLocationCreateWithoutLocationInput[] | DoctorLocationUncheckedCreateWithoutLocationInput[]
    connectOrCreate?: DoctorLocationCreateOrConnectWithoutLocationInput | DoctorLocationCreateOrConnectWithoutLocationInput[]
    upsert?: DoctorLocationUpsertWithWhereUniqueWithoutLocationInput | DoctorLocationUpsertWithWhereUniqueWithoutLocationInput[]
    createMany?: DoctorLocationCreateManyLocationInputEnvelope
    set?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    disconnect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    delete?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    connect?: DoctorLocationWhereUniqueInput | DoctorLocationWhereUniqueInput[]
    update?: DoctorLocationUpdateWithWhereUniqueWithoutLocationInput | DoctorLocationUpdateWithWhereUniqueWithoutLocationInput[]
    updateMany?: DoctorLocationUpdateManyWithWhereWithoutLocationInput | DoctorLocationUpdateManyWithWhereWithoutLocationInput[]
    deleteMany?: DoctorLocationScalarWhereInput | DoctorLocationScalarWhereInput[]
  }

  export type DoctorCreateNestedOneWithoutAppointmentsInput = {
    create?: XOR<DoctorCreateWithoutAppointmentsInput, DoctorUncheckedCreateWithoutAppointmentsInput>
    connectOrCreate?: DoctorCreateOrConnectWithoutAppointmentsInput
    connect?: DoctorWhereUniqueInput
  }

  export type PatientCreateNestedOneWithoutAppointmentsInput = {
    create?: XOR<PatientCreateWithoutAppointmentsInput, PatientUncheckedCreateWithoutAppointmentsInput>
    connectOrCreate?: PatientCreateOrConnectWithoutAppointmentsInput
    connect?: PatientWhereUniqueInput
  }

  export type LocationCreateNestedOneWithoutAppointmentsInput = {
    create?: XOR<LocationCreateWithoutAppointmentsInput, LocationUncheckedCreateWithoutAppointmentsInput>
    connectOrCreate?: LocationCreateOrConnectWithoutAppointmentsInput
    connect?: LocationWhereUniqueInput
  }

  export type TherapyCreateNestedOneWithoutAppointmentsInput = {
    create?: XOR<TherapyCreateWithoutAppointmentsInput, TherapyUncheckedCreateWithoutAppointmentsInput>
    connectOrCreate?: TherapyCreateOrConnectWithoutAppointmentsInput
    connect?: TherapyWhereUniqueInput
  }

  export type PaymentCreateNestedOneWithoutAppointmentInput = {
    create?: XOR<PaymentCreateWithoutAppointmentInput, PaymentUncheckedCreateWithoutAppointmentInput>
    connectOrCreate?: PaymentCreateOrConnectWithoutAppointmentInput
    connect?: PaymentWhereUniqueInput
  }

  export type QueueItemCreateNestedOneWithoutAppointmentInput = {
    create?: XOR<QueueItemCreateWithoutAppointmentInput, QueueItemUncheckedCreateWithoutAppointmentInput>
    connectOrCreate?: QueueItemCreateOrConnectWithoutAppointmentInput
    connect?: QueueItemWhereUniqueInput
  }

  export type PaymentUncheckedCreateNestedOneWithoutAppointmentInput = {
    create?: XOR<PaymentCreateWithoutAppointmentInput, PaymentUncheckedCreateWithoutAppointmentInput>
    connectOrCreate?: PaymentCreateOrConnectWithoutAppointmentInput
    connect?: PaymentWhereUniqueInput
  }

  export type QueueItemUncheckedCreateNestedOneWithoutAppointmentInput = {
    create?: XOR<QueueItemCreateWithoutAppointmentInput, QueueItemUncheckedCreateWithoutAppointmentInput>
    connectOrCreate?: QueueItemCreateOrConnectWithoutAppointmentInput
    connect?: QueueItemWhereUniqueInput
  }

  export type EnumAppointmentTypeFieldUpdateOperationsInput = {
    set?: $Enums.AppointmentType
  }

  export type EnumAppointmentStatusFieldUpdateOperationsInput = {
    set?: $Enums.AppointmentStatus
  }

  export type DoctorUpdateOneRequiredWithoutAppointmentsNestedInput = {
    create?: XOR<DoctorCreateWithoutAppointmentsInput, DoctorUncheckedCreateWithoutAppointmentsInput>
    connectOrCreate?: DoctorCreateOrConnectWithoutAppointmentsInput
    upsert?: DoctorUpsertWithoutAppointmentsInput
    connect?: DoctorWhereUniqueInput
    update?: XOR<XOR<DoctorUpdateToOneWithWhereWithoutAppointmentsInput, DoctorUpdateWithoutAppointmentsInput>, DoctorUncheckedUpdateWithoutAppointmentsInput>
  }

  export type PatientUpdateOneRequiredWithoutAppointmentsNestedInput = {
    create?: XOR<PatientCreateWithoutAppointmentsInput, PatientUncheckedCreateWithoutAppointmentsInput>
    connectOrCreate?: PatientCreateOrConnectWithoutAppointmentsInput
    upsert?: PatientUpsertWithoutAppointmentsInput
    connect?: PatientWhereUniqueInput
    update?: XOR<XOR<PatientUpdateToOneWithWhereWithoutAppointmentsInput, PatientUpdateWithoutAppointmentsInput>, PatientUncheckedUpdateWithoutAppointmentsInput>
  }

  export type LocationUpdateOneRequiredWithoutAppointmentsNestedInput = {
    create?: XOR<LocationCreateWithoutAppointmentsInput, LocationUncheckedCreateWithoutAppointmentsInput>
    connectOrCreate?: LocationCreateOrConnectWithoutAppointmentsInput
    upsert?: LocationUpsertWithoutAppointmentsInput
    connect?: LocationWhereUniqueInput
    update?: XOR<XOR<LocationUpdateToOneWithWhereWithoutAppointmentsInput, LocationUpdateWithoutAppointmentsInput>, LocationUncheckedUpdateWithoutAppointmentsInput>
  }

  export type TherapyUpdateOneWithoutAppointmentsNestedInput = {
    create?: XOR<TherapyCreateWithoutAppointmentsInput, TherapyUncheckedCreateWithoutAppointmentsInput>
    connectOrCreate?: TherapyCreateOrConnectWithoutAppointmentsInput
    upsert?: TherapyUpsertWithoutAppointmentsInput
    disconnect?: TherapyWhereInput | boolean
    delete?: TherapyWhereInput | boolean
    connect?: TherapyWhereUniqueInput
    update?: XOR<XOR<TherapyUpdateToOneWithWhereWithoutAppointmentsInput, TherapyUpdateWithoutAppointmentsInput>, TherapyUncheckedUpdateWithoutAppointmentsInput>
  }

  export type PaymentUpdateOneWithoutAppointmentNestedInput = {
    create?: XOR<PaymentCreateWithoutAppointmentInput, PaymentUncheckedCreateWithoutAppointmentInput>
    connectOrCreate?: PaymentCreateOrConnectWithoutAppointmentInput
    upsert?: PaymentUpsertWithoutAppointmentInput
    disconnect?: PaymentWhereInput | boolean
    delete?: PaymentWhereInput | boolean
    connect?: PaymentWhereUniqueInput
    update?: XOR<XOR<PaymentUpdateToOneWithWhereWithoutAppointmentInput, PaymentUpdateWithoutAppointmentInput>, PaymentUncheckedUpdateWithoutAppointmentInput>
  }

  export type QueueItemUpdateOneWithoutAppointmentNestedInput = {
    create?: XOR<QueueItemCreateWithoutAppointmentInput, QueueItemUncheckedCreateWithoutAppointmentInput>
    connectOrCreate?: QueueItemCreateOrConnectWithoutAppointmentInput
    upsert?: QueueItemUpsertWithoutAppointmentInput
    disconnect?: QueueItemWhereInput | boolean
    delete?: QueueItemWhereInput | boolean
    connect?: QueueItemWhereUniqueInput
    update?: XOR<XOR<QueueItemUpdateToOneWithWhereWithoutAppointmentInput, QueueItemUpdateWithoutAppointmentInput>, QueueItemUncheckedUpdateWithoutAppointmentInput>
  }

  export type PaymentUncheckedUpdateOneWithoutAppointmentNestedInput = {
    create?: XOR<PaymentCreateWithoutAppointmentInput, PaymentUncheckedCreateWithoutAppointmentInput>
    connectOrCreate?: PaymentCreateOrConnectWithoutAppointmentInput
    upsert?: PaymentUpsertWithoutAppointmentInput
    disconnect?: PaymentWhereInput | boolean
    delete?: PaymentWhereInput | boolean
    connect?: PaymentWhereUniqueInput
    update?: XOR<XOR<PaymentUpdateToOneWithWhereWithoutAppointmentInput, PaymentUpdateWithoutAppointmentInput>, PaymentUncheckedUpdateWithoutAppointmentInput>
  }

  export type QueueItemUncheckedUpdateOneWithoutAppointmentNestedInput = {
    create?: XOR<QueueItemCreateWithoutAppointmentInput, QueueItemUncheckedCreateWithoutAppointmentInput>
    connectOrCreate?: QueueItemCreateOrConnectWithoutAppointmentInput
    upsert?: QueueItemUpsertWithoutAppointmentInput
    disconnect?: QueueItemWhereInput | boolean
    delete?: QueueItemWhereInput | boolean
    connect?: QueueItemWhereUniqueInput
    update?: XOR<XOR<QueueItemUpdateToOneWithWhereWithoutAppointmentInput, QueueItemUpdateWithoutAppointmentInput>, QueueItemUncheckedUpdateWithoutAppointmentInput>
  }

  export type AppointmentCreateNestedManyWithoutTherapyInput = {
    create?: XOR<AppointmentCreateWithoutTherapyInput, AppointmentUncheckedCreateWithoutTherapyInput> | AppointmentCreateWithoutTherapyInput[] | AppointmentUncheckedCreateWithoutTherapyInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutTherapyInput | AppointmentCreateOrConnectWithoutTherapyInput[]
    createMany?: AppointmentCreateManyTherapyInputEnvelope
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
  }

  export type AppointmentUncheckedCreateNestedManyWithoutTherapyInput = {
    create?: XOR<AppointmentCreateWithoutTherapyInput, AppointmentUncheckedCreateWithoutTherapyInput> | AppointmentCreateWithoutTherapyInput[] | AppointmentUncheckedCreateWithoutTherapyInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutTherapyInput | AppointmentCreateOrConnectWithoutTherapyInput[]
    createMany?: AppointmentCreateManyTherapyInputEnvelope
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type AppointmentUpdateManyWithoutTherapyNestedInput = {
    create?: XOR<AppointmentCreateWithoutTherapyInput, AppointmentUncheckedCreateWithoutTherapyInput> | AppointmentCreateWithoutTherapyInput[] | AppointmentUncheckedCreateWithoutTherapyInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutTherapyInput | AppointmentCreateOrConnectWithoutTherapyInput[]
    upsert?: AppointmentUpsertWithWhereUniqueWithoutTherapyInput | AppointmentUpsertWithWhereUniqueWithoutTherapyInput[]
    createMany?: AppointmentCreateManyTherapyInputEnvelope
    set?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    disconnect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    delete?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    update?: AppointmentUpdateWithWhereUniqueWithoutTherapyInput | AppointmentUpdateWithWhereUniqueWithoutTherapyInput[]
    updateMany?: AppointmentUpdateManyWithWhereWithoutTherapyInput | AppointmentUpdateManyWithWhereWithoutTherapyInput[]
    deleteMany?: AppointmentScalarWhereInput | AppointmentScalarWhereInput[]
  }

  export type AppointmentUncheckedUpdateManyWithoutTherapyNestedInput = {
    create?: XOR<AppointmentCreateWithoutTherapyInput, AppointmentUncheckedCreateWithoutTherapyInput> | AppointmentCreateWithoutTherapyInput[] | AppointmentUncheckedCreateWithoutTherapyInput[]
    connectOrCreate?: AppointmentCreateOrConnectWithoutTherapyInput | AppointmentCreateOrConnectWithoutTherapyInput[]
    upsert?: AppointmentUpsertWithWhereUniqueWithoutTherapyInput | AppointmentUpsertWithWhereUniqueWithoutTherapyInput[]
    createMany?: AppointmentCreateManyTherapyInputEnvelope
    set?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    disconnect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    delete?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    connect?: AppointmentWhereUniqueInput | AppointmentWhereUniqueInput[]
    update?: AppointmentUpdateWithWhereUniqueWithoutTherapyInput | AppointmentUpdateWithWhereUniqueWithoutTherapyInput[]
    updateMany?: AppointmentUpdateManyWithWhereWithoutTherapyInput | AppointmentUpdateManyWithWhereWithoutTherapyInput[]
    deleteMany?: AppointmentScalarWhereInput | AppointmentScalarWhereInput[]
  }

  export type AppointmentCreateNestedOneWithoutPaymentInput = {
    create?: XOR<AppointmentCreateWithoutPaymentInput, AppointmentUncheckedCreateWithoutPaymentInput>
    connectOrCreate?: AppointmentCreateOrConnectWithoutPaymentInput
    connect?: AppointmentWhereUniqueInput
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type EnumPaymentStatusFieldUpdateOperationsInput = {
    set?: $Enums.PaymentStatus
  }

  export type NullableEnumPaymentMethodFieldUpdateOperationsInput = {
    set?: $Enums.PaymentMethod | null
  }

  export type AppointmentUpdateOneRequiredWithoutPaymentNestedInput = {
    create?: XOR<AppointmentCreateWithoutPaymentInput, AppointmentUncheckedCreateWithoutPaymentInput>
    connectOrCreate?: AppointmentCreateOrConnectWithoutPaymentInput
    upsert?: AppointmentUpsertWithoutPaymentInput
    connect?: AppointmentWhereUniqueInput
    update?: XOR<XOR<AppointmentUpdateToOneWithWhereWithoutPaymentInput, AppointmentUpdateWithoutPaymentInput>, AppointmentUncheckedUpdateWithoutPaymentInput>
  }

  export type AppointmentCreateNestedOneWithoutQueueItemInput = {
    create?: XOR<AppointmentCreateWithoutQueueItemInput, AppointmentUncheckedCreateWithoutQueueItemInput>
    connectOrCreate?: AppointmentCreateOrConnectWithoutQueueItemInput
    connect?: AppointmentWhereUniqueInput
  }

  export type EnumQueueStatusFieldUpdateOperationsInput = {
    set?: $Enums.QueueStatus
  }

  export type AppointmentUpdateOneRequiredWithoutQueueItemNestedInput = {
    create?: XOR<AppointmentCreateWithoutQueueItemInput, AppointmentUncheckedCreateWithoutQueueItemInput>
    connectOrCreate?: AppointmentCreateOrConnectWithoutQueueItemInput
    upsert?: AppointmentUpsertWithoutQueueItemInput
    connect?: AppointmentWhereUniqueInput
    update?: XOR<XOR<AppointmentUpdateToOneWithWhereWithoutQueueItemInput, AppointmentUpdateWithoutQueueItemInput>, AppointmentUncheckedUpdateWithoutQueueItemInput>
  }

  export type DoctorCreateNestedOneWithoutPrescriptionsInput = {
    create?: XOR<DoctorCreateWithoutPrescriptionsInput, DoctorUncheckedCreateWithoutPrescriptionsInput>
    connectOrCreate?: DoctorCreateOrConnectWithoutPrescriptionsInput
    connect?: DoctorWhereUniqueInput
  }

  export type PatientCreateNestedOneWithoutPrescriptionsInput = {
    create?: XOR<PatientCreateWithoutPrescriptionsInput, PatientUncheckedCreateWithoutPrescriptionsInput>
    connectOrCreate?: PatientCreateOrConnectWithoutPrescriptionsInput
    connect?: PatientWhereUniqueInput
  }

  export type PrescriptionItemCreateNestedManyWithoutPrescriptionInput = {
    create?: XOR<PrescriptionItemCreateWithoutPrescriptionInput, PrescriptionItemUncheckedCreateWithoutPrescriptionInput> | PrescriptionItemCreateWithoutPrescriptionInput[] | PrescriptionItemUncheckedCreateWithoutPrescriptionInput[]
    connectOrCreate?: PrescriptionItemCreateOrConnectWithoutPrescriptionInput | PrescriptionItemCreateOrConnectWithoutPrescriptionInput[]
    createMany?: PrescriptionItemCreateManyPrescriptionInputEnvelope
    connect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
  }

  export type PrescriptionItemUncheckedCreateNestedManyWithoutPrescriptionInput = {
    create?: XOR<PrescriptionItemCreateWithoutPrescriptionInput, PrescriptionItemUncheckedCreateWithoutPrescriptionInput> | PrescriptionItemCreateWithoutPrescriptionInput[] | PrescriptionItemUncheckedCreateWithoutPrescriptionInput[]
    connectOrCreate?: PrescriptionItemCreateOrConnectWithoutPrescriptionInput | PrescriptionItemCreateOrConnectWithoutPrescriptionInput[]
    createMany?: PrescriptionItemCreateManyPrescriptionInputEnvelope
    connect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
  }

  export type DoctorUpdateOneRequiredWithoutPrescriptionsNestedInput = {
    create?: XOR<DoctorCreateWithoutPrescriptionsInput, DoctorUncheckedCreateWithoutPrescriptionsInput>
    connectOrCreate?: DoctorCreateOrConnectWithoutPrescriptionsInput
    upsert?: DoctorUpsertWithoutPrescriptionsInput
    connect?: DoctorWhereUniqueInput
    update?: XOR<XOR<DoctorUpdateToOneWithWhereWithoutPrescriptionsInput, DoctorUpdateWithoutPrescriptionsInput>, DoctorUncheckedUpdateWithoutPrescriptionsInput>
  }

  export type PatientUpdateOneRequiredWithoutPrescriptionsNestedInput = {
    create?: XOR<PatientCreateWithoutPrescriptionsInput, PatientUncheckedCreateWithoutPrescriptionsInput>
    connectOrCreate?: PatientCreateOrConnectWithoutPrescriptionsInput
    upsert?: PatientUpsertWithoutPrescriptionsInput
    connect?: PatientWhereUniqueInput
    update?: XOR<XOR<PatientUpdateToOneWithWhereWithoutPrescriptionsInput, PatientUpdateWithoutPrescriptionsInput>, PatientUncheckedUpdateWithoutPrescriptionsInput>
  }

  export type PrescriptionItemUpdateManyWithoutPrescriptionNestedInput = {
    create?: XOR<PrescriptionItemCreateWithoutPrescriptionInput, PrescriptionItemUncheckedCreateWithoutPrescriptionInput> | PrescriptionItemCreateWithoutPrescriptionInput[] | PrescriptionItemUncheckedCreateWithoutPrescriptionInput[]
    connectOrCreate?: PrescriptionItemCreateOrConnectWithoutPrescriptionInput | PrescriptionItemCreateOrConnectWithoutPrescriptionInput[]
    upsert?: PrescriptionItemUpsertWithWhereUniqueWithoutPrescriptionInput | PrescriptionItemUpsertWithWhereUniqueWithoutPrescriptionInput[]
    createMany?: PrescriptionItemCreateManyPrescriptionInputEnvelope
    set?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    disconnect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    delete?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    connect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    update?: PrescriptionItemUpdateWithWhereUniqueWithoutPrescriptionInput | PrescriptionItemUpdateWithWhereUniqueWithoutPrescriptionInput[]
    updateMany?: PrescriptionItemUpdateManyWithWhereWithoutPrescriptionInput | PrescriptionItemUpdateManyWithWhereWithoutPrescriptionInput[]
    deleteMany?: PrescriptionItemScalarWhereInput | PrescriptionItemScalarWhereInput[]
  }

  export type PrescriptionItemUncheckedUpdateManyWithoutPrescriptionNestedInput = {
    create?: XOR<PrescriptionItemCreateWithoutPrescriptionInput, PrescriptionItemUncheckedCreateWithoutPrescriptionInput> | PrescriptionItemCreateWithoutPrescriptionInput[] | PrescriptionItemUncheckedCreateWithoutPrescriptionInput[]
    connectOrCreate?: PrescriptionItemCreateOrConnectWithoutPrescriptionInput | PrescriptionItemCreateOrConnectWithoutPrescriptionInput[]
    upsert?: PrescriptionItemUpsertWithWhereUniqueWithoutPrescriptionInput | PrescriptionItemUpsertWithWhereUniqueWithoutPrescriptionInput[]
    createMany?: PrescriptionItemCreateManyPrescriptionInputEnvelope
    set?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    disconnect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    delete?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    connect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    update?: PrescriptionItemUpdateWithWhereUniqueWithoutPrescriptionInput | PrescriptionItemUpdateWithWhereUniqueWithoutPrescriptionInput[]
    updateMany?: PrescriptionItemUpdateManyWithWhereWithoutPrescriptionInput | PrescriptionItemUpdateManyWithWhereWithoutPrescriptionInput[]
    deleteMany?: PrescriptionItemScalarWhereInput | PrescriptionItemScalarWhereInput[]
  }

  export type MedicineCreateNestedOneWithoutPrescriptionItemsInput = {
    create?: XOR<MedicineCreateWithoutPrescriptionItemsInput, MedicineUncheckedCreateWithoutPrescriptionItemsInput>
    connectOrCreate?: MedicineCreateOrConnectWithoutPrescriptionItemsInput
    connect?: MedicineWhereUniqueInput
  }

  export type PrescriptionCreateNestedOneWithoutItemsInput = {
    create?: XOR<PrescriptionCreateWithoutItemsInput, PrescriptionUncheckedCreateWithoutItemsInput>
    connectOrCreate?: PrescriptionCreateOrConnectWithoutItemsInput
    connect?: PrescriptionWhereUniqueInput
  }

  export type MedicineUpdateOneRequiredWithoutPrescriptionItemsNestedInput = {
    create?: XOR<MedicineCreateWithoutPrescriptionItemsInput, MedicineUncheckedCreateWithoutPrescriptionItemsInput>
    connectOrCreate?: MedicineCreateOrConnectWithoutPrescriptionItemsInput
    upsert?: MedicineUpsertWithoutPrescriptionItemsInput
    connect?: MedicineWhereUniqueInput
    update?: XOR<XOR<MedicineUpdateToOneWithWhereWithoutPrescriptionItemsInput, MedicineUpdateWithoutPrescriptionItemsInput>, MedicineUncheckedUpdateWithoutPrescriptionItemsInput>
  }

  export type PrescriptionUpdateOneRequiredWithoutItemsNestedInput = {
    create?: XOR<PrescriptionCreateWithoutItemsInput, PrescriptionUncheckedCreateWithoutItemsInput>
    connectOrCreate?: PrescriptionCreateOrConnectWithoutItemsInput
    upsert?: PrescriptionUpsertWithoutItemsInput
    connect?: PrescriptionWhereUniqueInput
    update?: XOR<XOR<PrescriptionUpdateToOneWithWhereWithoutItemsInput, PrescriptionUpdateWithoutItemsInput>, PrescriptionUncheckedUpdateWithoutItemsInput>
  }

  export type PrescriptionItemCreateNestedManyWithoutMedicineInput = {
    create?: XOR<PrescriptionItemCreateWithoutMedicineInput, PrescriptionItemUncheckedCreateWithoutMedicineInput> | PrescriptionItemCreateWithoutMedicineInput[] | PrescriptionItemUncheckedCreateWithoutMedicineInput[]
    connectOrCreate?: PrescriptionItemCreateOrConnectWithoutMedicineInput | PrescriptionItemCreateOrConnectWithoutMedicineInput[]
    createMany?: PrescriptionItemCreateManyMedicineInputEnvelope
    connect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
  }

  export type PrescriptionItemUncheckedCreateNestedManyWithoutMedicineInput = {
    create?: XOR<PrescriptionItemCreateWithoutMedicineInput, PrescriptionItemUncheckedCreateWithoutMedicineInput> | PrescriptionItemCreateWithoutMedicineInput[] | PrescriptionItemUncheckedCreateWithoutMedicineInput[]
    connectOrCreate?: PrescriptionItemCreateOrConnectWithoutMedicineInput | PrescriptionItemCreateOrConnectWithoutMedicineInput[]
    createMany?: PrescriptionItemCreateManyMedicineInputEnvelope
    connect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
  }

  export type PrescriptionItemUpdateManyWithoutMedicineNestedInput = {
    create?: XOR<PrescriptionItemCreateWithoutMedicineInput, PrescriptionItemUncheckedCreateWithoutMedicineInput> | PrescriptionItemCreateWithoutMedicineInput[] | PrescriptionItemUncheckedCreateWithoutMedicineInput[]
    connectOrCreate?: PrescriptionItemCreateOrConnectWithoutMedicineInput | PrescriptionItemCreateOrConnectWithoutMedicineInput[]
    upsert?: PrescriptionItemUpsertWithWhereUniqueWithoutMedicineInput | PrescriptionItemUpsertWithWhereUniqueWithoutMedicineInput[]
    createMany?: PrescriptionItemCreateManyMedicineInputEnvelope
    set?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    disconnect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    delete?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    connect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    update?: PrescriptionItemUpdateWithWhereUniqueWithoutMedicineInput | PrescriptionItemUpdateWithWhereUniqueWithoutMedicineInput[]
    updateMany?: PrescriptionItemUpdateManyWithWhereWithoutMedicineInput | PrescriptionItemUpdateManyWithWhereWithoutMedicineInput[]
    deleteMany?: PrescriptionItemScalarWhereInput | PrescriptionItemScalarWhereInput[]
  }

  export type PrescriptionItemUncheckedUpdateManyWithoutMedicineNestedInput = {
    create?: XOR<PrescriptionItemCreateWithoutMedicineInput, PrescriptionItemUncheckedCreateWithoutMedicineInput> | PrescriptionItemCreateWithoutMedicineInput[] | PrescriptionItemUncheckedCreateWithoutMedicineInput[]
    connectOrCreate?: PrescriptionItemCreateOrConnectWithoutMedicineInput | PrescriptionItemCreateOrConnectWithoutMedicineInput[]
    upsert?: PrescriptionItemUpsertWithWhereUniqueWithoutMedicineInput | PrescriptionItemUpsertWithWhereUniqueWithoutMedicineInput[]
    createMany?: PrescriptionItemCreateManyMedicineInputEnvelope
    set?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    disconnect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    delete?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    connect?: PrescriptionItemWhereUniqueInput | PrescriptionItemWhereUniqueInput[]
    update?: PrescriptionItemUpdateWithWhereUniqueWithoutMedicineInput | PrescriptionItemUpdateWithWhereUniqueWithoutMedicineInput[]
    updateMany?: PrescriptionItemUpdateManyWithWhereWithoutMedicineInput | PrescriptionItemUpdateManyWithWhereWithoutMedicineInput[]
    deleteMany?: PrescriptionItemScalarWhereInput | PrescriptionItemScalarWhereInput[]
  }

  export type DoctorCreateNestedOneWithoutHealthRecordsInput = {
    create?: XOR<DoctorCreateWithoutHealthRecordsInput, DoctorUncheckedCreateWithoutHealthRecordsInput>
    connectOrCreate?: DoctorCreateOrConnectWithoutHealthRecordsInput
    connect?: DoctorWhereUniqueInput
  }

  export type PatientCreateNestedOneWithoutHealthRecordsInput = {
    create?: XOR<PatientCreateWithoutHealthRecordsInput, PatientUncheckedCreateWithoutHealthRecordsInput>
    connectOrCreate?: PatientCreateOrConnectWithoutHealthRecordsInput
    connect?: PatientWhereUniqueInput
  }

  export type EnumHealthRecordTypeFieldUpdateOperationsInput = {
    set?: $Enums.HealthRecordType
  }

  export type DoctorUpdateOneRequiredWithoutHealthRecordsNestedInput = {
    create?: XOR<DoctorCreateWithoutHealthRecordsInput, DoctorUncheckedCreateWithoutHealthRecordsInput>
    connectOrCreate?: DoctorCreateOrConnectWithoutHealthRecordsInput
    upsert?: DoctorUpsertWithoutHealthRecordsInput
    connect?: DoctorWhereUniqueInput
    update?: XOR<XOR<DoctorUpdateToOneWithWhereWithoutHealthRecordsInput, DoctorUpdateWithoutHealthRecordsInput>, DoctorUncheckedUpdateWithoutHealthRecordsInput>
  }

  export type PatientUpdateOneRequiredWithoutHealthRecordsNestedInput = {
    create?: XOR<PatientCreateWithoutHealthRecordsInput, PatientUncheckedCreateWithoutHealthRecordsInput>
    connectOrCreate?: PatientCreateOrConnectWithoutHealthRecordsInput
    upsert?: PatientUpsertWithoutHealthRecordsInput
    connect?: PatientWhereUniqueInput
    update?: XOR<XOR<PatientUpdateToOneWithWhereWithoutHealthRecordsInput, PatientUpdateWithoutHealthRecordsInput>, PatientUncheckedUpdateWithoutHealthRecordsInput>
  }

  export type DoctorCreateNestedOneWithoutReviewsInput = {
    create?: XOR<DoctorCreateWithoutReviewsInput, DoctorUncheckedCreateWithoutReviewsInput>
    connectOrCreate?: DoctorCreateOrConnectWithoutReviewsInput
    connect?: DoctorWhereUniqueInput
  }

  export type PatientCreateNestedOneWithoutReviewsInput = {
    create?: XOR<PatientCreateWithoutReviewsInput, PatientUncheckedCreateWithoutReviewsInput>
    connectOrCreate?: PatientCreateOrConnectWithoutReviewsInput
    connect?: PatientWhereUniqueInput
  }

  export type DoctorUpdateOneRequiredWithoutReviewsNestedInput = {
    create?: XOR<DoctorCreateWithoutReviewsInput, DoctorUncheckedCreateWithoutReviewsInput>
    connectOrCreate?: DoctorCreateOrConnectWithoutReviewsInput
    upsert?: DoctorUpsertWithoutReviewsInput
    connect?: DoctorWhereUniqueInput
    update?: XOR<XOR<DoctorUpdateToOneWithWhereWithoutReviewsInput, DoctorUpdateWithoutReviewsInput>, DoctorUncheckedUpdateWithoutReviewsInput>
  }

  export type PatientUpdateOneRequiredWithoutReviewsNestedInput = {
    create?: XOR<PatientCreateWithoutReviewsInput, PatientUncheckedCreateWithoutReviewsInput>
    connectOrCreate?: PatientCreateOrConnectWithoutReviewsInput
    upsert?: PatientUpsertWithoutReviewsInput
    connect?: PatientWhereUniqueInput
    update?: XOR<XOR<PatientUpdateToOneWithWhereWithoutReviewsInput, PatientUpdateWithoutReviewsInput>, PatientUncheckedUpdateWithoutReviewsInput>
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedEnumPrakritiNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.Prakriti | EnumPrakritiFieldRefInput<$PrismaModel> | null
    in?: $Enums.Prakriti[] | ListEnumPrakritiFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Prakriti[] | ListEnumPrakritiFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPrakritiNullableFilter<$PrismaModel> | $Enums.Prakriti | null
  }

  export type NestedEnumDoshaNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.Dosha | EnumDoshaFieldRefInput<$PrismaModel> | null
    in?: $Enums.Dosha[] | ListEnumDoshaFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Dosha[] | ListEnumDoshaFieldRefInput<$PrismaModel> | null
    not?: NestedEnumDoshaNullableFilter<$PrismaModel> | $Enums.Dosha | null
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedEnumPrakritiNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Prakriti | EnumPrakritiFieldRefInput<$PrismaModel> | null
    in?: $Enums.Prakriti[] | ListEnumPrakritiFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Prakriti[] | ListEnumPrakritiFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPrakritiNullableWithAggregatesFilter<$PrismaModel> | $Enums.Prakriti | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumPrakritiNullableFilter<$PrismaModel>
    _max?: NestedEnumPrakritiNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedEnumDoshaNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Dosha | EnumDoshaFieldRefInput<$PrismaModel> | null
    in?: $Enums.Dosha[] | ListEnumDoshaFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.Dosha[] | ListEnumDoshaFieldRefInput<$PrismaModel> | null
    not?: NestedEnumDoshaNullableWithAggregatesFilter<$PrismaModel> | $Enums.Dosha | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumDoshaNullableFilter<$PrismaModel>
    _max?: NestedEnumDoshaNullableFilter<$PrismaModel>
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedFloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }
  export type NestedJsonNullableFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<NestedJsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type NestedEnumAppointmentTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.AppointmentType | EnumAppointmentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AppointmentType[] | ListEnumAppointmentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AppointmentType[] | ListEnumAppointmentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAppointmentTypeFilter<$PrismaModel> | $Enums.AppointmentType
  }

  export type NestedEnumAppointmentStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.AppointmentStatus | EnumAppointmentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.AppointmentStatus[] | ListEnumAppointmentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.AppointmentStatus[] | ListEnumAppointmentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumAppointmentStatusFilter<$PrismaModel> | $Enums.AppointmentStatus
  }

  export type NestedEnumAppointmentTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AppointmentType | EnumAppointmentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AppointmentType[] | ListEnumAppointmentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AppointmentType[] | ListEnumAppointmentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAppointmentTypeWithAggregatesFilter<$PrismaModel> | $Enums.AppointmentType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAppointmentTypeFilter<$PrismaModel>
    _max?: NestedEnumAppointmentTypeFilter<$PrismaModel>
  }

  export type NestedEnumAppointmentStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AppointmentStatus | EnumAppointmentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.AppointmentStatus[] | ListEnumAppointmentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.AppointmentStatus[] | ListEnumAppointmentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumAppointmentStatusWithAggregatesFilter<$PrismaModel> | $Enums.AppointmentStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAppointmentStatusFilter<$PrismaModel>
    _max?: NestedEnumAppointmentStatusFilter<$PrismaModel>
  }

  export type NestedIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type NestedEnumPaymentStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentStatus | EnumPaymentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentStatusFilter<$PrismaModel> | $Enums.PaymentStatus
  }

  export type NestedEnumPaymentMethodNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentMethod | EnumPaymentMethodFieldRefInput<$PrismaModel> | null
    in?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPaymentMethodNullableFilter<$PrismaModel> | $Enums.PaymentMethod | null
  }

  export type NestedFloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type NestedEnumPaymentStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentStatus | EnumPaymentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentStatus[] | ListEnumPaymentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentStatusWithAggregatesFilter<$PrismaModel> | $Enums.PaymentStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPaymentStatusFilter<$PrismaModel>
    _max?: NestedEnumPaymentStatusFilter<$PrismaModel>
  }

  export type NestedEnumPaymentMethodNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentMethod | EnumPaymentMethodFieldRefInput<$PrismaModel> | null
    in?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPaymentMethodNullableWithAggregatesFilter<$PrismaModel> | $Enums.PaymentMethod | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumPaymentMethodNullableFilter<$PrismaModel>
    _max?: NestedEnumPaymentMethodNullableFilter<$PrismaModel>
  }

  export type NestedEnumQueueStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.QueueStatus | EnumQueueStatusFieldRefInput<$PrismaModel>
    in?: $Enums.QueueStatus[] | ListEnumQueueStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.QueueStatus[] | ListEnumQueueStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumQueueStatusFilter<$PrismaModel> | $Enums.QueueStatus
  }

  export type NestedEnumQueueStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.QueueStatus | EnumQueueStatusFieldRefInput<$PrismaModel>
    in?: $Enums.QueueStatus[] | ListEnumQueueStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.QueueStatus[] | ListEnumQueueStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumQueueStatusWithAggregatesFilter<$PrismaModel> | $Enums.QueueStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumQueueStatusFilter<$PrismaModel>
    _max?: NestedEnumQueueStatusFilter<$PrismaModel>
  }

  export type NestedEnumHealthRecordTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.HealthRecordType | EnumHealthRecordTypeFieldRefInput<$PrismaModel>
    in?: $Enums.HealthRecordType[] | ListEnumHealthRecordTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.HealthRecordType[] | ListEnumHealthRecordTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumHealthRecordTypeFilter<$PrismaModel> | $Enums.HealthRecordType
  }

  export type NestedEnumHealthRecordTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.HealthRecordType | EnumHealthRecordTypeFieldRefInput<$PrismaModel>
    in?: $Enums.HealthRecordType[] | ListEnumHealthRecordTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.HealthRecordType[] | ListEnumHealthRecordTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumHealthRecordTypeWithAggregatesFilter<$PrismaModel> | $Enums.HealthRecordType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumHealthRecordTypeFilter<$PrismaModel>
    _max?: NestedEnumHealthRecordTypeFilter<$PrismaModel>
  }

  export type AppointmentCreateWithoutPatientInput = {
    id?: string
    type?: $Enums.AppointmentType
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    doctor: DoctorCreateNestedOneWithoutAppointmentsInput
    location: LocationCreateNestedOneWithoutAppointmentsInput
    therapy?: TherapyCreateNestedOneWithoutAppointmentsInput
    payment?: PaymentCreateNestedOneWithoutAppointmentInput
    queueItem?: QueueItemCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentUncheckedCreateWithoutPatientInput = {
    id?: string
    type?: $Enums.AppointmentType
    doctorId: string
    locationId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    therapyId?: string | null
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    payment?: PaymentUncheckedCreateNestedOneWithoutAppointmentInput
    queueItem?: QueueItemUncheckedCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentCreateOrConnectWithoutPatientInput = {
    where: AppointmentWhereUniqueInput
    create: XOR<AppointmentCreateWithoutPatientInput, AppointmentUncheckedCreateWithoutPatientInput>
  }

  export type AppointmentCreateManyPatientInputEnvelope = {
    data: AppointmentCreateManyPatientInput | AppointmentCreateManyPatientInput[]
    skipDuplicates?: boolean
  }

  export type HealthRecordCreateWithoutPatientInput = {
    id?: string
    recordType: $Enums.HealthRecordType
    report?: string | null
    fileUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    doctor: DoctorCreateNestedOneWithoutHealthRecordsInput
  }

  export type HealthRecordUncheckedCreateWithoutPatientInput = {
    id?: string
    doctorId: string
    recordType: $Enums.HealthRecordType
    report?: string | null
    fileUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type HealthRecordCreateOrConnectWithoutPatientInput = {
    where: HealthRecordWhereUniqueInput
    create: XOR<HealthRecordCreateWithoutPatientInput, HealthRecordUncheckedCreateWithoutPatientInput>
  }

  export type HealthRecordCreateManyPatientInputEnvelope = {
    data: HealthRecordCreateManyPatientInput | HealthRecordCreateManyPatientInput[]
    skipDuplicates?: boolean
  }

  export type PrescriptionCreateWithoutPatientInput = {
    id?: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    doctor: DoctorCreateNestedOneWithoutPrescriptionsInput
    items?: PrescriptionItemCreateNestedManyWithoutPrescriptionInput
  }

  export type PrescriptionUncheckedCreateWithoutPatientInput = {
    id?: string
    doctorId: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    items?: PrescriptionItemUncheckedCreateNestedManyWithoutPrescriptionInput
  }

  export type PrescriptionCreateOrConnectWithoutPatientInput = {
    where: PrescriptionWhereUniqueInput
    create: XOR<PrescriptionCreateWithoutPatientInput, PrescriptionUncheckedCreateWithoutPatientInput>
  }

  export type PrescriptionCreateManyPatientInputEnvelope = {
    data: PrescriptionCreateManyPatientInput | PrescriptionCreateManyPatientInput[]
    skipDuplicates?: boolean
  }

  export type ReviewCreateWithoutPatientInput = {
    id?: string
    rating?: number
    comment?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    doctor: DoctorCreateNestedOneWithoutReviewsInput
  }

  export type ReviewUncheckedCreateWithoutPatientInput = {
    id?: string
    rating?: number
    comment?: string | null
    doctorId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ReviewCreateOrConnectWithoutPatientInput = {
    where: ReviewWhereUniqueInput
    create: XOR<ReviewCreateWithoutPatientInput, ReviewUncheckedCreateWithoutPatientInput>
  }

  export type ReviewCreateManyPatientInputEnvelope = {
    data: ReviewCreateManyPatientInput | ReviewCreateManyPatientInput[]
    skipDuplicates?: boolean
  }

  export type AppointmentUpsertWithWhereUniqueWithoutPatientInput = {
    where: AppointmentWhereUniqueInput
    update: XOR<AppointmentUpdateWithoutPatientInput, AppointmentUncheckedUpdateWithoutPatientInput>
    create: XOR<AppointmentCreateWithoutPatientInput, AppointmentUncheckedCreateWithoutPatientInput>
  }

  export type AppointmentUpdateWithWhereUniqueWithoutPatientInput = {
    where: AppointmentWhereUniqueInput
    data: XOR<AppointmentUpdateWithoutPatientInput, AppointmentUncheckedUpdateWithoutPatientInput>
  }

  export type AppointmentUpdateManyWithWhereWithoutPatientInput = {
    where: AppointmentScalarWhereInput
    data: XOR<AppointmentUpdateManyMutationInput, AppointmentUncheckedUpdateManyWithoutPatientInput>
  }

  export type AppointmentScalarWhereInput = {
    AND?: AppointmentScalarWhereInput | AppointmentScalarWhereInput[]
    OR?: AppointmentScalarWhereInput[]
    NOT?: AppointmentScalarWhereInput | AppointmentScalarWhereInput[]
    id?: StringFilter<"Appointment"> | string
    type?: EnumAppointmentTypeFilter<"Appointment"> | $Enums.AppointmentType
    doctorId?: StringFilter<"Appointment"> | string
    patientId?: StringFilter<"Appointment"> | string
    locationId?: StringFilter<"Appointment"> | string
    date?: DateTimeFilter<"Appointment"> | Date | string
    time?: StringFilter<"Appointment"> | string
    duration?: IntFilter<"Appointment"> | number
    status?: EnumAppointmentStatusFilter<"Appointment"> | $Enums.AppointmentStatus
    notes?: StringNullableFilter<"Appointment"> | string | null
    createdAt?: DateTimeFilter<"Appointment"> | Date | string
    updatedAt?: DateTimeFilter<"Appointment"> | Date | string
    therapyId?: StringNullableFilter<"Appointment"> | string | null
    startedAt?: DateTimeNullableFilter<"Appointment"> | Date | string | null
    checkedInAt?: DateTimeNullableFilter<"Appointment"> | Date | string | null
    completedAt?: DateTimeNullableFilter<"Appointment"> | Date | string | null
  }

  export type HealthRecordUpsertWithWhereUniqueWithoutPatientInput = {
    where: HealthRecordWhereUniqueInput
    update: XOR<HealthRecordUpdateWithoutPatientInput, HealthRecordUncheckedUpdateWithoutPatientInput>
    create: XOR<HealthRecordCreateWithoutPatientInput, HealthRecordUncheckedCreateWithoutPatientInput>
  }

  export type HealthRecordUpdateWithWhereUniqueWithoutPatientInput = {
    where: HealthRecordWhereUniqueInput
    data: XOR<HealthRecordUpdateWithoutPatientInput, HealthRecordUncheckedUpdateWithoutPatientInput>
  }

  export type HealthRecordUpdateManyWithWhereWithoutPatientInput = {
    where: HealthRecordScalarWhereInput
    data: XOR<HealthRecordUpdateManyMutationInput, HealthRecordUncheckedUpdateManyWithoutPatientInput>
  }

  export type HealthRecordScalarWhereInput = {
    AND?: HealthRecordScalarWhereInput | HealthRecordScalarWhereInput[]
    OR?: HealthRecordScalarWhereInput[]
    NOT?: HealthRecordScalarWhereInput | HealthRecordScalarWhereInput[]
    id?: StringFilter<"HealthRecord"> | string
    patientId?: StringFilter<"HealthRecord"> | string
    doctorId?: StringFilter<"HealthRecord"> | string
    recordType?: EnumHealthRecordTypeFilter<"HealthRecord"> | $Enums.HealthRecordType
    report?: StringNullableFilter<"HealthRecord"> | string | null
    fileUrl?: StringNullableFilter<"HealthRecord"> | string | null
    createdAt?: DateTimeFilter<"HealthRecord"> | Date | string
    updatedAt?: DateTimeFilter<"HealthRecord"> | Date | string
  }

  export type PrescriptionUpsertWithWhereUniqueWithoutPatientInput = {
    where: PrescriptionWhereUniqueInput
    update: XOR<PrescriptionUpdateWithoutPatientInput, PrescriptionUncheckedUpdateWithoutPatientInput>
    create: XOR<PrescriptionCreateWithoutPatientInput, PrescriptionUncheckedCreateWithoutPatientInput>
  }

  export type PrescriptionUpdateWithWhereUniqueWithoutPatientInput = {
    where: PrescriptionWhereUniqueInput
    data: XOR<PrescriptionUpdateWithoutPatientInput, PrescriptionUncheckedUpdateWithoutPatientInput>
  }

  export type PrescriptionUpdateManyWithWhereWithoutPatientInput = {
    where: PrescriptionScalarWhereInput
    data: XOR<PrescriptionUpdateManyMutationInput, PrescriptionUncheckedUpdateManyWithoutPatientInput>
  }

  export type PrescriptionScalarWhereInput = {
    AND?: PrescriptionScalarWhereInput | PrescriptionScalarWhereInput[]
    OR?: PrescriptionScalarWhereInput[]
    NOT?: PrescriptionScalarWhereInput | PrescriptionScalarWhereInput[]
    id?: StringFilter<"Prescription"> | string
    patientId?: StringFilter<"Prescription"> | string
    doctorId?: StringFilter<"Prescription"> | string
    date?: DateTimeFilter<"Prescription"> | Date | string
    notes?: StringNullableFilter<"Prescription"> | string | null
    createdAt?: DateTimeFilter<"Prescription"> | Date | string
    updatedAt?: DateTimeFilter<"Prescription"> | Date | string
  }

  export type ReviewUpsertWithWhereUniqueWithoutPatientInput = {
    where: ReviewWhereUniqueInput
    update: XOR<ReviewUpdateWithoutPatientInput, ReviewUncheckedUpdateWithoutPatientInput>
    create: XOR<ReviewCreateWithoutPatientInput, ReviewUncheckedCreateWithoutPatientInput>
  }

  export type ReviewUpdateWithWhereUniqueWithoutPatientInput = {
    where: ReviewWhereUniqueInput
    data: XOR<ReviewUpdateWithoutPatientInput, ReviewUncheckedUpdateWithoutPatientInput>
  }

  export type ReviewUpdateManyWithWhereWithoutPatientInput = {
    where: ReviewScalarWhereInput
    data: XOR<ReviewUpdateManyMutationInput, ReviewUncheckedUpdateManyWithoutPatientInput>
  }

  export type ReviewScalarWhereInput = {
    AND?: ReviewScalarWhereInput | ReviewScalarWhereInput[]
    OR?: ReviewScalarWhereInput[]
    NOT?: ReviewScalarWhereInput | ReviewScalarWhereInput[]
    id?: StringFilter<"Review"> | string
    rating?: IntFilter<"Review"> | number
    comment?: StringNullableFilter<"Review"> | string | null
    patientId?: StringFilter<"Review"> | string
    doctorId?: StringFilter<"Review"> | string
    createdAt?: DateTimeFilter<"Review"> | Date | string
    updatedAt?: DateTimeFilter<"Review"> | Date | string
  }

  export type AppointmentCreateWithoutDoctorInput = {
    id?: string
    type?: $Enums.AppointmentType
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    patient: PatientCreateNestedOneWithoutAppointmentsInput
    location: LocationCreateNestedOneWithoutAppointmentsInput
    therapy?: TherapyCreateNestedOneWithoutAppointmentsInput
    payment?: PaymentCreateNestedOneWithoutAppointmentInput
    queueItem?: QueueItemCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentUncheckedCreateWithoutDoctorInput = {
    id?: string
    type?: $Enums.AppointmentType
    patientId: string
    locationId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    therapyId?: string | null
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    payment?: PaymentUncheckedCreateNestedOneWithoutAppointmentInput
    queueItem?: QueueItemUncheckedCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentCreateOrConnectWithoutDoctorInput = {
    where: AppointmentWhereUniqueInput
    create: XOR<AppointmentCreateWithoutDoctorInput, AppointmentUncheckedCreateWithoutDoctorInput>
  }

  export type AppointmentCreateManyDoctorInputEnvelope = {
    data: AppointmentCreateManyDoctorInput | AppointmentCreateManyDoctorInput[]
    skipDuplicates?: boolean
  }

  export type HealthRecordCreateWithoutDoctorInput = {
    id?: string
    recordType: $Enums.HealthRecordType
    report?: string | null
    fileUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    patient: PatientCreateNestedOneWithoutHealthRecordsInput
  }

  export type HealthRecordUncheckedCreateWithoutDoctorInput = {
    id?: string
    patientId: string
    recordType: $Enums.HealthRecordType
    report?: string | null
    fileUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type HealthRecordCreateOrConnectWithoutDoctorInput = {
    where: HealthRecordWhereUniqueInput
    create: XOR<HealthRecordCreateWithoutDoctorInput, HealthRecordUncheckedCreateWithoutDoctorInput>
  }

  export type HealthRecordCreateManyDoctorInputEnvelope = {
    data: HealthRecordCreateManyDoctorInput | HealthRecordCreateManyDoctorInput[]
    skipDuplicates?: boolean
  }

  export type PrescriptionCreateWithoutDoctorInput = {
    id?: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    patient: PatientCreateNestedOneWithoutPrescriptionsInput
    items?: PrescriptionItemCreateNestedManyWithoutPrescriptionInput
  }

  export type PrescriptionUncheckedCreateWithoutDoctorInput = {
    id?: string
    patientId: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    items?: PrescriptionItemUncheckedCreateNestedManyWithoutPrescriptionInput
  }

  export type PrescriptionCreateOrConnectWithoutDoctorInput = {
    where: PrescriptionWhereUniqueInput
    create: XOR<PrescriptionCreateWithoutDoctorInput, PrescriptionUncheckedCreateWithoutDoctorInput>
  }

  export type PrescriptionCreateManyDoctorInputEnvelope = {
    data: PrescriptionCreateManyDoctorInput | PrescriptionCreateManyDoctorInput[]
    skipDuplicates?: boolean
  }

  export type ReviewCreateWithoutDoctorInput = {
    id?: string
    rating?: number
    comment?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    patient: PatientCreateNestedOneWithoutReviewsInput
  }

  export type ReviewUncheckedCreateWithoutDoctorInput = {
    id?: string
    rating?: number
    comment?: string | null
    patientId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ReviewCreateOrConnectWithoutDoctorInput = {
    where: ReviewWhereUniqueInput
    create: XOR<ReviewCreateWithoutDoctorInput, ReviewUncheckedCreateWithoutDoctorInput>
  }

  export type ReviewCreateManyDoctorInputEnvelope = {
    data: ReviewCreateManyDoctorInput | ReviewCreateManyDoctorInput[]
    skipDuplicates?: boolean
  }

  export type DoctorLocationCreateWithoutDoctorInput = {
    startTime?: Date | string | null
    endTime?: Date | string | null
    location: LocationCreateNestedOneWithoutDoctorsInput
  }

  export type DoctorLocationUncheckedCreateWithoutDoctorInput = {
    locationId: string
    startTime?: Date | string | null
    endTime?: Date | string | null
  }

  export type DoctorLocationCreateOrConnectWithoutDoctorInput = {
    where: DoctorLocationWhereUniqueInput
    create: XOR<DoctorLocationCreateWithoutDoctorInput, DoctorLocationUncheckedCreateWithoutDoctorInput>
  }

  export type DoctorLocationCreateManyDoctorInputEnvelope = {
    data: DoctorLocationCreateManyDoctorInput | DoctorLocationCreateManyDoctorInput[]
    skipDuplicates?: boolean
  }

  export type AppointmentUpsertWithWhereUniqueWithoutDoctorInput = {
    where: AppointmentWhereUniqueInput
    update: XOR<AppointmentUpdateWithoutDoctorInput, AppointmentUncheckedUpdateWithoutDoctorInput>
    create: XOR<AppointmentCreateWithoutDoctorInput, AppointmentUncheckedCreateWithoutDoctorInput>
  }

  export type AppointmentUpdateWithWhereUniqueWithoutDoctorInput = {
    where: AppointmentWhereUniqueInput
    data: XOR<AppointmentUpdateWithoutDoctorInput, AppointmentUncheckedUpdateWithoutDoctorInput>
  }

  export type AppointmentUpdateManyWithWhereWithoutDoctorInput = {
    where: AppointmentScalarWhereInput
    data: XOR<AppointmentUpdateManyMutationInput, AppointmentUncheckedUpdateManyWithoutDoctorInput>
  }

  export type HealthRecordUpsertWithWhereUniqueWithoutDoctorInput = {
    where: HealthRecordWhereUniqueInput
    update: XOR<HealthRecordUpdateWithoutDoctorInput, HealthRecordUncheckedUpdateWithoutDoctorInput>
    create: XOR<HealthRecordCreateWithoutDoctorInput, HealthRecordUncheckedCreateWithoutDoctorInput>
  }

  export type HealthRecordUpdateWithWhereUniqueWithoutDoctorInput = {
    where: HealthRecordWhereUniqueInput
    data: XOR<HealthRecordUpdateWithoutDoctorInput, HealthRecordUncheckedUpdateWithoutDoctorInput>
  }

  export type HealthRecordUpdateManyWithWhereWithoutDoctorInput = {
    where: HealthRecordScalarWhereInput
    data: XOR<HealthRecordUpdateManyMutationInput, HealthRecordUncheckedUpdateManyWithoutDoctorInput>
  }

  export type PrescriptionUpsertWithWhereUniqueWithoutDoctorInput = {
    where: PrescriptionWhereUniqueInput
    update: XOR<PrescriptionUpdateWithoutDoctorInput, PrescriptionUncheckedUpdateWithoutDoctorInput>
    create: XOR<PrescriptionCreateWithoutDoctorInput, PrescriptionUncheckedCreateWithoutDoctorInput>
  }

  export type PrescriptionUpdateWithWhereUniqueWithoutDoctorInput = {
    where: PrescriptionWhereUniqueInput
    data: XOR<PrescriptionUpdateWithoutDoctorInput, PrescriptionUncheckedUpdateWithoutDoctorInput>
  }

  export type PrescriptionUpdateManyWithWhereWithoutDoctorInput = {
    where: PrescriptionScalarWhereInput
    data: XOR<PrescriptionUpdateManyMutationInput, PrescriptionUncheckedUpdateManyWithoutDoctorInput>
  }

  export type ReviewUpsertWithWhereUniqueWithoutDoctorInput = {
    where: ReviewWhereUniqueInput
    update: XOR<ReviewUpdateWithoutDoctorInput, ReviewUncheckedUpdateWithoutDoctorInput>
    create: XOR<ReviewCreateWithoutDoctorInput, ReviewUncheckedCreateWithoutDoctorInput>
  }

  export type ReviewUpdateWithWhereUniqueWithoutDoctorInput = {
    where: ReviewWhereUniqueInput
    data: XOR<ReviewUpdateWithoutDoctorInput, ReviewUncheckedUpdateWithoutDoctorInput>
  }

  export type ReviewUpdateManyWithWhereWithoutDoctorInput = {
    where: ReviewScalarWhereInput
    data: XOR<ReviewUpdateManyMutationInput, ReviewUncheckedUpdateManyWithoutDoctorInput>
  }

  export type DoctorLocationUpsertWithWhereUniqueWithoutDoctorInput = {
    where: DoctorLocationWhereUniqueInput
    update: XOR<DoctorLocationUpdateWithoutDoctorInput, DoctorLocationUncheckedUpdateWithoutDoctorInput>
    create: XOR<DoctorLocationCreateWithoutDoctorInput, DoctorLocationUncheckedCreateWithoutDoctorInput>
  }

  export type DoctorLocationUpdateWithWhereUniqueWithoutDoctorInput = {
    where: DoctorLocationWhereUniqueInput
    data: XOR<DoctorLocationUpdateWithoutDoctorInput, DoctorLocationUncheckedUpdateWithoutDoctorInput>
  }

  export type DoctorLocationUpdateManyWithWhereWithoutDoctorInput = {
    where: DoctorLocationScalarWhereInput
    data: XOR<DoctorLocationUpdateManyMutationInput, DoctorLocationUncheckedUpdateManyWithoutDoctorInput>
  }

  export type DoctorLocationScalarWhereInput = {
    AND?: DoctorLocationScalarWhereInput | DoctorLocationScalarWhereInput[]
    OR?: DoctorLocationScalarWhereInput[]
    NOT?: DoctorLocationScalarWhereInput | DoctorLocationScalarWhereInput[]
    doctorId?: StringFilter<"DoctorLocation"> | string
    locationId?: StringFilter<"DoctorLocation"> | string
    startTime?: DateTimeNullableFilter<"DoctorLocation"> | Date | string | null
    endTime?: DateTimeNullableFilter<"DoctorLocation"> | Date | string | null
  }

  export type DoctorCreateWithoutLocationsInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentCreateNestedManyWithoutDoctorInput
    healthRecords?: HealthRecordCreateNestedManyWithoutDoctorInput
    prescriptions?: PrescriptionCreateNestedManyWithoutDoctorInput
    reviews?: ReviewCreateNestedManyWithoutDoctorInput
  }

  export type DoctorUncheckedCreateWithoutLocationsInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentUncheckedCreateNestedManyWithoutDoctorInput
    healthRecords?: HealthRecordUncheckedCreateNestedManyWithoutDoctorInput
    prescriptions?: PrescriptionUncheckedCreateNestedManyWithoutDoctorInput
    reviews?: ReviewUncheckedCreateNestedManyWithoutDoctorInput
  }

  export type DoctorCreateOrConnectWithoutLocationsInput = {
    where: DoctorWhereUniqueInput
    create: XOR<DoctorCreateWithoutLocationsInput, DoctorUncheckedCreateWithoutLocationsInput>
  }

  export type LocationCreateWithoutDoctorsInput = {
    id?: string
    name: string
    address: string
    city: string
    state: string
    country: string
    zipCode: string
    phone?: string | null
    email?: string | null
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    latitude?: number | null
    longitude?: number | null
    timezone?: string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    appointments?: AppointmentCreateNestedManyWithoutLocationInput
  }

  export type LocationUncheckedCreateWithoutDoctorsInput = {
    id?: string
    name: string
    address: string
    city: string
    state: string
    country: string
    zipCode: string
    phone?: string | null
    email?: string | null
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    latitude?: number | null
    longitude?: number | null
    timezone?: string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    appointments?: AppointmentUncheckedCreateNestedManyWithoutLocationInput
  }

  export type LocationCreateOrConnectWithoutDoctorsInput = {
    where: LocationWhereUniqueInput
    create: XOR<LocationCreateWithoutDoctorsInput, LocationUncheckedCreateWithoutDoctorsInput>
  }

  export type DoctorUpsertWithoutLocationsInput = {
    update: XOR<DoctorUpdateWithoutLocationsInput, DoctorUncheckedUpdateWithoutLocationsInput>
    create: XOR<DoctorCreateWithoutLocationsInput, DoctorUncheckedCreateWithoutLocationsInput>
    where?: DoctorWhereInput
  }

  export type DoctorUpdateToOneWithWhereWithoutLocationsInput = {
    where?: DoctorWhereInput
    data: XOR<DoctorUpdateWithoutLocationsInput, DoctorUncheckedUpdateWithoutLocationsInput>
  }

  export type DoctorUpdateWithoutLocationsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUpdateManyWithoutDoctorNestedInput
    healthRecords?: HealthRecordUpdateManyWithoutDoctorNestedInput
    prescriptions?: PrescriptionUpdateManyWithoutDoctorNestedInput
    reviews?: ReviewUpdateManyWithoutDoctorNestedInput
  }

  export type DoctorUncheckedUpdateWithoutLocationsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUncheckedUpdateManyWithoutDoctorNestedInput
    healthRecords?: HealthRecordUncheckedUpdateManyWithoutDoctorNestedInput
    prescriptions?: PrescriptionUncheckedUpdateManyWithoutDoctorNestedInput
    reviews?: ReviewUncheckedUpdateManyWithoutDoctorNestedInput
  }

  export type LocationUpsertWithoutDoctorsInput = {
    update: XOR<LocationUpdateWithoutDoctorsInput, LocationUncheckedUpdateWithoutDoctorsInput>
    create: XOR<LocationCreateWithoutDoctorsInput, LocationUncheckedCreateWithoutDoctorsInput>
    where?: LocationWhereInput
  }

  export type LocationUpdateToOneWithWhereWithoutDoctorsInput = {
    where?: LocationWhereInput
    data: XOR<LocationUpdateWithoutDoctorsInput, LocationUncheckedUpdateWithoutDoctorsInput>
  }

  export type LocationUpdateWithoutDoctorsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    address?: StringFieldUpdateOperationsInput | string
    city?: StringFieldUpdateOperationsInput | string
    state?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    isActive?: BoolFieldUpdateOperationsInput | boolean
    isMainBranch?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    latitude?: NullableFloatFieldUpdateOperationsInput | number | null
    longitude?: NullableFloatFieldUpdateOperationsInput | number | null
    timezone?: StringFieldUpdateOperationsInput | string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    appointments?: AppointmentUpdateManyWithoutLocationNestedInput
  }

  export type LocationUncheckedUpdateWithoutDoctorsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    address?: StringFieldUpdateOperationsInput | string
    city?: StringFieldUpdateOperationsInput | string
    state?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    isActive?: BoolFieldUpdateOperationsInput | boolean
    isMainBranch?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    latitude?: NullableFloatFieldUpdateOperationsInput | number | null
    longitude?: NullableFloatFieldUpdateOperationsInput | number | null
    timezone?: StringFieldUpdateOperationsInput | string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    appointments?: AppointmentUncheckedUpdateManyWithoutLocationNestedInput
  }

  export type AppointmentCreateWithoutLocationInput = {
    id?: string
    type?: $Enums.AppointmentType
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    doctor: DoctorCreateNestedOneWithoutAppointmentsInput
    patient: PatientCreateNestedOneWithoutAppointmentsInput
    therapy?: TherapyCreateNestedOneWithoutAppointmentsInput
    payment?: PaymentCreateNestedOneWithoutAppointmentInput
    queueItem?: QueueItemCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentUncheckedCreateWithoutLocationInput = {
    id?: string
    type?: $Enums.AppointmentType
    doctorId: string
    patientId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    therapyId?: string | null
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    payment?: PaymentUncheckedCreateNestedOneWithoutAppointmentInput
    queueItem?: QueueItemUncheckedCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentCreateOrConnectWithoutLocationInput = {
    where: AppointmentWhereUniqueInput
    create: XOR<AppointmentCreateWithoutLocationInput, AppointmentUncheckedCreateWithoutLocationInput>
  }

  export type AppointmentCreateManyLocationInputEnvelope = {
    data: AppointmentCreateManyLocationInput | AppointmentCreateManyLocationInput[]
    skipDuplicates?: boolean
  }

  export type DoctorLocationCreateWithoutLocationInput = {
    startTime?: Date | string | null
    endTime?: Date | string | null
    doctor: DoctorCreateNestedOneWithoutLocationsInput
  }

  export type DoctorLocationUncheckedCreateWithoutLocationInput = {
    doctorId: string
    startTime?: Date | string | null
    endTime?: Date | string | null
  }

  export type DoctorLocationCreateOrConnectWithoutLocationInput = {
    where: DoctorLocationWhereUniqueInput
    create: XOR<DoctorLocationCreateWithoutLocationInput, DoctorLocationUncheckedCreateWithoutLocationInput>
  }

  export type DoctorLocationCreateManyLocationInputEnvelope = {
    data: DoctorLocationCreateManyLocationInput | DoctorLocationCreateManyLocationInput[]
    skipDuplicates?: boolean
  }

  export type AppointmentUpsertWithWhereUniqueWithoutLocationInput = {
    where: AppointmentWhereUniqueInput
    update: XOR<AppointmentUpdateWithoutLocationInput, AppointmentUncheckedUpdateWithoutLocationInput>
    create: XOR<AppointmentCreateWithoutLocationInput, AppointmentUncheckedCreateWithoutLocationInput>
  }

  export type AppointmentUpdateWithWhereUniqueWithoutLocationInput = {
    where: AppointmentWhereUniqueInput
    data: XOR<AppointmentUpdateWithoutLocationInput, AppointmentUncheckedUpdateWithoutLocationInput>
  }

  export type AppointmentUpdateManyWithWhereWithoutLocationInput = {
    where: AppointmentScalarWhereInput
    data: XOR<AppointmentUpdateManyMutationInput, AppointmentUncheckedUpdateManyWithoutLocationInput>
  }

  export type DoctorLocationUpsertWithWhereUniqueWithoutLocationInput = {
    where: DoctorLocationWhereUniqueInput
    update: XOR<DoctorLocationUpdateWithoutLocationInput, DoctorLocationUncheckedUpdateWithoutLocationInput>
    create: XOR<DoctorLocationCreateWithoutLocationInput, DoctorLocationUncheckedCreateWithoutLocationInput>
  }

  export type DoctorLocationUpdateWithWhereUniqueWithoutLocationInput = {
    where: DoctorLocationWhereUniqueInput
    data: XOR<DoctorLocationUpdateWithoutLocationInput, DoctorLocationUncheckedUpdateWithoutLocationInput>
  }

  export type DoctorLocationUpdateManyWithWhereWithoutLocationInput = {
    where: DoctorLocationScalarWhereInput
    data: XOR<DoctorLocationUpdateManyMutationInput, DoctorLocationUncheckedUpdateManyWithoutLocationInput>
  }

  export type DoctorCreateWithoutAppointmentsInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    healthRecords?: HealthRecordCreateNestedManyWithoutDoctorInput
    prescriptions?: PrescriptionCreateNestedManyWithoutDoctorInput
    reviews?: ReviewCreateNestedManyWithoutDoctorInput
    locations?: DoctorLocationCreateNestedManyWithoutDoctorInput
  }

  export type DoctorUncheckedCreateWithoutAppointmentsInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    healthRecords?: HealthRecordUncheckedCreateNestedManyWithoutDoctorInput
    prescriptions?: PrescriptionUncheckedCreateNestedManyWithoutDoctorInput
    reviews?: ReviewUncheckedCreateNestedManyWithoutDoctorInput
    locations?: DoctorLocationUncheckedCreateNestedManyWithoutDoctorInput
  }

  export type DoctorCreateOrConnectWithoutAppointmentsInput = {
    where: DoctorWhereUniqueInput
    create: XOR<DoctorCreateWithoutAppointmentsInput, DoctorUncheckedCreateWithoutAppointmentsInput>
  }

  export type PatientCreateWithoutAppointmentsInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    healthRecords?: HealthRecordCreateNestedManyWithoutPatientInput
    prescriptions?: PrescriptionCreateNestedManyWithoutPatientInput
    reviews?: ReviewCreateNestedManyWithoutPatientInput
  }

  export type PatientUncheckedCreateWithoutAppointmentsInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    healthRecords?: HealthRecordUncheckedCreateNestedManyWithoutPatientInput
    prescriptions?: PrescriptionUncheckedCreateNestedManyWithoutPatientInput
    reviews?: ReviewUncheckedCreateNestedManyWithoutPatientInput
  }

  export type PatientCreateOrConnectWithoutAppointmentsInput = {
    where: PatientWhereUniqueInput
    create: XOR<PatientCreateWithoutAppointmentsInput, PatientUncheckedCreateWithoutAppointmentsInput>
  }

  export type LocationCreateWithoutAppointmentsInput = {
    id?: string
    name: string
    address: string
    city: string
    state: string
    country: string
    zipCode: string
    phone?: string | null
    email?: string | null
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    latitude?: number | null
    longitude?: number | null
    timezone?: string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    doctors?: DoctorLocationCreateNestedManyWithoutLocationInput
  }

  export type LocationUncheckedCreateWithoutAppointmentsInput = {
    id?: string
    name: string
    address: string
    city: string
    state: string
    country: string
    zipCode: string
    phone?: string | null
    email?: string | null
    isActive?: boolean
    isMainBranch?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    latitude?: number | null
    longitude?: number | null
    timezone?: string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    doctors?: DoctorLocationUncheckedCreateNestedManyWithoutLocationInput
  }

  export type LocationCreateOrConnectWithoutAppointmentsInput = {
    where: LocationWhereUniqueInput
    create: XOR<LocationCreateWithoutAppointmentsInput, LocationUncheckedCreateWithoutAppointmentsInput>
  }

  export type TherapyCreateWithoutAppointmentsInput = {
    id?: string
    name: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TherapyUncheckedCreateWithoutAppointmentsInput = {
    id?: string
    name: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TherapyCreateOrConnectWithoutAppointmentsInput = {
    where: TherapyWhereUniqueInput
    create: XOR<TherapyCreateWithoutAppointmentsInput, TherapyUncheckedCreateWithoutAppointmentsInput>
  }

  export type PaymentCreateWithoutAppointmentInput = {
    id?: string
    amount: number
    status?: $Enums.PaymentStatus
    method?: $Enums.PaymentMethod | null
    transactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PaymentUncheckedCreateWithoutAppointmentInput = {
    id?: string
    amount: number
    status?: $Enums.PaymentStatus
    method?: $Enums.PaymentMethod | null
    transactionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PaymentCreateOrConnectWithoutAppointmentInput = {
    where: PaymentWhereUniqueInput
    create: XOR<PaymentCreateWithoutAppointmentInput, PaymentUncheckedCreateWithoutAppointmentInput>
  }

  export type QueueItemCreateWithoutAppointmentInput = {
    id?: string
    queueNumber: number
    estimatedWaitTime?: number | null
    status?: $Enums.QueueStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type QueueItemUncheckedCreateWithoutAppointmentInput = {
    id?: string
    queueNumber: number
    estimatedWaitTime?: number | null
    status?: $Enums.QueueStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type QueueItemCreateOrConnectWithoutAppointmentInput = {
    where: QueueItemWhereUniqueInput
    create: XOR<QueueItemCreateWithoutAppointmentInput, QueueItemUncheckedCreateWithoutAppointmentInput>
  }

  export type DoctorUpsertWithoutAppointmentsInput = {
    update: XOR<DoctorUpdateWithoutAppointmentsInput, DoctorUncheckedUpdateWithoutAppointmentsInput>
    create: XOR<DoctorCreateWithoutAppointmentsInput, DoctorUncheckedCreateWithoutAppointmentsInput>
    where?: DoctorWhereInput
  }

  export type DoctorUpdateToOneWithWhereWithoutAppointmentsInput = {
    where?: DoctorWhereInput
    data: XOR<DoctorUpdateWithoutAppointmentsInput, DoctorUncheckedUpdateWithoutAppointmentsInput>
  }

  export type DoctorUpdateWithoutAppointmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    healthRecords?: HealthRecordUpdateManyWithoutDoctorNestedInput
    prescriptions?: PrescriptionUpdateManyWithoutDoctorNestedInput
    reviews?: ReviewUpdateManyWithoutDoctorNestedInput
    locations?: DoctorLocationUpdateManyWithoutDoctorNestedInput
  }

  export type DoctorUncheckedUpdateWithoutAppointmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    healthRecords?: HealthRecordUncheckedUpdateManyWithoutDoctorNestedInput
    prescriptions?: PrescriptionUncheckedUpdateManyWithoutDoctorNestedInput
    reviews?: ReviewUncheckedUpdateManyWithoutDoctorNestedInput
    locations?: DoctorLocationUncheckedUpdateManyWithoutDoctorNestedInput
  }

  export type PatientUpsertWithoutAppointmentsInput = {
    update: XOR<PatientUpdateWithoutAppointmentsInput, PatientUncheckedUpdateWithoutAppointmentsInput>
    create: XOR<PatientCreateWithoutAppointmentsInput, PatientUncheckedCreateWithoutAppointmentsInput>
    where?: PatientWhereInput
  }

  export type PatientUpdateToOneWithWhereWithoutAppointmentsInput = {
    where?: PatientWhereInput
    data: XOR<PatientUpdateWithoutAppointmentsInput, PatientUncheckedUpdateWithoutAppointmentsInput>
  }

  export type PatientUpdateWithoutAppointmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    healthRecords?: HealthRecordUpdateManyWithoutPatientNestedInput
    prescriptions?: PrescriptionUpdateManyWithoutPatientNestedInput
    reviews?: ReviewUpdateManyWithoutPatientNestedInput
  }

  export type PatientUncheckedUpdateWithoutAppointmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    healthRecords?: HealthRecordUncheckedUpdateManyWithoutPatientNestedInput
    prescriptions?: PrescriptionUncheckedUpdateManyWithoutPatientNestedInput
    reviews?: ReviewUncheckedUpdateManyWithoutPatientNestedInput
  }

  export type LocationUpsertWithoutAppointmentsInput = {
    update: XOR<LocationUpdateWithoutAppointmentsInput, LocationUncheckedUpdateWithoutAppointmentsInput>
    create: XOR<LocationCreateWithoutAppointmentsInput, LocationUncheckedCreateWithoutAppointmentsInput>
    where?: LocationWhereInput
  }

  export type LocationUpdateToOneWithWhereWithoutAppointmentsInput = {
    where?: LocationWhereInput
    data: XOR<LocationUpdateWithoutAppointmentsInput, LocationUncheckedUpdateWithoutAppointmentsInput>
  }

  export type LocationUpdateWithoutAppointmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    address?: StringFieldUpdateOperationsInput | string
    city?: StringFieldUpdateOperationsInput | string
    state?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    isActive?: BoolFieldUpdateOperationsInput | boolean
    isMainBranch?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    latitude?: NullableFloatFieldUpdateOperationsInput | number | null
    longitude?: NullableFloatFieldUpdateOperationsInput | number | null
    timezone?: StringFieldUpdateOperationsInput | string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    doctors?: DoctorLocationUpdateManyWithoutLocationNestedInput
  }

  export type LocationUncheckedUpdateWithoutAppointmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    address?: StringFieldUpdateOperationsInput | string
    city?: StringFieldUpdateOperationsInput | string
    state?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    isActive?: BoolFieldUpdateOperationsInput | boolean
    isMainBranch?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    latitude?: NullableFloatFieldUpdateOperationsInput | number | null
    longitude?: NullableFloatFieldUpdateOperationsInput | number | null
    timezone?: StringFieldUpdateOperationsInput | string
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    doctors?: DoctorLocationUncheckedUpdateManyWithoutLocationNestedInput
  }

  export type TherapyUpsertWithoutAppointmentsInput = {
    update: XOR<TherapyUpdateWithoutAppointmentsInput, TherapyUncheckedUpdateWithoutAppointmentsInput>
    create: XOR<TherapyCreateWithoutAppointmentsInput, TherapyUncheckedCreateWithoutAppointmentsInput>
    where?: TherapyWhereInput
  }

  export type TherapyUpdateToOneWithWhereWithoutAppointmentsInput = {
    where?: TherapyWhereInput
    data: XOR<TherapyUpdateWithoutAppointmentsInput, TherapyUncheckedUpdateWithoutAppointmentsInput>
  }

  export type TherapyUpdateWithoutAppointmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TherapyUncheckedUpdateWithoutAppointmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentUpsertWithoutAppointmentInput = {
    update: XOR<PaymentUpdateWithoutAppointmentInput, PaymentUncheckedUpdateWithoutAppointmentInput>
    create: XOR<PaymentCreateWithoutAppointmentInput, PaymentUncheckedCreateWithoutAppointmentInput>
    where?: PaymentWhereInput
  }

  export type PaymentUpdateToOneWithWhereWithoutAppointmentInput = {
    where?: PaymentWhereInput
    data: XOR<PaymentUpdateWithoutAppointmentInput, PaymentUncheckedUpdateWithoutAppointmentInput>
  }

  export type PaymentUpdateWithoutAppointmentInput = {
    id?: StringFieldUpdateOperationsInput | string
    amount?: FloatFieldUpdateOperationsInput | number
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    method?: NullableEnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod | null
    transactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PaymentUncheckedUpdateWithoutAppointmentInput = {
    id?: StringFieldUpdateOperationsInput | string
    amount?: FloatFieldUpdateOperationsInput | number
    status?: EnumPaymentStatusFieldUpdateOperationsInput | $Enums.PaymentStatus
    method?: NullableEnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod | null
    transactionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type QueueItemUpsertWithoutAppointmentInput = {
    update: XOR<QueueItemUpdateWithoutAppointmentInput, QueueItemUncheckedUpdateWithoutAppointmentInput>
    create: XOR<QueueItemCreateWithoutAppointmentInput, QueueItemUncheckedCreateWithoutAppointmentInput>
    where?: QueueItemWhereInput
  }

  export type QueueItemUpdateToOneWithWhereWithoutAppointmentInput = {
    where?: QueueItemWhereInput
    data: XOR<QueueItemUpdateWithoutAppointmentInput, QueueItemUncheckedUpdateWithoutAppointmentInput>
  }

  export type QueueItemUpdateWithoutAppointmentInput = {
    id?: StringFieldUpdateOperationsInput | string
    queueNumber?: IntFieldUpdateOperationsInput | number
    estimatedWaitTime?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumQueueStatusFieldUpdateOperationsInput | $Enums.QueueStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type QueueItemUncheckedUpdateWithoutAppointmentInput = {
    id?: StringFieldUpdateOperationsInput | string
    queueNumber?: IntFieldUpdateOperationsInput | number
    estimatedWaitTime?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumQueueStatusFieldUpdateOperationsInput | $Enums.QueueStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AppointmentCreateWithoutTherapyInput = {
    id?: string
    type?: $Enums.AppointmentType
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    doctor: DoctorCreateNestedOneWithoutAppointmentsInput
    patient: PatientCreateNestedOneWithoutAppointmentsInput
    location: LocationCreateNestedOneWithoutAppointmentsInput
    payment?: PaymentCreateNestedOneWithoutAppointmentInput
    queueItem?: QueueItemCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentUncheckedCreateWithoutTherapyInput = {
    id?: string
    type?: $Enums.AppointmentType
    doctorId: string
    patientId: string
    locationId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    payment?: PaymentUncheckedCreateNestedOneWithoutAppointmentInput
    queueItem?: QueueItemUncheckedCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentCreateOrConnectWithoutTherapyInput = {
    where: AppointmentWhereUniqueInput
    create: XOR<AppointmentCreateWithoutTherapyInput, AppointmentUncheckedCreateWithoutTherapyInput>
  }

  export type AppointmentCreateManyTherapyInputEnvelope = {
    data: AppointmentCreateManyTherapyInput | AppointmentCreateManyTherapyInput[]
    skipDuplicates?: boolean
  }

  export type AppointmentUpsertWithWhereUniqueWithoutTherapyInput = {
    where: AppointmentWhereUniqueInput
    update: XOR<AppointmentUpdateWithoutTherapyInput, AppointmentUncheckedUpdateWithoutTherapyInput>
    create: XOR<AppointmentCreateWithoutTherapyInput, AppointmentUncheckedCreateWithoutTherapyInput>
  }

  export type AppointmentUpdateWithWhereUniqueWithoutTherapyInput = {
    where: AppointmentWhereUniqueInput
    data: XOR<AppointmentUpdateWithoutTherapyInput, AppointmentUncheckedUpdateWithoutTherapyInput>
  }

  export type AppointmentUpdateManyWithWhereWithoutTherapyInput = {
    where: AppointmentScalarWhereInput
    data: XOR<AppointmentUpdateManyMutationInput, AppointmentUncheckedUpdateManyWithoutTherapyInput>
  }

  export type AppointmentCreateWithoutPaymentInput = {
    id?: string
    type?: $Enums.AppointmentType
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    doctor: DoctorCreateNestedOneWithoutAppointmentsInput
    patient: PatientCreateNestedOneWithoutAppointmentsInput
    location: LocationCreateNestedOneWithoutAppointmentsInput
    therapy?: TherapyCreateNestedOneWithoutAppointmentsInput
    queueItem?: QueueItemCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentUncheckedCreateWithoutPaymentInput = {
    id?: string
    type?: $Enums.AppointmentType
    doctorId: string
    patientId: string
    locationId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    therapyId?: string | null
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    queueItem?: QueueItemUncheckedCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentCreateOrConnectWithoutPaymentInput = {
    where: AppointmentWhereUniqueInput
    create: XOR<AppointmentCreateWithoutPaymentInput, AppointmentUncheckedCreateWithoutPaymentInput>
  }

  export type AppointmentUpsertWithoutPaymentInput = {
    update: XOR<AppointmentUpdateWithoutPaymentInput, AppointmentUncheckedUpdateWithoutPaymentInput>
    create: XOR<AppointmentCreateWithoutPaymentInput, AppointmentUncheckedCreateWithoutPaymentInput>
    where?: AppointmentWhereInput
  }

  export type AppointmentUpdateToOneWithWhereWithoutPaymentInput = {
    where?: AppointmentWhereInput
    data: XOR<AppointmentUpdateWithoutPaymentInput, AppointmentUncheckedUpdateWithoutPaymentInput>
  }

  export type AppointmentUpdateWithoutPaymentInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    doctor?: DoctorUpdateOneRequiredWithoutAppointmentsNestedInput
    patient?: PatientUpdateOneRequiredWithoutAppointmentsNestedInput
    location?: LocationUpdateOneRequiredWithoutAppointmentsNestedInput
    therapy?: TherapyUpdateOneWithoutAppointmentsNestedInput
    queueItem?: QueueItemUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateWithoutPaymentInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    doctorId?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    therapyId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    queueItem?: QueueItemUncheckedUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentCreateWithoutQueueItemInput = {
    id?: string
    type?: $Enums.AppointmentType
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    doctor: DoctorCreateNestedOneWithoutAppointmentsInput
    patient: PatientCreateNestedOneWithoutAppointmentsInput
    location: LocationCreateNestedOneWithoutAppointmentsInput
    therapy?: TherapyCreateNestedOneWithoutAppointmentsInput
    payment?: PaymentCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentUncheckedCreateWithoutQueueItemInput = {
    id?: string
    type?: $Enums.AppointmentType
    doctorId: string
    patientId: string
    locationId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    therapyId?: string | null
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
    payment?: PaymentUncheckedCreateNestedOneWithoutAppointmentInput
  }

  export type AppointmentCreateOrConnectWithoutQueueItemInput = {
    where: AppointmentWhereUniqueInput
    create: XOR<AppointmentCreateWithoutQueueItemInput, AppointmentUncheckedCreateWithoutQueueItemInput>
  }

  export type AppointmentUpsertWithoutQueueItemInput = {
    update: XOR<AppointmentUpdateWithoutQueueItemInput, AppointmentUncheckedUpdateWithoutQueueItemInput>
    create: XOR<AppointmentCreateWithoutQueueItemInput, AppointmentUncheckedCreateWithoutQueueItemInput>
    where?: AppointmentWhereInput
  }

  export type AppointmentUpdateToOneWithWhereWithoutQueueItemInput = {
    where?: AppointmentWhereInput
    data: XOR<AppointmentUpdateWithoutQueueItemInput, AppointmentUncheckedUpdateWithoutQueueItemInput>
  }

  export type AppointmentUpdateWithoutQueueItemInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    doctor?: DoctorUpdateOneRequiredWithoutAppointmentsNestedInput
    patient?: PatientUpdateOneRequiredWithoutAppointmentsNestedInput
    location?: LocationUpdateOneRequiredWithoutAppointmentsNestedInput
    therapy?: TherapyUpdateOneWithoutAppointmentsNestedInput
    payment?: PaymentUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateWithoutQueueItemInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    doctorId?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    therapyId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    payment?: PaymentUncheckedUpdateOneWithoutAppointmentNestedInput
  }

  export type DoctorCreateWithoutPrescriptionsInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentCreateNestedManyWithoutDoctorInput
    healthRecords?: HealthRecordCreateNestedManyWithoutDoctorInput
    reviews?: ReviewCreateNestedManyWithoutDoctorInput
    locations?: DoctorLocationCreateNestedManyWithoutDoctorInput
  }

  export type DoctorUncheckedCreateWithoutPrescriptionsInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentUncheckedCreateNestedManyWithoutDoctorInput
    healthRecords?: HealthRecordUncheckedCreateNestedManyWithoutDoctorInput
    reviews?: ReviewUncheckedCreateNestedManyWithoutDoctorInput
    locations?: DoctorLocationUncheckedCreateNestedManyWithoutDoctorInput
  }

  export type DoctorCreateOrConnectWithoutPrescriptionsInput = {
    where: DoctorWhereUniqueInput
    create: XOR<DoctorCreateWithoutPrescriptionsInput, DoctorUncheckedCreateWithoutPrescriptionsInput>
  }

  export type PatientCreateWithoutPrescriptionsInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentCreateNestedManyWithoutPatientInput
    healthRecords?: HealthRecordCreateNestedManyWithoutPatientInput
    reviews?: ReviewCreateNestedManyWithoutPatientInput
  }

  export type PatientUncheckedCreateWithoutPrescriptionsInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentUncheckedCreateNestedManyWithoutPatientInput
    healthRecords?: HealthRecordUncheckedCreateNestedManyWithoutPatientInput
    reviews?: ReviewUncheckedCreateNestedManyWithoutPatientInput
  }

  export type PatientCreateOrConnectWithoutPrescriptionsInput = {
    where: PatientWhereUniqueInput
    create: XOR<PatientCreateWithoutPrescriptionsInput, PatientUncheckedCreateWithoutPrescriptionsInput>
  }

  export type PrescriptionItemCreateWithoutPrescriptionInput = {
    id?: string
    dosage?: string | null
    frequency?: string | null
    duration?: string | null
    instructions?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    medicine: MedicineCreateNestedOneWithoutPrescriptionItemsInput
  }

  export type PrescriptionItemUncheckedCreateWithoutPrescriptionInput = {
    id?: string
    medicineId: string
    dosage?: string | null
    frequency?: string | null
    duration?: string | null
    instructions?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PrescriptionItemCreateOrConnectWithoutPrescriptionInput = {
    where: PrescriptionItemWhereUniqueInput
    create: XOR<PrescriptionItemCreateWithoutPrescriptionInput, PrescriptionItemUncheckedCreateWithoutPrescriptionInput>
  }

  export type PrescriptionItemCreateManyPrescriptionInputEnvelope = {
    data: PrescriptionItemCreateManyPrescriptionInput | PrescriptionItemCreateManyPrescriptionInput[]
    skipDuplicates?: boolean
  }

  export type DoctorUpsertWithoutPrescriptionsInput = {
    update: XOR<DoctorUpdateWithoutPrescriptionsInput, DoctorUncheckedUpdateWithoutPrescriptionsInput>
    create: XOR<DoctorCreateWithoutPrescriptionsInput, DoctorUncheckedCreateWithoutPrescriptionsInput>
    where?: DoctorWhereInput
  }

  export type DoctorUpdateToOneWithWhereWithoutPrescriptionsInput = {
    where?: DoctorWhereInput
    data: XOR<DoctorUpdateWithoutPrescriptionsInput, DoctorUncheckedUpdateWithoutPrescriptionsInput>
  }

  export type DoctorUpdateWithoutPrescriptionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUpdateManyWithoutDoctorNestedInput
    healthRecords?: HealthRecordUpdateManyWithoutDoctorNestedInput
    reviews?: ReviewUpdateManyWithoutDoctorNestedInput
    locations?: DoctorLocationUpdateManyWithoutDoctorNestedInput
  }

  export type DoctorUncheckedUpdateWithoutPrescriptionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUncheckedUpdateManyWithoutDoctorNestedInput
    healthRecords?: HealthRecordUncheckedUpdateManyWithoutDoctorNestedInput
    reviews?: ReviewUncheckedUpdateManyWithoutDoctorNestedInput
    locations?: DoctorLocationUncheckedUpdateManyWithoutDoctorNestedInput
  }

  export type PatientUpsertWithoutPrescriptionsInput = {
    update: XOR<PatientUpdateWithoutPrescriptionsInput, PatientUncheckedUpdateWithoutPrescriptionsInput>
    create: XOR<PatientCreateWithoutPrescriptionsInput, PatientUncheckedCreateWithoutPrescriptionsInput>
    where?: PatientWhereInput
  }

  export type PatientUpdateToOneWithWhereWithoutPrescriptionsInput = {
    where?: PatientWhereInput
    data: XOR<PatientUpdateWithoutPrescriptionsInput, PatientUncheckedUpdateWithoutPrescriptionsInput>
  }

  export type PatientUpdateWithoutPrescriptionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUpdateManyWithoutPatientNestedInput
    healthRecords?: HealthRecordUpdateManyWithoutPatientNestedInput
    reviews?: ReviewUpdateManyWithoutPatientNestedInput
  }

  export type PatientUncheckedUpdateWithoutPrescriptionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUncheckedUpdateManyWithoutPatientNestedInput
    healthRecords?: HealthRecordUncheckedUpdateManyWithoutPatientNestedInput
    reviews?: ReviewUncheckedUpdateManyWithoutPatientNestedInput
  }

  export type PrescriptionItemUpsertWithWhereUniqueWithoutPrescriptionInput = {
    where: PrescriptionItemWhereUniqueInput
    update: XOR<PrescriptionItemUpdateWithoutPrescriptionInput, PrescriptionItemUncheckedUpdateWithoutPrescriptionInput>
    create: XOR<PrescriptionItemCreateWithoutPrescriptionInput, PrescriptionItemUncheckedCreateWithoutPrescriptionInput>
  }

  export type PrescriptionItemUpdateWithWhereUniqueWithoutPrescriptionInput = {
    where: PrescriptionItemWhereUniqueInput
    data: XOR<PrescriptionItemUpdateWithoutPrescriptionInput, PrescriptionItemUncheckedUpdateWithoutPrescriptionInput>
  }

  export type PrescriptionItemUpdateManyWithWhereWithoutPrescriptionInput = {
    where: PrescriptionItemScalarWhereInput
    data: XOR<PrescriptionItemUpdateManyMutationInput, PrescriptionItemUncheckedUpdateManyWithoutPrescriptionInput>
  }

  export type PrescriptionItemScalarWhereInput = {
    AND?: PrescriptionItemScalarWhereInput | PrescriptionItemScalarWhereInput[]
    OR?: PrescriptionItemScalarWhereInput[]
    NOT?: PrescriptionItemScalarWhereInput | PrescriptionItemScalarWhereInput[]
    id?: StringFilter<"PrescriptionItem"> | string
    prescriptionId?: StringFilter<"PrescriptionItem"> | string
    medicineId?: StringFilter<"PrescriptionItem"> | string
    dosage?: StringNullableFilter<"PrescriptionItem"> | string | null
    frequency?: StringNullableFilter<"PrescriptionItem"> | string | null
    duration?: StringNullableFilter<"PrescriptionItem"> | string | null
    instructions?: StringNullableFilter<"PrescriptionItem"> | string | null
    createdAt?: DateTimeFilter<"PrescriptionItem"> | Date | string
    updatedAt?: DateTimeFilter<"PrescriptionItem"> | Date | string
  }

  export type MedicineCreateWithoutPrescriptionItemsInput = {
    id?: string
    name: string
    description?: string | null
    ingredients?: string | null
    dosage?: string | null
    manufacturer?: string | null
    price?: number | null
    stock?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MedicineUncheckedCreateWithoutPrescriptionItemsInput = {
    id?: string
    name: string
    description?: string | null
    ingredients?: string | null
    dosage?: string | null
    manufacturer?: string | null
    price?: number | null
    stock?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MedicineCreateOrConnectWithoutPrescriptionItemsInput = {
    where: MedicineWhereUniqueInput
    create: XOR<MedicineCreateWithoutPrescriptionItemsInput, MedicineUncheckedCreateWithoutPrescriptionItemsInput>
  }

  export type PrescriptionCreateWithoutItemsInput = {
    id?: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    doctor: DoctorCreateNestedOneWithoutPrescriptionsInput
    patient: PatientCreateNestedOneWithoutPrescriptionsInput
  }

  export type PrescriptionUncheckedCreateWithoutItemsInput = {
    id?: string
    patientId: string
    doctorId: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PrescriptionCreateOrConnectWithoutItemsInput = {
    where: PrescriptionWhereUniqueInput
    create: XOR<PrescriptionCreateWithoutItemsInput, PrescriptionUncheckedCreateWithoutItemsInput>
  }

  export type MedicineUpsertWithoutPrescriptionItemsInput = {
    update: XOR<MedicineUpdateWithoutPrescriptionItemsInput, MedicineUncheckedUpdateWithoutPrescriptionItemsInput>
    create: XOR<MedicineCreateWithoutPrescriptionItemsInput, MedicineUncheckedCreateWithoutPrescriptionItemsInput>
    where?: MedicineWhereInput
  }

  export type MedicineUpdateToOneWithWhereWithoutPrescriptionItemsInput = {
    where?: MedicineWhereInput
    data: XOR<MedicineUpdateWithoutPrescriptionItemsInput, MedicineUncheckedUpdateWithoutPrescriptionItemsInput>
  }

  export type MedicineUpdateWithoutPrescriptionItemsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    ingredients?: NullableStringFieldUpdateOperationsInput | string | null
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    manufacturer?: NullableStringFieldUpdateOperationsInput | string | null
    price?: NullableFloatFieldUpdateOperationsInput | number | null
    stock?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MedicineUncheckedUpdateWithoutPrescriptionItemsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    ingredients?: NullableStringFieldUpdateOperationsInput | string | null
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    manufacturer?: NullableStringFieldUpdateOperationsInput | string | null
    price?: NullableFloatFieldUpdateOperationsInput | number | null
    stock?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionUpsertWithoutItemsInput = {
    update: XOR<PrescriptionUpdateWithoutItemsInput, PrescriptionUncheckedUpdateWithoutItemsInput>
    create: XOR<PrescriptionCreateWithoutItemsInput, PrescriptionUncheckedCreateWithoutItemsInput>
    where?: PrescriptionWhereInput
  }

  export type PrescriptionUpdateToOneWithWhereWithoutItemsInput = {
    where?: PrescriptionWhereInput
    data: XOR<PrescriptionUpdateWithoutItemsInput, PrescriptionUncheckedUpdateWithoutItemsInput>
  }

  export type PrescriptionUpdateWithoutItemsInput = {
    id?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    doctor?: DoctorUpdateOneRequiredWithoutPrescriptionsNestedInput
    patient?: PatientUpdateOneRequiredWithoutPrescriptionsNestedInput
  }

  export type PrescriptionUncheckedUpdateWithoutItemsInput = {
    id?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionItemCreateWithoutMedicineInput = {
    id?: string
    dosage?: string | null
    frequency?: string | null
    duration?: string | null
    instructions?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    prescription: PrescriptionCreateNestedOneWithoutItemsInput
  }

  export type PrescriptionItemUncheckedCreateWithoutMedicineInput = {
    id?: string
    prescriptionId: string
    dosage?: string | null
    frequency?: string | null
    duration?: string | null
    instructions?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PrescriptionItemCreateOrConnectWithoutMedicineInput = {
    where: PrescriptionItemWhereUniqueInput
    create: XOR<PrescriptionItemCreateWithoutMedicineInput, PrescriptionItemUncheckedCreateWithoutMedicineInput>
  }

  export type PrescriptionItemCreateManyMedicineInputEnvelope = {
    data: PrescriptionItemCreateManyMedicineInput | PrescriptionItemCreateManyMedicineInput[]
    skipDuplicates?: boolean
  }

  export type PrescriptionItemUpsertWithWhereUniqueWithoutMedicineInput = {
    where: PrescriptionItemWhereUniqueInput
    update: XOR<PrescriptionItemUpdateWithoutMedicineInput, PrescriptionItemUncheckedUpdateWithoutMedicineInput>
    create: XOR<PrescriptionItemCreateWithoutMedicineInput, PrescriptionItemUncheckedCreateWithoutMedicineInput>
  }

  export type PrescriptionItemUpdateWithWhereUniqueWithoutMedicineInput = {
    where: PrescriptionItemWhereUniqueInput
    data: XOR<PrescriptionItemUpdateWithoutMedicineInput, PrescriptionItemUncheckedUpdateWithoutMedicineInput>
  }

  export type PrescriptionItemUpdateManyWithWhereWithoutMedicineInput = {
    where: PrescriptionItemScalarWhereInput
    data: XOR<PrescriptionItemUpdateManyMutationInput, PrescriptionItemUncheckedUpdateManyWithoutMedicineInput>
  }

  export type DoctorCreateWithoutHealthRecordsInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentCreateNestedManyWithoutDoctorInput
    prescriptions?: PrescriptionCreateNestedManyWithoutDoctorInput
    reviews?: ReviewCreateNestedManyWithoutDoctorInput
    locations?: DoctorLocationCreateNestedManyWithoutDoctorInput
  }

  export type DoctorUncheckedCreateWithoutHealthRecordsInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentUncheckedCreateNestedManyWithoutDoctorInput
    prescriptions?: PrescriptionUncheckedCreateNestedManyWithoutDoctorInput
    reviews?: ReviewUncheckedCreateNestedManyWithoutDoctorInput
    locations?: DoctorLocationUncheckedCreateNestedManyWithoutDoctorInput
  }

  export type DoctorCreateOrConnectWithoutHealthRecordsInput = {
    where: DoctorWhereUniqueInput
    create: XOR<DoctorCreateWithoutHealthRecordsInput, DoctorUncheckedCreateWithoutHealthRecordsInput>
  }

  export type PatientCreateWithoutHealthRecordsInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentCreateNestedManyWithoutPatientInput
    prescriptions?: PrescriptionCreateNestedManyWithoutPatientInput
    reviews?: ReviewCreateNestedManyWithoutPatientInput
  }

  export type PatientUncheckedCreateWithoutHealthRecordsInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentUncheckedCreateNestedManyWithoutPatientInput
    prescriptions?: PrescriptionUncheckedCreateNestedManyWithoutPatientInput
    reviews?: ReviewUncheckedCreateNestedManyWithoutPatientInput
  }

  export type PatientCreateOrConnectWithoutHealthRecordsInput = {
    where: PatientWhereUniqueInput
    create: XOR<PatientCreateWithoutHealthRecordsInput, PatientUncheckedCreateWithoutHealthRecordsInput>
  }

  export type DoctorUpsertWithoutHealthRecordsInput = {
    update: XOR<DoctorUpdateWithoutHealthRecordsInput, DoctorUncheckedUpdateWithoutHealthRecordsInput>
    create: XOR<DoctorCreateWithoutHealthRecordsInput, DoctorUncheckedCreateWithoutHealthRecordsInput>
    where?: DoctorWhereInput
  }

  export type DoctorUpdateToOneWithWhereWithoutHealthRecordsInput = {
    where?: DoctorWhereInput
    data: XOR<DoctorUpdateWithoutHealthRecordsInput, DoctorUncheckedUpdateWithoutHealthRecordsInput>
  }

  export type DoctorUpdateWithoutHealthRecordsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUpdateManyWithoutDoctorNestedInput
    prescriptions?: PrescriptionUpdateManyWithoutDoctorNestedInput
    reviews?: ReviewUpdateManyWithoutDoctorNestedInput
    locations?: DoctorLocationUpdateManyWithoutDoctorNestedInput
  }

  export type DoctorUncheckedUpdateWithoutHealthRecordsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUncheckedUpdateManyWithoutDoctorNestedInput
    prescriptions?: PrescriptionUncheckedUpdateManyWithoutDoctorNestedInput
    reviews?: ReviewUncheckedUpdateManyWithoutDoctorNestedInput
    locations?: DoctorLocationUncheckedUpdateManyWithoutDoctorNestedInput
  }

  export type PatientUpsertWithoutHealthRecordsInput = {
    update: XOR<PatientUpdateWithoutHealthRecordsInput, PatientUncheckedUpdateWithoutHealthRecordsInput>
    create: XOR<PatientCreateWithoutHealthRecordsInput, PatientUncheckedCreateWithoutHealthRecordsInput>
    where?: PatientWhereInput
  }

  export type PatientUpdateToOneWithWhereWithoutHealthRecordsInput = {
    where?: PatientWhereInput
    data: XOR<PatientUpdateWithoutHealthRecordsInput, PatientUncheckedUpdateWithoutHealthRecordsInput>
  }

  export type PatientUpdateWithoutHealthRecordsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUpdateManyWithoutPatientNestedInput
    prescriptions?: PrescriptionUpdateManyWithoutPatientNestedInput
    reviews?: ReviewUpdateManyWithoutPatientNestedInput
  }

  export type PatientUncheckedUpdateWithoutHealthRecordsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUncheckedUpdateManyWithoutPatientNestedInput
    prescriptions?: PrescriptionUncheckedUpdateManyWithoutPatientNestedInput
    reviews?: ReviewUncheckedUpdateManyWithoutPatientNestedInput
  }

  export type DoctorCreateWithoutReviewsInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentCreateNestedManyWithoutDoctorInput
    healthRecords?: HealthRecordCreateNestedManyWithoutDoctorInput
    prescriptions?: PrescriptionCreateNestedManyWithoutDoctorInput
    locations?: DoctorLocationCreateNestedManyWithoutDoctorInput
  }

  export type DoctorUncheckedCreateWithoutReviewsInput = {
    id?: string
    userId: string
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    specialization: string
    experience: number
    qualification?: string | null
    consultationFee?: number | null
    rating?: number | null
    isAvailable?: boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentUncheckedCreateNestedManyWithoutDoctorInput
    healthRecords?: HealthRecordUncheckedCreateNestedManyWithoutDoctorInput
    prescriptions?: PrescriptionUncheckedCreateNestedManyWithoutDoctorInput
    locations?: DoctorLocationUncheckedCreateNestedManyWithoutDoctorInput
  }

  export type DoctorCreateOrConnectWithoutReviewsInput = {
    where: DoctorWhereUniqueInput
    create: XOR<DoctorCreateWithoutReviewsInput, DoctorUncheckedCreateWithoutReviewsInput>
  }

  export type PatientCreateWithoutReviewsInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentCreateNestedManyWithoutPatientInput
    healthRecords?: HealthRecordCreateNestedManyWithoutPatientInput
    prescriptions?: PrescriptionCreateNestedManyWithoutPatientInput
  }

  export type PatientUncheckedCreateWithoutReviewsInput = {
    id?: string
    userId: string
    prakriti?: $Enums.Prakriti | null
    dosha?: $Enums.Dosha | null
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    gender?: string | null
    dateOfBirth?: Date | string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    zipCode?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    appointments?: AppointmentUncheckedCreateNestedManyWithoutPatientInput
    healthRecords?: HealthRecordUncheckedCreateNestedManyWithoutPatientInput
    prescriptions?: PrescriptionUncheckedCreateNestedManyWithoutPatientInput
  }

  export type PatientCreateOrConnectWithoutReviewsInput = {
    where: PatientWhereUniqueInput
    create: XOR<PatientCreateWithoutReviewsInput, PatientUncheckedCreateWithoutReviewsInput>
  }

  export type DoctorUpsertWithoutReviewsInput = {
    update: XOR<DoctorUpdateWithoutReviewsInput, DoctorUncheckedUpdateWithoutReviewsInput>
    create: XOR<DoctorCreateWithoutReviewsInput, DoctorUncheckedCreateWithoutReviewsInput>
    where?: DoctorWhereInput
  }

  export type DoctorUpdateToOneWithWhereWithoutReviewsInput = {
    where?: DoctorWhereInput
    data: XOR<DoctorUpdateWithoutReviewsInput, DoctorUncheckedUpdateWithoutReviewsInput>
  }

  export type DoctorUpdateWithoutReviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUpdateManyWithoutDoctorNestedInput
    healthRecords?: HealthRecordUpdateManyWithoutDoctorNestedInput
    prescriptions?: PrescriptionUpdateManyWithoutDoctorNestedInput
    locations?: DoctorLocationUpdateManyWithoutDoctorNestedInput
  }

  export type DoctorUncheckedUpdateWithoutReviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    specialization?: StringFieldUpdateOperationsInput | string
    experience?: IntFieldUpdateOperationsInput | number
    qualification?: NullableStringFieldUpdateOperationsInput | string | null
    consultationFee?: NullableFloatFieldUpdateOperationsInput | number | null
    rating?: NullableFloatFieldUpdateOperationsInput | number | null
    isAvailable?: BoolFieldUpdateOperationsInput | boolean
    workingHours?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUncheckedUpdateManyWithoutDoctorNestedInput
    healthRecords?: HealthRecordUncheckedUpdateManyWithoutDoctorNestedInput
    prescriptions?: PrescriptionUncheckedUpdateManyWithoutDoctorNestedInput
    locations?: DoctorLocationUncheckedUpdateManyWithoutDoctorNestedInput
  }

  export type PatientUpsertWithoutReviewsInput = {
    update: XOR<PatientUpdateWithoutReviewsInput, PatientUncheckedUpdateWithoutReviewsInput>
    create: XOR<PatientCreateWithoutReviewsInput, PatientUncheckedCreateWithoutReviewsInput>
    where?: PatientWhereInput
  }

  export type PatientUpdateToOneWithWhereWithoutReviewsInput = {
    where?: PatientWhereInput
    data: XOR<PatientUpdateWithoutReviewsInput, PatientUncheckedUpdateWithoutReviewsInput>
  }

  export type PatientUpdateWithoutReviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUpdateManyWithoutPatientNestedInput
    healthRecords?: HealthRecordUpdateManyWithoutPatientNestedInput
    prescriptions?: PrescriptionUpdateManyWithoutPatientNestedInput
  }

  export type PatientUncheckedUpdateWithoutReviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    prakriti?: NullableEnumPrakritiFieldUpdateOperationsInput | $Enums.Prakriti | null
    dosha?: NullableEnumDoshaFieldUpdateOperationsInput | $Enums.Dosha | null
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    gender?: NullableStringFieldUpdateOperationsInput | string | null
    dateOfBirth?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    appointments?: AppointmentUncheckedUpdateManyWithoutPatientNestedInput
    healthRecords?: HealthRecordUncheckedUpdateManyWithoutPatientNestedInput
    prescriptions?: PrescriptionUncheckedUpdateManyWithoutPatientNestedInput
  }

  export type AppointmentCreateManyPatientInput = {
    id?: string
    type?: $Enums.AppointmentType
    doctorId: string
    locationId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    therapyId?: string | null
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
  }

  export type HealthRecordCreateManyPatientInput = {
    id?: string
    doctorId: string
    recordType: $Enums.HealthRecordType
    report?: string | null
    fileUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PrescriptionCreateManyPatientInput = {
    id?: string
    doctorId: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ReviewCreateManyPatientInput = {
    id?: string
    rating?: number
    comment?: string | null
    doctorId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AppointmentUpdateWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    doctor?: DoctorUpdateOneRequiredWithoutAppointmentsNestedInput
    location?: LocationUpdateOneRequiredWithoutAppointmentsNestedInput
    therapy?: TherapyUpdateOneWithoutAppointmentsNestedInput
    payment?: PaymentUpdateOneWithoutAppointmentNestedInput
    queueItem?: QueueItemUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    doctorId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    therapyId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    payment?: PaymentUncheckedUpdateOneWithoutAppointmentNestedInput
    queueItem?: QueueItemUncheckedUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateManyWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    doctorId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    therapyId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type HealthRecordUpdateWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    recordType?: EnumHealthRecordTypeFieldUpdateOperationsInput | $Enums.HealthRecordType
    report?: NullableStringFieldUpdateOperationsInput | string | null
    fileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    doctor?: DoctorUpdateOneRequiredWithoutHealthRecordsNestedInput
  }

  export type HealthRecordUncheckedUpdateWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    recordType?: EnumHealthRecordTypeFieldUpdateOperationsInput | $Enums.HealthRecordType
    report?: NullableStringFieldUpdateOperationsInput | string | null
    fileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type HealthRecordUncheckedUpdateManyWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    recordType?: EnumHealthRecordTypeFieldUpdateOperationsInput | $Enums.HealthRecordType
    report?: NullableStringFieldUpdateOperationsInput | string | null
    fileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionUpdateWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    doctor?: DoctorUpdateOneRequiredWithoutPrescriptionsNestedInput
    items?: PrescriptionItemUpdateManyWithoutPrescriptionNestedInput
  }

  export type PrescriptionUncheckedUpdateWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    items?: PrescriptionItemUncheckedUpdateManyWithoutPrescriptionNestedInput
  }

  export type PrescriptionUncheckedUpdateManyWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    doctorId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ReviewUpdateWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    doctor?: DoctorUpdateOneRequiredWithoutReviewsNestedInput
  }

  export type ReviewUncheckedUpdateWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    doctorId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ReviewUncheckedUpdateManyWithoutPatientInput = {
    id?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    doctorId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AppointmentCreateManyDoctorInput = {
    id?: string
    type?: $Enums.AppointmentType
    patientId: string
    locationId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    therapyId?: string | null
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
  }

  export type HealthRecordCreateManyDoctorInput = {
    id?: string
    patientId: string
    recordType: $Enums.HealthRecordType
    report?: string | null
    fileUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PrescriptionCreateManyDoctorInput = {
    id?: string
    patientId: string
    date?: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ReviewCreateManyDoctorInput = {
    id?: string
    rating?: number
    comment?: string | null
    patientId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type DoctorLocationCreateManyDoctorInput = {
    locationId: string
    startTime?: Date | string | null
    endTime?: Date | string | null
  }

  export type AppointmentUpdateWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    patient?: PatientUpdateOneRequiredWithoutAppointmentsNestedInput
    location?: LocationUpdateOneRequiredWithoutAppointmentsNestedInput
    therapy?: TherapyUpdateOneWithoutAppointmentsNestedInput
    payment?: PaymentUpdateOneWithoutAppointmentNestedInput
    queueItem?: QueueItemUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    patientId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    therapyId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    payment?: PaymentUncheckedUpdateOneWithoutAppointmentNestedInput
    queueItem?: QueueItemUncheckedUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateManyWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    patientId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    therapyId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type HealthRecordUpdateWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    recordType?: EnumHealthRecordTypeFieldUpdateOperationsInput | $Enums.HealthRecordType
    report?: NullableStringFieldUpdateOperationsInput | string | null
    fileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    patient?: PatientUpdateOneRequiredWithoutHealthRecordsNestedInput
  }

  export type HealthRecordUncheckedUpdateWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    recordType?: EnumHealthRecordTypeFieldUpdateOperationsInput | $Enums.HealthRecordType
    report?: NullableStringFieldUpdateOperationsInput | string | null
    fileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type HealthRecordUncheckedUpdateManyWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    recordType?: EnumHealthRecordTypeFieldUpdateOperationsInput | $Enums.HealthRecordType
    report?: NullableStringFieldUpdateOperationsInput | string | null
    fileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionUpdateWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    patient?: PatientUpdateOneRequiredWithoutPrescriptionsNestedInput
    items?: PrescriptionItemUpdateManyWithoutPrescriptionNestedInput
  }

  export type PrescriptionUncheckedUpdateWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    items?: PrescriptionItemUncheckedUpdateManyWithoutPrescriptionNestedInput
  }

  export type PrescriptionUncheckedUpdateManyWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ReviewUpdateWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    patient?: PatientUpdateOneRequiredWithoutReviewsNestedInput
  }

  export type ReviewUncheckedUpdateWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    patientId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ReviewUncheckedUpdateManyWithoutDoctorInput = {
    id?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    patientId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type DoctorLocationUpdateWithoutDoctorInput = {
    startTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    location?: LocationUpdateOneRequiredWithoutDoctorsNestedInput
  }

  export type DoctorLocationUncheckedUpdateWithoutDoctorInput = {
    locationId?: StringFieldUpdateOperationsInput | string
    startTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type DoctorLocationUncheckedUpdateManyWithoutDoctorInput = {
    locationId?: StringFieldUpdateOperationsInput | string
    startTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type AppointmentCreateManyLocationInput = {
    id?: string
    type?: $Enums.AppointmentType
    doctorId: string
    patientId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    therapyId?: string | null
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
  }

  export type DoctorLocationCreateManyLocationInput = {
    doctorId: string
    startTime?: Date | string | null
    endTime?: Date | string | null
  }

  export type AppointmentUpdateWithoutLocationInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    doctor?: DoctorUpdateOneRequiredWithoutAppointmentsNestedInput
    patient?: PatientUpdateOneRequiredWithoutAppointmentsNestedInput
    therapy?: TherapyUpdateOneWithoutAppointmentsNestedInput
    payment?: PaymentUpdateOneWithoutAppointmentNestedInput
    queueItem?: QueueItemUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateWithoutLocationInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    doctorId?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    therapyId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    payment?: PaymentUncheckedUpdateOneWithoutAppointmentNestedInput
    queueItem?: QueueItemUncheckedUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateManyWithoutLocationInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    doctorId?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    therapyId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type DoctorLocationUpdateWithoutLocationInput = {
    startTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    doctor?: DoctorUpdateOneRequiredWithoutLocationsNestedInput
  }

  export type DoctorLocationUncheckedUpdateWithoutLocationInput = {
    doctorId?: StringFieldUpdateOperationsInput | string
    startTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type DoctorLocationUncheckedUpdateManyWithoutLocationInput = {
    doctorId?: StringFieldUpdateOperationsInput | string
    startTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type AppointmentCreateManyTherapyInput = {
    id?: string
    type?: $Enums.AppointmentType
    doctorId: string
    patientId: string
    locationId: string
    date: Date | string
    time: string
    duration?: number
    status?: $Enums.AppointmentStatus
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    startedAt?: Date | string | null
    checkedInAt?: Date | string | null
    completedAt?: Date | string | null
  }

  export type AppointmentUpdateWithoutTherapyInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    doctor?: DoctorUpdateOneRequiredWithoutAppointmentsNestedInput
    patient?: PatientUpdateOneRequiredWithoutAppointmentsNestedInput
    location?: LocationUpdateOneRequiredWithoutAppointmentsNestedInput
    payment?: PaymentUpdateOneWithoutAppointmentNestedInput
    queueItem?: QueueItemUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateWithoutTherapyInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    doctorId?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    payment?: PaymentUncheckedUpdateOneWithoutAppointmentNestedInput
    queueItem?: QueueItemUncheckedUpdateOneWithoutAppointmentNestedInput
  }

  export type AppointmentUncheckedUpdateManyWithoutTherapyInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumAppointmentTypeFieldUpdateOperationsInput | $Enums.AppointmentType
    doctorId?: StringFieldUpdateOperationsInput | string
    patientId?: StringFieldUpdateOperationsInput | string
    locationId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    time?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    status?: EnumAppointmentStatusFieldUpdateOperationsInput | $Enums.AppointmentStatus
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    checkedInAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type PrescriptionItemCreateManyPrescriptionInput = {
    id?: string
    medicineId: string
    dosage?: string | null
    frequency?: string | null
    duration?: string | null
    instructions?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PrescriptionItemUpdateWithoutPrescriptionInput = {
    id?: StringFieldUpdateOperationsInput | string
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    frequency?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableStringFieldUpdateOperationsInput | string | null
    instructions?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    medicine?: MedicineUpdateOneRequiredWithoutPrescriptionItemsNestedInput
  }

  export type PrescriptionItemUncheckedUpdateWithoutPrescriptionInput = {
    id?: StringFieldUpdateOperationsInput | string
    medicineId?: StringFieldUpdateOperationsInput | string
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    frequency?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableStringFieldUpdateOperationsInput | string | null
    instructions?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionItemUncheckedUpdateManyWithoutPrescriptionInput = {
    id?: StringFieldUpdateOperationsInput | string
    medicineId?: StringFieldUpdateOperationsInput | string
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    frequency?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableStringFieldUpdateOperationsInput | string | null
    instructions?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionItemCreateManyMedicineInput = {
    id?: string
    prescriptionId: string
    dosage?: string | null
    frequency?: string | null
    duration?: string | null
    instructions?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PrescriptionItemUpdateWithoutMedicineInput = {
    id?: StringFieldUpdateOperationsInput | string
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    frequency?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableStringFieldUpdateOperationsInput | string | null
    instructions?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    prescription?: PrescriptionUpdateOneRequiredWithoutItemsNestedInput
  }

  export type PrescriptionItemUncheckedUpdateWithoutMedicineInput = {
    id?: StringFieldUpdateOperationsInput | string
    prescriptionId?: StringFieldUpdateOperationsInput | string
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    frequency?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableStringFieldUpdateOperationsInput | string | null
    instructions?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrescriptionItemUncheckedUpdateManyWithoutMedicineInput = {
    id?: StringFieldUpdateOperationsInput | string
    prescriptionId?: StringFieldUpdateOperationsInput | string
    dosage?: NullableStringFieldUpdateOperationsInput | string | null
    frequency?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableStringFieldUpdateOperationsInput | string | null
    instructions?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}