import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateInviteDto, AcceptInviteDto } from '@speediator/types';
import { Role } from '@speediator/prisma';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  async create(organizationId: string, invitedById: string, dto: CreateInviteDto) {
    const existing = await this.prisma.invite.findFirst({
      where: {
        organizationId,
        email: dto.email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (existing) throw new ConflictException('A pending invite for this email already exists');

    const alreadyMember = await this.prisma.organizationMember.findFirst({
      where: { organizationId, user: { email: dto.email } },
    });
    if (alreadyMember) throw new ConflictException('User is already a member of this organization');

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invite = await this.prisma.invite.create({
      data: {
        organizationId,
        email: dto.email,
        role: dto.role as Role,
        token: uuidv4(),
        invitedById,
        expiresAt,
      },
    });

    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    const link = `${appUrl}/invite/accept?token=${invite.token}`;
    this.logger.log(`[DEV] Invite link for ${dto.email}: ${link}`);

    return { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt };
  }

  async list(organizationId: string) {
    return this.prisma.invite.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(organizationId: string, inviteId: string) {
    const invite = await this.prisma.invite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.organizationId !== organizationId) {
      throw new NotFoundException('Invite not found');
    }
    await this.prisma.invite.delete({ where: { id: inviteId } });
  }

  async accept(dto: AcceptInviteDto) {
    const invite = await this.prisma.invite.findUnique({ where: { token: dto.token } });
    if (!invite) throw new NotFoundException('Invalid or expired invite token');
    if (invite.acceptedAt) throw new BadRequestException('Invite already accepted');
    if (invite.expiresAt < new Date()) throw new BadRequestException('Invite has expired');

    const existingUser = await this.prisma.user.findUnique({ where: { email: invite.email } });

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      if (!dto.name || !dto.password) {
        throw new BadRequestException('name and password are required for new users');
      }
      const passwordHash = await bcrypt.hash(dto.password, 10);
      const newUser = await this.prisma.user.create({
        data: { email: invite.email, name: dto.name, passwordHash },
      });
      userId = newUser.id;
    }

    const alreadyMember = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: invite.organizationId, userId } },
    });

    await this.prisma.$transaction(async (tx) => {
      if (!alreadyMember) {
        await tx.organizationMember.create({
          data: {
            organizationId: invite.organizationId,
            userId,
            role: invite.role,
            invitedById: invite.invitedById,
          },
        });
      }
      await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    });

    return this.authService.issueTokens(userId, invite.organizationId, invite.role);
  }
}
