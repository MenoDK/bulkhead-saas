import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ADMINS, type AuthUser, CurrentUser, Roles } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService, MAX_EXPORT_ENTRIES } from './audit.service';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().min(1).optional(),
});
const exportQuery = z.object({
  fromSeq: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_EXPORT_ENTRIES).default(1000),
});

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(...ADMINS)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.audit.list(user.tenantId, query.limit, query.before);
  }

  @Get('verify')
  @Roles(...ADMINS)
  verify(@CurrentUser() user: AuthUser) {
    return this.audit.verify(user.tenantId);
  }

  @Get('export')
  @Roles('owner')
  export(@CurrentUser() user: AuthUser, @Query(new ZodPipe(exportQuery)) query: z.infer<typeof exportQuery>) {
    return this.audit.export(user.tenantId, query.fromSeq, query.limit);
  }
}
