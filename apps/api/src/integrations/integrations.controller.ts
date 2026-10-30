import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { IntegrationsService } from './integrations.service';
import { IntegrationType } from '@speediator/prisma';

@Controller('integrations')
@UseGuards(JwtAuthGuard)
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.orgId);
  }

  @Post(':type/connect')
  connect(
    @CurrentUser() user: RequestUser,
    @Param('type') type: IntegrationType,
    @Body() config: Record<string, unknown>,
  ) {
    return this.service.connect(user.orgId, type, config);
  }

  @Post(':type/disconnect')
  disconnect(@CurrentUser() user: RequestUser, @Param('type') type: IntegrationType) {
    return this.service.disconnect(user.orgId, type);
  }
}
