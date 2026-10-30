import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InvitesService } from './invites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateInviteSchema, AcceptInviteSchema, RequestUser } from '@speediator/types';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateInviteSchema)) dto: any,
  ) {
    return this.invitesService.create(user.orgId, user.userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  list(@CurrentUser() user: RequestUser) {
    return this.invitesService.list(user.orgId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.invitesService.revoke(user.orgId, id);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  accept(@Body(new ZodValidationPipe(AcceptInviteSchema)) dto: any) {
    return this.invitesService.accept(dto);
  }
}
