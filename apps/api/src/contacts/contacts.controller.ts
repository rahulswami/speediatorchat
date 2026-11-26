import {
  Controller,
  Get,
  Patch,
  Delete,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ContactsService } from './contacts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '@speediator/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const UpdateContactSchema = z.object({
  name: z.string().min(1).optional(),
  optedIn: z.boolean().optional(),
});

const optInFields = {
  optedIn: z.boolean().default(false),
  optInSource: z.string().trim().max(200).optional(),
  defaultCountryCode: z.string().regex(/^\d{1,4}$/).default('91'),
};
const optInSourceRequired = (d: { optedIn: boolean; optInSource?: string }) =>
  !d.optedIn || !!d.optInSource;
const optInSourceMessage = {
  message: 'Say where consent came from when opting in',
  path: ['optInSource'],
};
const optionalName = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => v || undefined);

const CreateContactSchema = z
  .object({ phone: z.string().trim().min(1).max(40), name: optionalName, ...optInFields })
  .refine(optInSourceRequired, optInSourceMessage);

const MAX_IMPORT_ROWS = 5000;
const ImportContactsSchema = z
  .object({
    rows: z
      .array(z.object({ phone: z.string().max(40), name: optionalName }))
      .min(1)
      .max(MAX_IMPORT_ROWS),
    ...optInFields,
  })
  .refine(optInSourceRequired, optInSourceMessage);

const TagSchema = z.object({ name: z.string().min(1) });
const AttributeSchema = z.object({ key: z.string().min(1), value: z.string() });

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('optedIn') optedIn?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(user.orgId, {
      search,
      optedIn: optedIn !== undefined ? optedIn === 'true' : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post()
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateContactSchema)) body: z.infer<typeof CreateContactSchema>,
  ) {
    return this.service.create(user.orgId, body);
  }

  @Post('import')
  @HttpCode(200)
  async import(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(ImportContactsSchema)) body: z.infer<typeof ImportContactsSchema>,
  ) {
    return this.service.import(user.orgId, body);
  }

  @Get(':id')
  async get(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.get(user.orgId, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateContactSchema)) body: z.infer<typeof UpdateContactSchema>,
  ) {
    return this.service.update(user.orgId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.delete(user.orgId, id);
  }

  @Post(':id/tags')
  async addTag(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TagSchema)) body: z.infer<typeof TagSchema>,
  ) {
    return this.service.addTag(user.orgId, id, body.name);
  }

  @Delete(':id/tags/:tagId')
  @HttpCode(204)
  async removeTag(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    await this.service.removeTag(user.orgId, id, tagId);
  }

  @Post(':id/attributes')
  async setAttribute(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AttributeSchema)) body: z.infer<typeof AttributeSchema>,
  ) {
    return this.service.setAttribute(user.orgId, id, body.key, body.value);
  }

  @Post(':id/gdpr-erase')
  @HttpCode(204)
  async gdprErase(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.eraseGdpr(user.orgId, id);
  }
}
