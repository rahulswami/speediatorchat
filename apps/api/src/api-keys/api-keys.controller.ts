import { Controller, Get, Post, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { ApiKeysService } from './api-keys.service';

@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: { name: string; scopes: string[]; expiresAt?: string }) {
    return this.service.create(user.orgId, user.userId, body);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.orgId);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.revoke(user.orgId, id);
  }
}
