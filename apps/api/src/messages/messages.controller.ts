import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const SendTextSchema = z.object({ body: z.string().trim().min(1).max(4096) });
const SendTemplateSchema = z.object({ templateId: z.string().uuid() });

@UseGuards(JwtAuthGuard)
@Controller('conversations/:conversationId/messages')
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.service.list(user.orgId, conversationId);
  }

  @Post()
  async send(
    @CurrentUser() user: RequestUser,
    @Param('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(SendTextSchema)) body: z.infer<typeof SendTextSchema>,
  ) {
    return this.service.sendText(user.orgId, conversationId, body.body, user.userId);
  }

  @Post('template')
  async sendTemplate(
    @CurrentUser() user: RequestUser,
    @Param('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(SendTemplateSchema)) body: z.infer<typeof SendTemplateSchema>,
  ) {
    return this.service.sendTemplate(user.orgId, conversationId, body.templateId);
  }
}
