import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UpdateOrgSchema, RequestUser } from '@speediator/types';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  @Get('me')
  getMe(@CurrentUser() user: RequestUser) {
    return this.orgsService.findById(user.orgId);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(UpdateOrgSchema)) dto: any,
  ) {
    return this.orgsService.update(user.orgId, dto);
  }
}
