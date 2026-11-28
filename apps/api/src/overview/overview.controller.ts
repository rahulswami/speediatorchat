import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestUser } from '@speediator/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OverviewService, OVERVIEW_PERIODS, type OverviewPeriod } from './overview.service';

const OverviewQuerySchema = z.object({
  days: z.coerce
    .number()
    .refine((d): d is OverviewPeriod => (OVERVIEW_PERIODS as readonly number[]).includes(d), 'days must be 7, 30 or 90')
    .default(30),
});

@UseGuards(JwtAuthGuard)
@Controller('overview')
export class OverviewController {
  constructor(private readonly service: OverviewService) {}

  @Get()
  get(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(OverviewQuerySchema)) query: z.infer<typeof OverviewQuerySchema>,
  ) {
    return this.service.get(user.orgId, query.days as OverviewPeriod);
  }
}
