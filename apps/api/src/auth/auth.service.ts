import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RegisterDto, LoginDto, JwtPayload } from '@speediator/types';
import { Role } from '@speediator/prisma';

const REFRESH_REUSE_GRACE_SECONDS = 30;
const REFRESH_PREFIX = 'refresh';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const slugExists = await this.prisma.organization.findUnique({ where: { slug: dto.orgSlug } });
    if (slugExists) throw new ConflictException('Organization slug already taken');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const [user, org] = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email: dto.email, name: dto.name, passwordHash },
      });
      const o = await tx.organization.create({
        data: { slug: dto.orgSlug, name: dto.orgName, timezone: dto.timezone ?? 'Asia/Kolkata' },
      });
      await tx.organizationMember.create({
        data: { organizationId: o.id, userId: u.id, role: Role.OWNER },
      });
      return [u, o] as const;
    });

    return this.issueTokens(user.id, org.id, Role.OWNER);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId: user.id },
      orderBy: { joinedAt: 'asc' },
    });
    if (!membership) throw new UnauthorizedException('No organization found for this user');

    return this.issueTokens(user.id, membership.organizationId, membership.role);
  }

  async refresh(refreshToken: string) {
    let payload: { userId: string; jti: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const key = `${REFRESH_PREFIX}:${payload.userId}:${payload.jti}`;
    const stored = await this.redis.get(key);
    if (!stored) throw new UnauthorizedException('Refresh token revoked');

    const { orgId, role } = JSON.parse(stored) as { orgId: string; role: Role };
    // Short grace period instead of deleting outright: the web app can fire several requests at
    // once after the access token lapses, and each one tries to refresh with the same token.
    await this.redis.set(key, stored, REFRESH_REUSE_GRACE_SECONDS);
    return this.issueTokens(payload.userId, orgId, role);
  }

  async logout(refreshToken: string) {
    try {
      const payload = this.jwt.verify<{ userId: string; jti: string }>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
      await this.redis.del(`${REFRESH_PREFIX}:${payload.userId}:${payload.jti}`);
    } catch {
      // already invalid — treat as logged out
    }
  }

  async issueTokens(userId: string, orgId: string, role: Role | string) {
    const jti = uuidv4();
    const accessPayload: JwtPayload = {
      sub: userId,
      orgId,
      role: role as string,
      type: 'access',
      jti,
    };

    const accessToken = this.jwt.sign(accessPayload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN'),
    });

    const refreshJti = uuidv4();
    const refreshToken = this.jwt.sign(
      { userId, jti: refreshJti },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN'),
      },
    );

    const ttlSeconds = 7 * 24 * 60 * 60;
    await this.redis.set(
      `${REFRESH_PREFIX}:${userId}:${refreshJti}`,
      JSON.stringify({ orgId, role }),
      ttlSeconds,
    );

    return { accessToken, refreshToken };
  }
}
