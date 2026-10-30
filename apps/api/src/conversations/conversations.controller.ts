import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ConversationStatus } from '@speediator/prisma';

const UpdateStatusSchema = z.object({
  status: z.enum(['OPEN', 'PENDING', 'RESOLVED', 'SNOOZED']),
});

const AssignSchema = z.object({
  userId: z.string().nullable(),
});

@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(user.orgId, {
      status: status as ConversationStatus | undefined,
      assignedTo,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  async get(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.get(user.orgId, id);
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateStatusSchema)) body: z.infer<typeof UpdateStatusSchema>,
  ) {
    return this.service.updateStatus(user.orgId, id, body.status as ConversationStatus);
  }

  @Patch(':id/assign')
  async assign(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AssignSchema)) body: z.infer<typeof AssignSchema>,
  ) {
    return this.service.assign(user.orgId, id, body.userId);
  }

  @Post(':id/suggest-reply')
  async suggestReply(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.suggestReply(user.orgId, id);
  }
}
