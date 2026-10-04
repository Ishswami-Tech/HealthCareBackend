/// <reference types="jest" />
import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { LoggingService } from '@infrastructure/logging/logging.service';
import { SocketAuthMiddleware } from '@communication/channels/socket/socket-auth.middleware';
import { ErrorCode } from '@core/errors/error-codes.enum';

jest.mock('@infrastructure/logging/logging.service', () => ({ LoggingService: class {} }));

function setup(authToken?: string) {
  const verifyAsync = jest.fn().mockResolvedValue({ sub: 'user-1', clinicId: 'clinic-1' });
  const middleware = new SocketAuthMiddleware(
    { verifyAsync } as unknown as JwtService,
    { log: jest.fn().mockResolvedValue(undefined) } as unknown as LoggingService
  );
  const emit = jest.fn();
  const socket = {
    id: 'socket-1',
    request: {},
    emit,
    handshake: {
      auth: authToken ? { token: authToken } : {},
      query: {},
      headers: { cookie: 'access_token=stale-cookie' },
    },
  } as unknown as Socket;
  return { middleware, verifyAsync, socket, emit };
}

describe('Socket auth renewal', () => {
  it('uses a refreshed explicit token instead of an old browser cookie', async () => {
    const s = setup('fresh-handshake');
    await expect(s.middleware.validateConnection(s.socket)).resolves.toMatchObject({
      userId: 'user-1',
    });
    expect(s.verifyAsync).toHaveBeenCalledWith('fresh-handshake');
  });

  it('keeps cookie authentication for clients without an explicit token', async () => {
    const s = setup();
    await s.middleware.validateConnection(s.socket);
    expect(s.verifyAsync).toHaveBeenCalledWith('stale-cookie');
  });

  it('rejects expired tokens and asks the client to refresh', async () => {
    const s = setup('expired');
    const error = new Error('jwt expired');
    error.name = 'TokenExpiredError';
    s.verifyAsync.mockRejectedValue(error);
    await expect(s.middleware.validateConnection(s.socket)).rejects.toMatchObject({
      code: ErrorCode.AUTH_TOKEN_EXPIRED,
    });
    expect(s.emit).toHaveBeenCalledWith('token_expired', {
      message: 'Access token has expired',
      canReconnect: true,
    });
  });
});
