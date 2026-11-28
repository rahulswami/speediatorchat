import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const OVERVIEW_PERIODS = [7, 30, 90] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];

// Reports are for Indian businesses, so a "day" is an IST calendar day.
const REPORT_TIME_ZONE = 'Asia/Kolkata';

export interface DailyActivity {
  day: string;
  inbound: number;
  outbound: number;
}

export function percent(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

/** Fills days with no messages so the chart has one bar per day of the period. */
export function fillDays(
  rows: Array<{ day: string; inbound: number; outbound: number }>,
  days: number,
  now: Date,
): DailyActivity[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE });
  const out: DailyActivity[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = fmt.format(new Date(now.getTime() - i * 86_400_000));
    const r = byDay.get(day);
    out.push({ day, inbound: r?.inbound ?? 0, outbound: r?.outbound ?? 0 });
  }
  return out;
}

@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string, days: OverviewPeriod, now = new Date()) {
    const since = new Date(now.getTime() - days * 86_400_000);
    const org = { organizationId };
    const outboundInPeriod = { ...org, direction: 'OUTBOUND' as const, createdAt: { gte: since } };

    const [
      contactsTotal, contactsOptedIn, contactsOptedOut, contactsNew,
      openConversations, pendingConversations,
      inbound, outbound, outboundByStatus,
      templatesByStatus, numbersConnected,
      campaignsByStatus, recentCampaigns, daily,
    ] = await Promise.all([
      this.prisma.contact.count({ where: org }),
      this.prisma.contact.count({ where: { ...org, optedIn: true, optedOut: false } }),
      this.prisma.contact.count({ where: { ...org, optedOut: true } }),
      this.prisma.contact.count({ where: { ...org, createdAt: { gte: since } } }),
      this.prisma.conversation.count({ where: { ...org, status: 'OPEN' } }),
      this.prisma.conversation.count({ where: { ...org, status: 'PENDING' } }),
      this.prisma.message.count({ where: { ...org, direction: 'INBOUND', createdAt: { gte: since } } }),
      this.prisma.message.count({ where: outboundInPeriod }),
      this.prisma.message.groupBy({ by: ['status'], where: outboundInPeriod, _count: { _all: true } }),
      this.prisma.template.groupBy({ by: ['status'], where: org, _count: { _all: true } }),
      this.prisma.whatsappAccount.count({ where: { ...org, status: 'CONNECTED' } }),
      this.prisma.campaign.groupBy({ by: ['status'], where: org, _count: { _all: true } }),
      this.prisma.campaign.findMany({
        where: org,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, status: true, createdAt: true },
      }),
      this.prisma.$queryRaw<Array<{ day: string; inbound: number; outbound: number }>>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${REPORT_TIME_ZONE}, 'YYYY-MM-DD') AS day,
               COUNT(*) FILTER (WHERE direction = 'INBOUND')::int AS inbound,
               COUNT(*) FILTER (WHERE direction = 'OUTBOUND')::int AS outbound
        FROM messages
        WHERE "organizationId" = ${organizationId} AND "createdAt" >= ${since}
        GROUP BY 1`,
    ]);

    const statusCount = (rows: Array<{ status: string; _count: { _all: number } }>, ...statuses: string[]) =>
      rows.filter((r) => statuses.includes(r.status)).reduce((n, r) => n + r._count._all, 0);

    // A read message was also delivered and sent, so each figure includes the later stages.
    const sent = statusCount(outboundByStatus, 'SENT', 'DELIVERED', 'READ');
    const delivered = statusCount(outboundByStatus, 'DELIVERED', 'READ');
    const read = statusCount(outboundByStatus, 'READ');

    const recent = await Promise.all(
      recentCampaigns.map(async (c) => {
        const rows = await this.prisma.campaignContact.groupBy({
          by: ['status'],
          where: { campaignId: c.id, campaign: org },
          _count: { _all: true },
        });
        const cs = (...s: string[]) => statusCount(rows, ...s);
        return {
          ...c,
          recipients: cs('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED_OPTED_OUT', 'SKIPPED_NO_SESSION'),
          sent: cs('SENT', 'DELIVERED', 'READ'),
          delivered: cs('DELIVERED', 'READ'),
          read: cs('READ'),
          failed: cs('FAILED'),
        };
      }),
    );

    return {
      periodDays: days,
      contacts: { total: contactsTotal, optedIn: contactsOptedIn, optedOut: contactsOptedOut, new: contactsNew },
      conversations: { open: openConversations, pending: pendingConversations },
      messages: {
        inbound,
        outbound,
        sent,
        delivered,
        read,
        failed: statusCount(outboundByStatus, 'FAILED'),
        deliveryRate: percent(delivered, sent),
        readRate: percent(read, delivered),
      },
      templates: {
        approved: statusCount(templatesByStatus, 'APPROVED'),
        pending: statusCount(templatesByStatus, 'PENDING'),
        rejected: statusCount(templatesByStatus, 'REJECTED'),
      },
      numbersConnected,
      campaigns: {
        total: campaignsByStatus.reduce((n, r) => n + r._count._all, 0),
        running: statusCount(campaignsByStatus, 'RUNNING', 'SCHEDULED'),
        completed: statusCount(campaignsByStatus, 'COMPLETED'),
      },
      recentCampaigns: recent,
      daily: fillDays(daily, days, now),
    };
  }
}
