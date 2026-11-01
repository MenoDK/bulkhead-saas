import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type AuthedRequest, IS_PUBLIC, type Role, ROLES, ROLES_KEY } from './auth';
import { forbidden, unauthorized } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]))
      return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    try {
      // `algorithms` is pinned: never let the token choose how it is verified ("alg": "none" etc.).
      const claims = await this.jwt.verifyAsync<{ sub?: string; tid?: string; role?: string }>(token, {
        algorithms: ['HS256'],
      });
      if (
        !claims.sub ||
        !UUID.test(claims.sub) ||
        !claims.tid ||
        !UUID.test(claims.tid) ||
        !ROLES.includes(claims.role as Role)
      ) {
        throw new Error('bad claims');
      }
      request.user = { userId: claims.sub, tenantId: claims.tid, role: claims.role as Role };
      return true;
    } catch {
      throw unauthorized('INVALID_TOKEN', 'Invalid or expired token');
    }
  }
}

/** Deny by default: authenticated is not enough, the route must explicitly list the roles it accepts. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!allowed?.length) throw forbidden('NO_ACCESS_POLICY', 'This endpoint declares no access policy');
    if (!user || !allowed.includes(user.role)) throw forbidden();
    return true;
  }
}
