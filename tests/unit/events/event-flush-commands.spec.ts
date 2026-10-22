import { describe, expect, it } from '@jest/globals';
import Redis from 'ioredis';
import {
  EVENT_TIMESTAMP_INDEX_MAX_ENTRIES,
  buildEventFlushCommands,
} from '@infrastructure/events/event.service';

const NOW = Date.parse('2026-10-22T06:00:00Z');

describe('EventService buffered flush (events were never stored)', () => {
  it('uses command names the ioredis pipeline really has (lower case)', () => {
    const client = new Redis({ lazyConnect: true, enableOfflineQueue: false });
    try {
      const pipeline = client.pipeline() as unknown as Record<string, unknown>;
      // The old flush sent 'SET' / 'ZADD': the pipeline has no such methods, so nothing ran.
      expect(typeof pipeline['SET']).not.toBe('function');
      expect(typeof pipeline['ZADD']).not.toBe('function');
      const commands = buildEventFlushCommands(
        [{ eventId: 'e-1', timestamp: '2026-10-22T05:59:00Z', ttlSeconds: 7200, json: '{}' }],
        NOW
      );
      for (const { command } of commands) {
        expect(command).toBe(command.toLowerCase());
        expect(typeof pipeline[command]).toBe('function');
      }
    } finally {
      client.disconnect();
    }
  });

  it('stores each event with its TTL and indexes it by time', () => {
    const commands = buildEventFlushCommands(
      [
        { eventId: 'e-1', timestamp: '2026-10-22T05:59:00Z', ttlSeconds: 7200, json: '{"a":1}' },
        { eventId: 'e-2', timestamp: 'not a date', ttlSeconds: 0, json: '{"b":2}' },
      ],
      NOW
    );
    expect(commands[0]).toEqual({ command: 'set', args: ['event:e-1', '{"a":1}', 'EX', 7200] });
    expect(commands[1]).toEqual({
      command: 'zadd',
      args: ['events:by_timestamp', Date.parse('2026-10-22T05:59:00Z'), 'e-1'],
    });
    // A TTL is never 0 (no key without expiry), a bad timestamp falls back to now.
    expect(commands[2]?.args[3]).toBe(1);
    expect(commands[3]?.args[1]).toBe(NOW);
  });

  it('bounds the time index by age, by count and with a TTL', () => {
    const commands = buildEventFlushCommands(
      [{ eventId: 'e-1', timestamp: '2026-10-22T05:59:00Z', ttlSeconds: 60, json: '{}' }],
      NOW
    );
    const names = commands.map(command => command.command);
    expect(names).toEqual(['set', 'zadd', 'zremrangebyscore', 'zremrangebyrank', 'expire']);
    const byRank = commands.find(command => command.command === 'zremrangebyrank');
    expect(byRank?.args).toEqual([
      'events:by_timestamp',
      0,
      -(EVENT_TIMESTAMP_INDEX_MAX_ENTRIES + 1),
    ]);
    const expire = commands.find(command => command.command === 'expire');
    expect(Number(expire?.args[1])).toBeGreaterThan(0);
  });

  it('an empty buffer writes nothing', () => {
    expect(buildEventFlushCommands([], NOW)).toEqual([]);
  });
});
