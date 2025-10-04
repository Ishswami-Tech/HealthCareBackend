/**
 * Enterprise-grade Repository Result Wrapper
 *
 * Provides type-safe error handling for database operations
 * Reduces runtime errors and improves code reliability
 * Designed for high-scale applications (10 lakh+ users)
 */

export class RepositoryResult<TData, TError = Error> {
  private constructor(
    private readonly _success: boolean,
    private readonly _data?: TData,
    private readonly _error?: TError,
    private readonly _metadata?: ResultMetadata,
  ) {}

  /**
   * Create a successful result
   */
  static success<T>(
    data: T,
    metadata?: ResultMetadata,
  ): RepositoryResult<T, never> {
    return new RepositoryResult(
      true,
      data,
      undefined,
      metadata,
    ) as RepositoryResult<T, never>;
  }

  /**
   * Create a failed result
   */
  static failure<T, E = Error>(
    error: E,
    metadata?: ResultMetadata,
  ): RepositoryResult<T, E> {
    return new RepositoryResult<T, E>(false, undefined, error, metadata);
  }

  /**
   * Create result from a promise with automatic error handling
   */
  static async fromPromise<T>(
    promise: Promise<T>,
    metadata?: ResultMetadata,
  ): Promise<RepositoryResult<T, Error>> {
    try {
      const data = await promise;
      return RepositoryResult.success(data, metadata);
    } catch (_error) {
      return RepositoryResult.failure(_error as Error, metadata);
    }
  }

  /**
   * Create result from a callback with automatic error handling
   */
  static fromCallback<T>(
    callback: () => T,
    metadata?: ResultMetadata,
  ): RepositoryResult<T, Error> {
    try {
      const data = callback();
      return RepositoryResult.success(data, metadata);
    } catch (_error) {
      return RepositoryResult.failure(_error as Error, metadata);
    }
  }

  /**
   * Create result from async callback with automatic error handling
   */
  static async fromAsyncCallback<T>(
    callback: () => Promise<T>,
    metadata?: ResultMetadata,
  ): Promise<RepositoryResult<T, Error>> {
    try {
      const data = await callback();
      return RepositoryResult.success(data, metadata);
    } catch (_error) {
      return RepositoryResult.failure(_error as Error, metadata);
    }
  }

  /**
   * Check if result is successful
   */
  get isSuccess(): boolean {
    return this._success;
  }

  /**
   * Check if result is failure
   */
  get isFailure(): boolean {
    return !this._success;
  }

  /**
   * Get data (throws if failure)
   */
  get data(): TData {
    if (!this._success || this._data === undefined) {
      throw new Error(
        "Cannot access data on failed result. Check isSuccess first.",
      );
    }
    return this._data;
  }

  /**
   * Get error (throws if success)
   */
  get error(): TError {
    if (this._success || this._error === undefined) {
      throw new Error(
        "Cannot access error on successful result. Check isFailure first.",
      );
    }
    return this._error;
  }

  /**
   * Get metadata
   */
  get metadata(): ResultMetadata | undefined {
    return this._metadata;
  }

  /**
   * Safely get data with fallback
   */
  getDataOrDefault(defaultValue: TData): TData {
    return this._success && this._data !== undefined
      ? this._data
      : defaultValue;
  }

  /**
   * Safely get error with fallback
   */
  getErrorOrDefault(defaultError: TError): TError {
    return !this._success && this._error !== undefined
      ? this._error
      : defaultError;
  }

  /**
   * Transform data if successful
   */
  map<U>(transform: (data: TData) => U): RepositoryResult<U, TError> {
    if (!this._success) {
      return new RepositoryResult<U, TError>(
        false,
        undefined,
        this._error,
        this._metadata,
      );
    }

    try {
      const transformedData = transform(this._data!);
      return new RepositoryResult<U, TError>(
        true,
        transformedData,
        undefined,
        this._metadata,
      );
    } catch (_error) {
      return new RepositoryResult<U, TError>(
        false,
        undefined,
        _error as TError,
        this._metadata,
      );
    }
  }

  /**
   * Transform data asynchronously if successful
   */
  async mapAsync<U>(
    transform: (data: TData) => Promise<U>,
  ): Promise<RepositoryResult<U, TError>> {
    if (!this._success) {
      return new RepositoryResult<U, TError>(
        false,
        undefined,
        this._error,
        this._metadata,
      );
    }

    try {
      const transformedData = await transform(this._data!);
      return new RepositoryResult<U, TError>(
        true,
        transformedData,
        undefined,
        this._metadata,
      );
    } catch (_error) {
      return new RepositoryResult<U, TError>(
        false,
        undefined,
        _error as TError,
        this._metadata,
      );
    }
  }

