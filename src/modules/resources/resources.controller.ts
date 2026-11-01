import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ADMINS, ANY_ROLE, type AuthUser, CurrentUser, Roles, WRITERS } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { ResourcesService } from './resources.service';

const dataSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 16_000, { message: 'data is limited to 16 KB' });
const createSchema = z.object({ name: z.string().trim().min(1).max(200), data: dataSchema.default({}) });
const updateSchema = z.object({
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  data: dataSchema.optional(),
  status: z.enum(['active', 'archived']).optional(),
});
const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(300).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

@Controller('resources')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Post()
  @Roles(...WRITERS)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.resources.create(user, body);
  }

  @Get()
  @Roles(...ANY_ROLE)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.resources.list(user, query);
  }

  @Get(':id')
  @Roles(...ANY_ROLE)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.resources.get(user, id);
  }

  @Patch(':id')
  @Roles(...WRITERS)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.resources.update(user, id, body);
  }

  @Delete(':id')
  @Roles(...ADMINS)
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.resources.remove(user, id);
  }
}
