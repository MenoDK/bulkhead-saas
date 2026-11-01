import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { ADMINS, type AuthUser, CurrentUser, Roles } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { WebhookEndpointsService } from './webhook-endpoints.service';

const createSchema = z.object({ url: z.url().max(500) });

@Controller('webhook-endpoints')
export class WebhookEndpointsController {
  constructor(private readonly endpoints: WebhookEndpointsService) {}

  @Post()
  @Roles(...ADMINS)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.endpoints.create(user, body.url);
  }

  @Get()
  @Roles(...ADMINS)
  list(@CurrentUser() user: AuthUser) {
    return this.endpoints.list(user);
  }

  @Delete(':id')
  @Roles(...ADMINS)
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.endpoints.remove(user, id);
  }

  @Post(':id/ping')
  @Roles(...ADMINS)
  @HttpCode(202)
  ping(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.ping(user, id);
  }

  @Get(':id/deliveries')
  @Roles(...ADMINS)
  deliveries(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.deliveries(user, id);
  }
}
