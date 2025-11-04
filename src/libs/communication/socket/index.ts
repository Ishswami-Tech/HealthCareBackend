/**
 * WebSocket services exports
 *
 * Provides real-time WebSocket communication:
 * - SocketService: Core WebSocket service for broadcasting
 * - AppGateway: Main WebSocket gateway
 * - EventSocketBroadcaster: Event-to-socket bridge
 * - SocketAuthMiddleware: WebSocket authentication middleware
 *
 * @module Socket
 */

export * from '@communication/socket/socket.module';
export * from '@communication/socket/socket.service';
export * from '@communication/socket/app.gateway';
export * from '@communication/socket/base-socket';
export * from '@communication/socket/event-socket.broadcaster';
export * from '@communication/socket/socket-auth.middleware';
