import { Controller, Get, Delete, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { MembersService } from './members.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';

@Controller('members')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.membersService.list(user.orgId);
  }

  @Delete(':userId')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('userId') targetUserId: string, @CurrentUser() user: RequestUser) {
    return this.membersService.remove(user.orgId, targetUserId, user.userId);
  }
}
