import { Controller, Get, Post, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { OutboundWebhooksService } from './outbound-webhooks.service';

@Controller('outbound-webhooks')
@UseGuards(JwtAuthGuard)
export class OutboundWebhooksController {
  constructor(private readonly service: OutboundWebhooksService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: { url: string; events: string[] }) {
    return this.service.create(user.orgId, body);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.orgId);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.remove(user.orgId, id);
  }
}