  /**
   * Chain operations with flatMap
   */
  flatMap<U>(
    transform: (data: TData) => RepositoryResult<U, TError>,
  ): RepositoryResult<U, TError> {
    if (!this._success) {
      return new RepositoryResult<U, TError>(
        false,
        undefined,
        this._error,
        this._metadata,
      );
    }

    try {
      return transform(this._data!);
    } catch (_error) {
      return new RepositoryResult<U, TError>(
        false,
        undefined,
        _error as TError,
        this._metadata,
      );
    }
  }

  /**
   * Chain async operations with flatMap
   */
  async flatMapAsync<U>(
    transform: (data: TData) => Promise<RepositoryResult<U, TError>>,
  ): Promise<RepositoryResult<U, TError>> {
    if (!this._success) {
      return new RepositoryResult<U, TError>(
        false,
        undefined,
        this._error,
        this._metadata,
      );
    }

    try {
      return await transform(this._data!);
    } catch (_error) {
      return new RepositoryResult<U, TError>(
        false,
        undefined,
        _error as TError,
        this._metadata,
      );
    }
  }

  /**
   * Transform error if failed
   */
  mapError<U>(transform: (_error: TError) => U): RepositoryResult<TData, U> {
    if (this._success) {
      return new RepositoryResult<TData, U>(
        true,
        this._data,
        undefined,
        this._metadata,
      );
    }

    try {
      const transformedError = transform(this._error!);
      return new RepositoryResult<TData, U>(
        false,
        undefined,
        transformedError,
        this._metadata,
      );
    } catch (_error) {
      return new RepositoryResult<TData, U>(
        false,
        undefined,
        _error as U,
        this._metadata,
      );
    }
  }

  /**
   * Execute side effect if successful
   */
  tap(sideEffect: (data: TData) => void): RepositoryResult<TData, TError> {
    if (this._success && this._data !== undefined) {
      try {
        sideEffect(this._data);
      } catch {
        // Ignore side effect errors
      }
    }
    return this;
  }

  /**
   * Execute async side effect if successful
   */
  async tapAsync(
    sideEffect: (data: TData) => Promise<void>,
  ): Promise<RepositoryResult<TData, TError>> {
    if (this._success && this._data !== undefined) {
      try {
        await sideEffect(this._data);
      } catch {
        // Ignore side effect errors
      }
    }
    return this;
  }

  /**
   * Execute side effect if failed
   */
  tapError(
    sideEffect: (_error: TError) => void,
  ): RepositoryResult<TData, TError> {
    if (!this._success && this._error !== undefined) {
      try {
        sideEffect(this._error);
      } catch {
        // Ignore side effect errors
      }
    }
    return this;
  }

  /**
   * Match on success/failure with handlers
   */
  match<U>(onSuccess: (data: TData) => U, onFailure: (_error: TError) => U): U {
    if (this._success && this._data !== undefined) {
      return onSuccess(this._data);
    } else if (!this._success && this._error !== undefined) {
      return onFailure(this._error);
    } else {
      throw new Error("Invalid result state");
    }
  }

  /**
   * Match on success/failure with async handlers
   */
  async matchAsync<U>(
    onSuccess: (data: TData) => Promise<U>,
    onFailure: (_error: TError) => Promise<U>,
  ): Promise<U> {
    if (this._success && this._data !== undefined) {
      return await onSuccess(this._data);
    } else if (!this._success && this._error !== undefined) {
      return await onFailure(this._error);
    } else {
      throw new Error("Invalid result state");
    }
  }

  /**
   * Provide fallback data on failure
   */
  orElse(fallbackData: TData): RepositoryResult<TData, never> {
    if (this._success) {
      return this as any;
    }
    return RepositoryResult.success(fallbackData, this._metadata);
  }

  /**
   * Provide fallback result on failure
   */
  orElseGet(
    fallbackProvider: (_error: TError) => RepositoryResult<TData, TError>,
  ): RepositoryResult<TData, TError> {
    if (this._success) {
      return this;
    }
    return fallbackProvider(this._error!);
  }

  /**
   * Filter data with predicate
   */
  filter(
    predicate: (data: TData) => boolean,
    errorOnFilter: TError,
  ): RepositoryResult<TData, TError> {
    if (!this._success) {
      return this;
    }

    try {
      if (predicate(this._data!)) {
        return this;
      } else {
        return new RepositoryResult<TData, TError>(
          false,
          undefined,
          errorOnFilter,
          this._metadata,
        );
      }
    } catch (_error) {
      return new RepositoryResult<TData, TError>(
        false,
        undefined,
        _error as TError,
        this._metadata,
      );
    }
  }

