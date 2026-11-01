import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser, Role } from '../../common/auth';
import { conflict, forbidden, unauthorized } from '../../common/errors';
import { RateLimitService } from '../../common/rate-limit.service';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import type { LoginInput, Niche, RegisterInput } from './identity.schemas';
import { hashPassword, needsRehash, verifyPassword } from './password';
import { hashToken, TokenService } from './token.service';

const WINDOW_SECONDS = 15 * 60;

export interface TenantSummary {
  id: string;
  name: string;
  niche: Niche;
  plan: string;
  role: Role;
}

export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string };
  tenant: TenantSummary;
  tenants: TenantSummary[];
}

interface MembershipRow {
  tenant_id: string;
  role: Role;
  name: string;
  niche: Niche;
  plan: string;
}

const toSummary = (m: MembershipRow): TenantSummary => ({
  id: m.tenant_id,
  name: m.name,
  niche: m.niche,
  plan: m.plan,
  role: m.role,
});

@Injectable()
export class IdentityService {
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

  async register(input: RegisterInput, ip: string): Promise<SessionResponse> {
    await this.limits.hit(`register:ip:${ip}`, this.env.REGISTER_IP_LIMIT, 60 * 60);
    const passwordHash = await hashPassword(input.password, this.env.PASSWORD_SCRYPT_LOG2_N);
    const tenantId = randomUUID();
    const userId = randomUUID();

    const refreshToken = await this.db.withTenant(tenantId, async (tx) => {
      // The e-mail UNIQUE constraint is the arbiter (checking first would race); 23505 is mapped to 409 by the filter.
      await tx.query('INSERT INTO tenants (id, name, niche) VALUES ($1, $2, $3)', [
        tenantId,
        input.tenantName,
        input.niche,
      ]);
      try {
        await tx.query('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [
          userId,
          input.email,
          input.name,
          passwordHash,
        ]);
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw conflict('EMAIL_TAKEN', 'An account with this e-mail already exists');
        throw error;
      }
      await tx.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [
        tenantId,
        userId,
      ]);
      const token = await this.tokens.issueRefresh(tx, { tenantId, userId });
      await this.audit.record(tx, {
        tenantId,
        actorId: userId,
        action: 'tenant.created',
        entityType: 'tenant',
        entityId: tenantId,
        metadata: { niche: input.niche },
      });
      return token;
    });

    const tenant: TenantSummary = {
      id: tenantId,
      name: input.tenantName,
      niche: input.niche,
      plan: 'free',
      role: 'owner',
    };
    return this.session({ id: userId, email: input.email, name: input.name }, tenant, [tenant], refreshToken);
  }

  async login(input: LoginInput, ip: string): Promise<SessionResponse> {
    // Two limiters: (account + IP) stops guessing one account without letting a stranger lock the real owner out
    // from elsewhere; the IP-wide one stops spraying many accounts.
    await this.limits.hit(`login:ip:${ip}`, this.env.AUTH_IP_LIMIT, WINDOW_SECONDS);
    await this.limits.hit(`login:acct:${input.email}:${ip}`, this.env.AUTH_ACCOUNT_LIMIT, WINDOW_SECONDS);

    const found = await this.db.query<{
      id: string;
      email: string;
      name: string;
      password_hash: string;
      active: boolean;
    }>('SELECT id, email, name, password_hash, active FROM users WHERE email = $1', [input.email]);
    const user = found.rows[0];
    // Always spend the same scrypt time, whether or not the account exists: response time must not reveal which e-mails are registered.
    const verified = await verifyPassword(input.password, user?.password_hash ?? (await this.getDummyHash()));
    if (!user || !verified || !user.active)
      throw unauthorized('INVALID_CREDENTIALS', 'Invalid e-mail or password');

    const memberships = await this.memberships(user.id);
    if (memberships.length === 0)
      throw forbidden('NO_ACTIVE_MEMBERSHIP', 'This account has no active workspace');
    const chosen = input.tenantId ? memberships.find((m) => m.tenant_id === input.tenantId) : memberships[0];
    if (!chosen) throw unauthorized('INVALID_CREDENTIALS', 'Invalid e-mail or password');

    if (needsRehash(user.password_hash, this.env.PASSWORD_SCRYPT_LOG2_N)) {
      const upgraded = await hashPassword(input.password, this.env.PASSWORD_SCRYPT_LOG2_N);
      await this.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, upgraded]);
    }

    const refreshToken = await this.db.withTenant(chosen.tenant_id, async (tx) => {
      const token = await this.tokens.issueRefresh(tx, { tenantId: chosen.tenant_id, userId: user.id });
      await this.audit.record(tx, {
        tenantId: chosen.tenant_id,
        actorId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        metadata: { ip },
      });
      return token;
    });
    return this.session(
      { id: user.id, email: user.email, name: user.name },
      toSummary(chosen),
      memberships.map(toSummary),
      refreshToken,
    );
  }

  /**
   * Rotation, in one transaction: lock the presented token's row, mark it used, issue its successor
   * in the same family. Two concurrent refreshes of the same token cannot both succeed — the loser
   * sees `revoked_at` set, which is indistinguishable from replay of a stolen token, so the whole
   * family is revoked (RFC 6819 / OAuth 2.0 Security BCP "refresh token reuse detection").
   */
  async refresh(presented: string): Promise<SessionResponse> {
    type Outcome =
      | { kind: 'ok'; tenantId: string; userId: string; role: Role; next: string }
      | { kind: 'reuse'; tenantId: string; userId: string }
      | { kind: 'invalid' };

    const outcome = await this.db.tx<Outcome>(async (tx) => {
      const found = await tx.query<{
        id: string;
        tenant_id: string;
        user_id: string;
        family_id: string;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        'SELECT id, tenant_id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [hashToken(presented)],
      );
      const row = found.rows[0];
      if (!row) return { kind: 'invalid' };
      const revokeFamily = () =>
        tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [
          row.family_id,
        ]);

      if (row.revoked_at) {
        await revokeFamily();
        return { kind: 'reuse', tenantId: row.tenant_id, userId: row.user_id };
      }
      if (row.expires_at.getTime() <= Date.now()) return { kind: 'invalid' };

      const member = await tx.query<{ role: Role }>(
        `SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.active AND u.active`,
        [row.tenant_id, row.user_id],
      );
      const role = member.rows[0]?.role;
      if (!role) {
        await revokeFamily();
        return { kind: 'invalid' };
      }
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
      const next = await this.tokens.issueRefresh(tx, {
        tenantId: row.tenant_id,
        userId: row.user_id,
        familyId: row.family_id,
      });
      return { kind: 'ok', tenantId: row.tenant_id, userId: row.user_id, role, next };
    });

    if (outcome.kind === 'reuse') {
      await this.db.withTenant(outcome.tenantId, (tx) =>
        this.audit.record(tx, {
          tenantId: outcome.tenantId,
          actorId: outcome.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'user',
          entityId: outcome.userId,
        }),
      );
    }
    if (outcome.kind !== 'ok')
      throw unauthorized('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');

    const me = await this.me({ userId: outcome.userId, tenantId: outcome.tenantId, role: outcome.role });
    return { ...(await this.session(me.user, me.tenant, me.tenants, outcome.next)) };
  }

  /** Idempotent and silent: logging out a token that does not exist is not an error and reveals nothing. */
  async logout(presented: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE revoked_at IS NULL AND family_id IN (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
      [hashToken(presented)],
    );
  }

  async me(auth: AuthUser): Promise<{
    user: { id: string; email: string; name: string };
    tenant: TenantSummary;
    tenants: TenantSummary[];
  }> {
    const u = await this.db.query<{ id: string; email: string; name: string }>(
      'SELECT id, email, name FROM users WHERE id = $1 AND active',
      [auth.userId],
    );
    const user = u.rows[0];
    const memberships = await this.memberships(auth.userId);
    const current = memberships.find((m) => m.tenant_id === auth.tenantId);
    if (!user || !current) throw unauthorized('INVALID_TOKEN', 'Session is no longer valid');
    return { user, tenant: toSummary(current), tenants: memberships.map(toSummary) };
  }

  private async memberships(userId: string): Promise<MembershipRow[]> {
    const { rows } = await this.db.query<MembershipRow>(
      `SELECT m.tenant_id, m.role, t.name, t.niche, t.plan
         FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 AND m.active ORDER BY m.created_at, m.tenant_id`,
      [userId],
    );
    return rows;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('not-a-real-password', this.env.PASSWORD_SCRYPT_LOG2_N);
    return this.dummyHash;
  }

  private async session(
    user: { id: string; email: string; name: string },
    tenant: TenantSummary,
    tenants: TenantSummary[],
    refreshToken: string,
  ): Promise<SessionResponse> {
    const accessToken = await this.tokens.signAccess({
      userId: user.id,
      tenantId: tenant.id,
      role: tenant.role,
    });
    return { accessToken, refreshToken, expiresIn: this.tokens.accessTtlSeconds, user, tenant, tenants };
  }
}
