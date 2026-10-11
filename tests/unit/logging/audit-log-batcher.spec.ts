import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  AuditLogBatcher,
  type AuditLogRow,
} from '../../../src/libs/infrastructure/logging/audit-log-batcher';

const row = (n: number): AuditLogRow => ({
  userId: 'system',
  action: 'REQUEST',
  description: `line ${n}`,
  ipAddress: null,
  device: null,
  clinicId: null,
});

const options = { maxRows: 3, delayMs: 1000, maxQueued: 5 };

describe('AuditLogBatcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes several rows as one batch after the delay', async () => {
    const write = jest.fn<(rows: readonly AuditLogRow[]) => Promise<void>>().mockResolvedValue();
    const batcher = new AuditLogBatcher(write, { ...options, onError: jest.fn() });
    batcher.add(row(1));
    batcher.add(row(2));
    expect(write).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('writes at once when the batch is full', async () => {
    const write = jest.fn<(rows: readonly AuditLogRow[]) => Promise<void>>().mockResolvedValue();
    const batcher = new AuditLogBatcher(write, { ...options, onError: jest.fn() });
    batcher.add(row(1));
    batcher.add(row(2));
    batcher.add(row(3));
    await batcher.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it('reports a failed write and keeps working afterwards', async () => {
    const onError = jest.fn();
    const write = jest
      .fn<(rows: readonly AuditLogRow[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue();
    const batcher = new AuditLogBatcher(write, { ...options, onError });
    batcher.add(row(1));
    await batcher.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    batcher.add(row(2));
    await batcher.flush();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('drops rows past the queue limit instead of growing', async () => {
    const write = jest.fn<(rows: readonly AuditLogRow[]) => Promise<void>>().mockResolvedValue();
    const batcher = new AuditLogBatcher(write, { maxRows: 100, delayMs: 1000, maxQueued: 2, onError: jest.fn() });
    batcher.add(row(1));
    batcher.add(row(2));
    batcher.add(row(3));
    expect(batcher.pending).toBe(2);
    await batcher.flush();
    expect(write.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('does not write when nothing is waiting', async () => {
    const write = jest.fn<(rows: readonly AuditLogRow[]) => Promise<void>>().mockResolvedValue();
    const batcher = new AuditLogBatcher(write, { ...options, onError: jest.fn() });
    await batcher.flush();
    expect(write).not.toHaveBeenCalled();
  });
});
