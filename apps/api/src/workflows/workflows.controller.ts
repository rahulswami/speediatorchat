import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { WorkflowsService } from './workflows.service';

@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowsController {
  constructor(private readonly service: WorkflowsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: {
    name: string;
    triggerType: string;
    triggerConfig?: object;
    nodes?: unknown[];
    edges?: unknown[];
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

  @Get(':id/executions')
  executions(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listExecutions(user.orgId, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: {
    name?: string;
    triggerType?: string;
    triggerConfig?: object;
    nodes?: unknown[];
    edges?: unknown[];
  }) {
    return this.service.update(user.orgId, id, body);
  }

  @Post(':id/publish')
  publish(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.publish(user.orgId, id);
  }

  @Post(':id/deactivate')
  deactivate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.deactivate(user.orgId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.remove(user.orgId, id);
  }
}
