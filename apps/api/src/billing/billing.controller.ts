import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { BillingService } from './billing.service';
import { SubscriptionPlan } from '@speediator/prisma';

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get('subscription')
  subscription(@CurrentUser() user: RequestUser) {
    return this.service.getSubscription(user.orgId);
  }

  @Get('usage')
  usage(@CurrentUser() user: RequestUser) {
    return this.service.getUsage(user.orgId);
  }

  @Post('upgrade')
  upgrade(@CurrentUser() user: RequestUser, @Body() body: { plan: SubscriptionPlan }) {
    return this.service.upgradePlan(user.orgId, body.plan);
  }

  @Post('cancel')
  cancel(@CurrentUser() user: RequestUser) {
    return this.service.cancelSubscription(user.orgId);
  }
}
