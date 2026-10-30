import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { TemplatesService } from './templates.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { TemplateStatus } from '@speediator/prisma';

const CreateTemplateSchema = z.object({
  whatsappAccountId: z.string().uuid(),
  name: z.string().min(1).max(512).regex(/^[a-z0-9_]+$/, 'lowercase letters, digits and underscores only'),
  language: z.string().min(2).max(5),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  components: z.array(z.object({}).passthrough()).min(1),
});

@UseGuards(JwtAuthGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Get()
  async list(@CurrentUser() user: RequestUser, @Query('status') status?: string) {
    return this.service.list(user.orgId, status as TemplateStatus | undefined);
  }

  @Get(':id')
  async get(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.get(user.orgId, id);
  }

  @Post()
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateTemplateSchema)) body: z.infer<typeof CreateTemplateSchema>,
  ) {
    return this.service.create(user.orgId, body);
  }

  @Post(':whatsappAccountId/sync')
  async sync(@CurrentUser() user: RequestUser, @Param('whatsappAccountId') accountId: string) {
    return this.service.syncFromMeta(user.orgId, accountId);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.delete(user.orgId, id);
  }
}
