import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*', credentials: true }, namespace: '/inbox' })
export class InboxGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(InboxGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token =
        (socket.handshake.auth as Record<string, string>).token ??
        socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) throw new Error('No token');

      const payload = this.jwt.verify<{ orgId: string }>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });

      socket.data.orgId = payload.orgId;
      await socket.join(`org:${payload.orgId}`);
      this.logger.debug(`Socket ${socket.id} joined org:${payload.orgId}`);
    } catch {
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    this.logger.debug(`Socket ${socket.id} disconnected`);
  }

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _data: unknown,
  ) {
    return { event: 'joined', orgId: socket.data.orgId as string };
  }

  emitConversationUpdated(orgId: string, payload: object) {
    this.server.to(`org:${orgId}`).emit('conversation.updated', payload);
  }

  emitMessageReceived(orgId: string, payload: object) {
    this.server.to(`org:${orgId}`).emit('message.received', payload);
  }
}
