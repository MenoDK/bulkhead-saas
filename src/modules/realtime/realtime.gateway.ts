import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

export const tenantRoom = (tenantId: string): string => `tenant:${tenantId}`;

/**
 * Tenant isolation for sockets is structural: the room is derived from the VERIFIED token on
 * connect, and the gateway exposes no "join"/"subscribe" message at all, so a client has no way to
 * name another tenant's room.
 */
@WebSocketGateway({ path: '/socket.io', transports: ['websocket', 'polling'] })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly expiry = new Map<string, NodeJS.Timeout>();

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string') throw new Error('missing token');
      const claims = await this.jwt.verifyAsync<{ sub: string; tid: string; exp: number }>(token, {
        algorithms: ['HS256'],
      });
      if (!claims.tid || !claims.sub) throw new Error('bad claims');

      await client.join(tenantRoom(claims.tid));
      // A socket outlives the request that authenticated it; cut it when the access token expires.
      const timer = setTimeout(() => client.disconnect(true), Math.max(0, claims.exp * 1000 - Date.now()));
      timer.unref();
      this.expiry.set(client.id, timer);
    } catch {
      client.emit('error', { code: 'UNAUTHORIZED' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const timer = this.expiry.get(client.id);
    if (timer) clearTimeout(timer);
    this.expiry.delete(client.id);
  }

  /** Call AFTER the database transaction committed: never announce something that may still roll back. */
  emitToTenant(tenantId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to(tenantRoom(tenantId)).emit(event, payload);
    this.logger.debug(`emit ${event} -> ${tenantRoom(tenantId)}`);
  }
}
