/// <reference types="jest" />
/**
 * Pub/sub subscribers on the production Dragonfly client.
 *
 * Production disables ioredis' offline queue, and `duplicate()` copies that setting, so SUBSCRIBE
 * sent on a still-connecting duplicate was rejected ("Stream isn't writeable and
 * enableOfflineQueue options is false"). DragonflyCacheProvider's own copy of subscribe() then
 * swallowed the error and left the half-open connection behind: `socket:relay:v1` and
 * `cache:invalidation` had no subscribers, and every retry leaked a connection. Subscribers now get
 * their own offline queue, failures are logged and the failed connection is closed, and the
 * provider delegates to the one implementation.
 */

import type Redis from 'ioredis';

import { LogLevel } from '@core/types';
import { DragonflyCacheProvider } from '@infrastructure/cache/providers/dragonfly-cache.provider';
import { PREFIX, TestCacheClient } from './support/fake-cache-server';

jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@config/cache.config', () => ({
  isCacheEnabled: (): boolean => true,
  getCacheProvider: (): string => 'dragonfly',
}));

interface FakeSubscriber {
  readonly subscribe: jest.Mock;
  readonly on: jest.Mock;
  readonly disconnect: jest.Mock;
  readonly handlers: Map<string, (...args: unknown[]) => void>;
}

function createFakeSubscriber(subscribeError?: Error): FakeSubscriber {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const subscriber: FakeSubscriber = {
    subscribe: subscribeError
      ? jest.fn().mockRejectedValue(subscribeError)
      : jest.fn().mockResolvedValue(1),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return subscriber;
    }),
    disconnect: jest.fn(),
    handlers,
  };
  return subscriber;
}

function setup(options: { subscribeError?: Error; status?: string } = {}) {
  const subscriber = createFakeSubscriber(options.subscribeError);
  const duplicate = jest.fn().mockReturnValue(subscriber);
  const client = { status: options.status ?? 'ready', duplicate } as unknown as Redis;
  const logger = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new TestCacheClient(PREFIX, client, logger);
  return { service, subscriber, duplicate, logger };
}

describe('BaseCacheClientService.subscribe()', () => {
  it('gives the subscriber connection its own offline queue', async () => {
    const { service, duplicate, subscriber } = setup();

    await service.subscribe('cache:invalidation', jest.fn());

    expect(duplicate).toHaveBeenCalledWith({ enableOfflineQueue: true });
    expect(subscriber.subscribe).toHaveBeenCalledWith('cache:invalidation');
  });

  it('delivers only messages for the subscribed channel', async () => {
    const { service, subscriber } = setup();
    const callback = jest.fn();

    await service.subscribe('socket:relay:v1', callback);
    const onMessage = subscriber.handlers.get('message');
    onMessage?.('socket:relay:v1', 'payload');
    onMessage?.('another-channel', 'ignored');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('payload');
  });

  it('closes the failed subscriber and logs a warning when SUBSCRIBE is rejected', async () => {
    const { service, subscriber, logger } = setup({
      subscribeError: new Error("Stream isn't writeable and enableOfflineQueue options is false"),
    });

    await expect(service.subscribe('cache:invalidation', jest.fn())).resolves.toBeUndefined();

    expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.anything(),
      LogLevel.WARN,
      'Subscribe failed on channel cache:invalidation',
      expect.any(String),
      expect.objectContaining({ channel: 'cache:invalidation' })
    );
  });

  it('skips without opening a connection when the main client is not ready', async () => {
    const { service, duplicate } = setup({ status: 'connecting' });

    await service.subscribe('cache:invalidation', jest.fn());

    expect(duplicate).not.toHaveBeenCalled();
  });
});

describe('DragonflyCacheProvider.subscribe()', () => {
  it('delegates to the Dragonfly client instead of keeping its own copy', async () => {
    const dragonflySubscribe = jest.fn().mockResolvedValue(undefined);
    const provider = Object.create(DragonflyCacheProvider.prototype) as DragonflyCacheProvider;
    Object.assign(provider, { dragonflyService: { subscribe: dragonflySubscribe } });
    const callback = jest.fn();

    await provider.subscribe('cache:invalidation', callback);

    expect(dragonflySubscribe).toHaveBeenCalledWith('cache:invalidation', callback);
  });
});
