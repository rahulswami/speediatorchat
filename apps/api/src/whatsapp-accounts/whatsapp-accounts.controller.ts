import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { WhatsappAccountsService } from './whatsapp-accounts.service';
import { EmbeddedSignupService } from './embedded-signup.service';
import { ConnectionCheckService } from './connection-check.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const ConnectAccountSchema = z.object({
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  displayName: z.string().min(1),
  accessToken: z.string().min(1),
});

const metaId = z.string().regex(/^\d+$/, 'Expected a numeric Meta ID').max(32);
const EmbeddedSignupSchema = z.object({
  code: z.string().min(1).max(2048),
  wabaId: metaId,
  phoneNumberId: metaId.optional(),
  businessId: metaId.optional(),
  event: z.enum(['FINISH', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING']),
});

@UseGuards(JwtAuthGuard)
@Controller('whatsapp-accounts')
export class WhatsappAccountsController {
  constructor(
    private readonly service: WhatsappAccountsService,
    private readonly embeddedSignup: EmbeddedSignupService,
    private readonly connectionCheck: ConnectionCheckService,
  ) {}

  @Post(':id/check')
  @HttpCode(200)
  async check(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.connectionCheck.check(user.orgId, id);
  }

  @Get('embedded-signup/config')
  embeddedSignupConfig() {
    return this.embeddedSignup.getPublicConfig();
  }

  @Post('embedded-signup')
  async completeEmbeddedSignup(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(EmbeddedSignupSchema)) body: z.infer<typeof EmbeddedSignupSchema>,
  ) {
    const { event, ...ids } = body;
    return this.embeddedSignup.complete(user.orgId, {
      ...ids,
      coexistence: event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    });
  }

  @Post(':id/finish-setup')
  @HttpCode(200)
  async finishSetup(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.embeddedSignup.retrySetup(user.orgId, id);
  }

  @Post()
  async connect(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(ConnectAccountSchema)) body: z.infer<typeof ConnectAccountSchema>,
  ) {
    return this.service.connect(user.orgId, body);
  }

  @Get()
  async list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.orgId);
  }

  @Delete(':id')
  @HttpCode(204)
  async disconnect(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.disconnect(user.orgId, id);
  }
}
