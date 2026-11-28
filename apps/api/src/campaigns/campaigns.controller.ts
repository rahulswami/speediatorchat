import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AudienceFilterSchema, RequestUser, TemplateVariablesSchema } from '@speediator/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CampaignsService, RECIPIENT_FILTERS } from './campaigns.service';

const scheduledAt = z
  .string()
  .datetime({ offset: true })
  .refine((v) => new Date(v).getTime() > Date.now() - 60_000, 'Schedule time is in the past')
  .optional();

const CreateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  whatsappAccountId: z.string().uuid(),
  templateId: z.string().uuid(),
  audienceFilter: AudienceFilterSchema.default({ mode: 'all' }),
  variableMap: TemplateVariablesSchema.optional(),
  scheduledAt,
});

const UpdateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  audienceFilter: AudienceFilterSchema.optional(),
  variableMap: TemplateVariablesSchema.optional(),
  scheduledAt,
});

const AudiencePreviewSchema = z.object({ audienceFilter: AudienceFilterSchema });

const RecipientsQuerySchema = z.object({
  status: z.enum(RECIPIENT_FILTERS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateCampaignSchema)) body: z.infer<typeof CreateCampaignSchema>,
  ) {
    return this.service.create(user.orgId, user.userId, body);
  }

  /** How many contacts a filter would reach, before the campaign exists. */
  @Post('audience-preview')
  @HttpCode(200)
  audiencePreview(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(AudiencePreviewSchema)) body: z.infer<typeof AudiencePreviewSchema>,
  ) {
    return this.service.countAudience(user.orgId, body.audienceFilter);
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

  @Get(':id/recipients')
  recipients(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(RecipientsQuerySchema)) query: z.infer<typeof RecipientsQuerySchema>,
  ) {
    return this.service.listRecipients(user.orgId, id, query);
  }

  @Get(':id/audience-count')
  audienceCount(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getAudienceCount(user.orgId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCampaignSchema)) body: z.infer<typeof UpdateCampaignSchema>,
  ) {
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
