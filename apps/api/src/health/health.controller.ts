import { Controller, Get, Res } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import * as promClient from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';

// Ensure default metrics are collected once at module load
promClient.collectDefaultMetrics();

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
    ]);
  }

  @Get('metrics')
  async metrics(@Res() reply: FastifyReply) {
    const metrics = await promClient.register.metrics();
    return reply
      .header('Content-Type', promClient.register.contentType)
      .send(metrics);
  }
}
