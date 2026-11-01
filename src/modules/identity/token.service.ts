import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '../../common/auth';
import { ENV, type Env } from '../../config/env';
import type { Tx } from '../../database/database.service';

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Two kinds of token, on purpose:
 *  - access token: short-lived signed JWT, verified without touching the database;
 *  - refresh token: random opaque string, stored only as a SHA-256 hash, single-use (rotated on
 *    every refresh) and chained into a "family" so that reuse of a stolen token can be detected.
 * A database leak therefore yields no usable refresh tokens.
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
  ) {}

  signAccess(user: AuthUser): Promise<string> {
    return this.jwt.signAsync({ sub: user.userId, tid: user.tenantId, role: user.role });
  }

  get accessTtlSeconds(): number {
    return this.env.ACCESS_TOKEN_TTL_SECONDS;
  }

  async issueRefresh(
    tx: Tx,
    input: { tenantId: string; userId: string; familyId?: string },
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await tx.query(
      `INSERT INTO refresh_tokens (tenant_id, user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
      [
        input.tenantId,
        input.userId,
        input.familyId ?? randomUUID(),
        hashToken(token),
        this.env.REFRESH_TOKEN_TTL_SECONDS,
      ],
    );
    return token;
  }
}
