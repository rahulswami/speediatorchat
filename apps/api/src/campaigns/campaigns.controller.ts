import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { CampaignsService } from './campaigns.service';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: {
    name: string;
    whatsappAccountId: string;
    templateId: string;
    audienceFilter?: object;
    variableMap?: object;
    scheduledAt?: string;
  }) {
    return this.service.create(user.orgId, user.userId, body);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.orgId);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.get(user.orgId, id);
  }

  @Get(':id/analytics')
  analytics(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getAnalytics(user.orgId, id);
  }

  @Get(':id/audience-count')
  audienceCount(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getAudienceCount(user.orgId, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: {
    name?: string;
    audienceFilter?: object;
    variableMap?: object;
    scheduledAt?: string;
  }) {
    return this.service.update(user.orgId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.remove(user.orgId, id);
  }

  @Post(':id/launch')
  launch(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.launch(user.orgId, id);
  }

  @Post(':id/pause')
  pause(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.pause(user.orgId, id);
  }
}
