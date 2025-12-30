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

export { SocketModule } from '@communication/channels/socket/socket.module';
export { SocketService } from '@communication/channels/socket/socket.service';
export { AppGateway } from '@communication/channels/socket/app.gateway';
export { BaseSocket } from '@communication/channels/socket/base-socket';
export { EventSocketBroadcaster } from '@communication/channels/socket/event-socket.broadcaster';
export { SocketAuthMiddleware } from '@communication/channels/socket/socket-auth.middleware';
