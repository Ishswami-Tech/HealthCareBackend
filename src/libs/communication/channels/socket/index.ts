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

export * from '@communication/channels/socket/socket.module';
export * from '@communication/channels/socket/socket.service';
export * from '@communication/channels/socket/app.gateway';
export * from '@communication/channels/socket/base-socket';
export * from '@communication/channels/socket/event-socket.broadcaster';
export * from '@communication/channels/socket/socket-auth.middleware';
