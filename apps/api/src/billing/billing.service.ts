import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionPlan, SubscriptionStatus } from '@speediator/prisma';

const PLAN_LIMITS: Record<SubscriptionPlan, { contacts: number; campaigns: number; agents: number }> = {
  STARTER: { contacts: 1_000, campaigns: 5, agents: 2 },
  GROWTH: { contacts: 10_000, campaigns: 30, agents: 10 },
  SCALE: { contacts: 100_000, campaigns: 999, agents: 99 },
};

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async getSubscription(organizationId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (!sub) return this.createTrial(organizationId);
    return sub;
  }

  async getUsage(organizationId: string) {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const records = await this.prisma.usageRecord.findMany({
      where: { organizationId, periodStart: { gte: periodStart }, periodEnd: { lte: periodEnd } },
    });
    const usage: Record<string, number> = {};
    for (const r of records) usage[r.metric] = r.value;

    const sub = await this.getSubscription(organizationId);
    const limits = PLAN_LIMITS[sub.plan];

    return { usage, limits, plan: sub.plan, status: sub.status };
  }

  async getLimits(organizationId: string) {
    const sub = await this.getSubscription(organizationId);
    return PLAN_LIMITS[sub.plan];
  }

  async checkQuota(organizationId: string, metric: 'contacts' | 'campaigns') {
    const { usage, limits } = await this.getUsage(organizationId);
    const current = usage[metric] ?? 0;
    return current < limits[metric];
  }

  async incrementUsage(organizationId: string, metric: string, amount = 1) {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    await this.prisma.usageRecord.upsert({
      where: { organizationId_metric_periodStart: { organizationId, metric, periodStart } },
      create: { organizationId, metric, periodStart, periodEnd, value: amount },
      update: { value: { increment: amount } },
    });
  }

  async upgradePlan(organizationId: string, plan: SubscriptionPlan) {
    return this.prisma.subscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        plan,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: { plan, status: SubscriptionStatus.ACTIVE },
    });
  }

  async cancelSubscription(organizationId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (!sub) throw new NotFoundException('No subscription found');
    return this.prisma.subscription.update({
      where: { organizationId },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
    });
  }

  private async createTrial(organizationId: string) {
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    return this.prisma.subscription.create({
      data: {
        organizationId,
        plan: SubscriptionPlan.STARTER,
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: trialEnd,
      },
    });
  }
}
