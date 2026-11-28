import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { TemplatesService } from './templates.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NewTemplateSchema, RequestUser } from '@speediator/types';
import { readUploadedFile } from '../common/uploaded-file';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { TemplateStatus } from '@speediator/prisma';

const HeaderSampleQuerySchema = z.object({ whatsappAccountId: z.string().uuid() });

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
    @Body(new ZodValidationPipe(NewTemplateSchema)) body: z.infer<typeof NewTemplateSchema>,
  ) {
    return this.service.create(user.orgId, body);
  }

  /** Raw file body; see readUploadedFile for the headers it needs. */
  @Post('header-sample')
  @HttpCode(200)
  async headerSample(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(HeaderSampleQuerySchema)) query: z.infer<typeof HeaderSampleQuerySchema>,
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
  ) {
    return this.service.uploadHeaderSample(user.orgId, query.whatsappAccountId, readUploadedFile(body, headers));
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
