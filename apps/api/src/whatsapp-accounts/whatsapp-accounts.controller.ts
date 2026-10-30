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

@UseGuards(JwtAuthGuard)
@Controller('whatsapp-accounts')
export class WhatsappAccountsController {
  constructor(private readonly service: WhatsappAccountsService) {}

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
