import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ADMINS, ANY_ROLE, type AuthUser, CurrentUser, Roles, WRITERS } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { type IdempotentResult, requireIdempotencyKey } from '../idempotency/idempotency.service';
import { BillingService } from './billing.service';

const amount = z.string().regex(/^\d{1,12}(\.\d{1,3})?$/, 'Use a decimal string such as "12.50"');
const createSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(200),
        quantity: z.number().int().min(1).max(100_000),
        unitPrice: amount,
      }),
    )
    .min(1)
    .max(200),
});
const paySchema = z.object({ amount });
const refundSchema = z.object({ amount, reason: z.string().trim().max(300).optional() });
const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(300).optional(),
});

/** Replays are marked, so a client (and a test) can tell "done now" from "already done". */
function respond<T extends object>(res: Response, result: IdempotentResult<T>): T {
  res.status(result.status).setHeader('Idempotent-Replayed', String(result.replayed));
  return result.body;
}

@Controller('invoices')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post()
  @Roles(...WRITERS)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.billing.createInvoice(user, body, requireIdempotencyKey(key)));
  }

  @Get()
  @Roles(...ANY_ROLE)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.billing.list(user, query);
  }

  @Get(':id')
  @Roles(...ANY_ROLE)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.get(user, id);
  }

  @Post(':id/issue')
  @Roles(...WRITERS)
  @HttpCode(200)
  issue(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.issue(user, id);
  }

  @Post(':id/void')
  @Roles(...ADMINS)
  @HttpCode(200)
  void(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.void(user, id);
  }

  @Post(':id/payments')
  @Roles(...WRITERS)
  async pay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(paySchema)) body: z.infer<typeof paySchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.billing.pay(user, id, body.amount, requireIdempotencyKey(key)));
  }

  @Post(':id/refunds')
  @Roles(...WRITERS)
  async refund(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(refundSchema)) body: z.infer<typeof refundSchema>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.billing.refund(user, id, body, requireIdempotencyKey(key)));
  }
}
