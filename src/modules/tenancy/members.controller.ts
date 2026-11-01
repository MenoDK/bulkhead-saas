import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ADMINS, ANY_ROLE, type AuthUser, CurrentUser, ROLES, Roles } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../identity/password';
import { MembersService } from './members.service';

const addSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  role: z.enum(ROLES),
});
const updateSchema = z
  .object({ role: z.enum(ROLES).optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, {
    message: 'Nothing to change',
  });

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @Roles(...ANY_ROLE)
  list(@CurrentUser() user: AuthUser) {
    return this.members.list(user.tenantId);
  }

  @Post()
  @Roles(...ADMINS)
  add(@CurrentUser() user: AuthUser, @Body(new ZodPipe(addSchema)) body: z.infer<typeof addSchema>) {
    return this.members.add(user, body);
  }

  @Patch(':userId')
  @Roles(...ADMINS)
  update(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.members.update(user, userId, body);
  }
}