  /**
   * Convert to Promise (throws on failure)
   */
  toPromise(): Promise<TData> {
    if (this._success && this._data !== undefined) {
      return Promise.resolve(this._data);
    } else {
      return Promise.reject(this._error);
    }
  }

  /**
   * Convert to JSON representation
   */
  toJSON(): ResultJSON<TData, TError> {
    return {
      success: this._success,
      data: this._data,
      error: this._error ? this.serializeError(this._error) : undefined,
      metadata: this._metadata,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create result from JSON representation
   */
  static fromJSON<T, E>(json: ResultJSON<T, E>): RepositoryResult<T, E> {
    if (json.success) {
      return RepositoryResult.success(
        json.data!,
        (json as { metadata?: ResultMetadata }).metadata,
      );
    } else {
      const error = json.error
        ? (this.deserializeError(json.error) as E)
        : undefined;
      return RepositoryResult.failure(
        error!,
        (json as { metadata?: ResultMetadata }).metadata,
      );
    }
  }

  /**
   * Combine multiple results into one
   */
  static combine<T1, T2, E>(
    result1: RepositoryResult<T1, E>,
    result2: RepositoryResult<T2, E>,
  ): RepositoryResult<[T1, T2], E> {
    if (result1.isSuccess && result2.isSuccess) {
      return RepositoryResult.success([result1.data, result2.data]);
    }

    const firstError = result1.isFailure ? result1.error : result2.error;
    return RepositoryResult.failure(firstError);
  }

  /**
   * Combine multiple results with custom combiner
   */
  static combineWith<T1, T2, U, E>(
    result1: RepositoryResult<T1, E>,
    result2: RepositoryResult<T2, E>,
    combiner: (data1: T1, data2: T2) => U,
  ): RepositoryResult<U, E> {
    if (result1.isSuccess && result2.isSuccess) {
      try {
        const combined = combiner(result1.data, result2.data);
        return RepositoryResult.success(combined);
      } catch (_error) {
        return RepositoryResult.failure(_error as E);
      }
    }

    const firstError = result1.isFailure ? result1.error : result2.error;
    return RepositoryResult.failure(firstError);
  }

  /**
   * Process array of results into single result with array data
   */
  static all<T, E>(
    results: RepositoryResult<T, E>[],
  ): RepositoryResult<T[], E> {
    const failures = results.filter((r) => r.isFailure);
    if (failures.length > 0) {
      return RepositoryResult.failure(failures[0].error);
    }

    const data = results.map((r) => r.data);
    return RepositoryResult.success(data);
  }

  private serializeError(error: TError): unknown {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    return error;
  }

  private static deserializeError(serialized: unknown): Error {
    if (
      serialized &&
      typeof serialized === "object" &&
      (serialized as Record<string, unknown>).name &&
      (serialized as Record<string, unknown>).message
    ) {
      const serializedError = serialized as Record<string, unknown>;
      const error = new Error(serializedError.message as string);
      error.name = serializedError.name as string;
      error.stack = serializedError.stack as string;
      return error;
    }
    return new Error(String(serialized));
  }
}

/**
 * Metadata for repository results
 */
export interface ResultMetadata {
  executionTime?: number;
  queryCount?: number;
  cacheHit?: boolean;
  clinicId?: string;
  userId?: string;
  operation?: string;
  timestamp?: Date;
  traceId?: string;
  [key: string]: unknown;
}

/**
 * JSON representation of result
 */
export interface ResultJSON<TData, TError> {
  success: boolean;
  data?: TData;
  error?: unknown;
  metadata?: ResultMetadata;
  timestamp: string;
}

/**
 * Specialized result types for healthcare operations
 */
export type HealthcareResult<T> = RepositoryResult<T, HealthcareError>;
export type ClinicResult<T> = RepositoryResult<T, ClinicError>;
export type PatientResult<T> = RepositoryResult<T, PatientError>;

/**
 * Healthcare-specific error types
 */
export class HealthcareError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
    public readonly isRetryable: boolean = false,
  ) {
    super(message);
    this.name = "HealthcareError";
  }
}

export class ClinicError extends HealthcareError {
  constructor(
    message: string,
    code: string,
    public readonly clinicId?: string,
    details?: unknown,
    isRetryable: boolean = false,
  ) {
    super(message, code, details, isRetryable);
    this.name = "ClinicError";
  }
}

export class PatientError extends HealthcareError {
  constructor(
    message: string,
    code: string,
    public readonly patientId?: string,
    public readonly clinicId?: string,
    details?: unknown,
    isRetryable: boolean = false,
  ) {
    super(message, code, details, isRetryable);
    this.name = "PatientError";
  }
}
