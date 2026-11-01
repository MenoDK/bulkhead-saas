import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ANY_ROLE, type AuthedRequest, type AuthUser, CurrentUser, Public, Roles } from '../../common/auth';
import { clientIp } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { IdentityService } from './identity.service';
import {
  type LoginInput,
  loginSchema,
  type RegisterInput,
  refreshSchema,
  registerSchema,
} from './identity.schemas';

@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Post('register')
  register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Req() req: AuthedRequest) {
    return this.identity.register(body, clientIp(req));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: AuthedRequest) {
    return this.identity.login(body, clientIp(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }) {
    return this.identity.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }): Promise<void> {
    await this.identity.logout(body.refreshToken);
  }

  @Get('me')
  @Roles(...ANY_ROLE)
  me(@CurrentUser() user: AuthUser) {
    return this.identity.me(user);
  }
}
