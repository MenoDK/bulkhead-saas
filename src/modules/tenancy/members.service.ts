import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser, Role } from '../../common/auth';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../identity/password';

export interface MemberView {
  userId: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

interface MemberRow {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  created_at: Date;
}

const toView = (r: MemberRow): MemberView => ({
  userId: r.user_id,
  email: r.email,
  name: r.name,
  role: r.role,
  active: r.active,
  createdAt: r.created_at.toISOString(),
});

/** Which roles may `actor` hand out or change? Owners: any. Admins: only member/viewer. */
export function canAssign(actorRole: Role, target: Role): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return target === 'member' || target === 'viewer';
  return false;
}

@Injectable()
export class MembersService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<MemberView[]> {
    const { rows } = await this.db.query<MemberRow>(
      `SELECT m.user_id, u.email, u.name, m.role, m.active, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1 ORDER BY m.created_at, m.user_id`,
      [tenantId],
    );
    return rows.map(toView);
  }

  async add(
    actor: AuthUser,
    input: { email: string; name: string; password: string; role: Role },
  ): Promise<MemberView> {
    if (!canAssign(actor.role, input.role))
      throw forbidden('ROLE_NOT_ASSIGNABLE', `A ${actor.role} cannot create a ${input.role}`);
    const passwordHash = await hashPassword(input.password, this.env.PASSWORD_SCRYPT_LOG2_N);
    const userId = randomUUID();

    return this.db.withTenant(actor.tenantId, async (tx) => {
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
      const created = await tx.query<MemberRow>(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3) RETURNING user_id, $4::text AS email, $5::text AS name, role, active, created_at`,
        [actor.tenantId, userId, input.role, input.email, input.name],
      );
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        action: 'member.added',
        entityType: 'user',
        entityId: userId,
        metadata: { role: input.role },
      });
      return toView(created.rows[0] as MemberRow);
    });
  }

  async update(
    actor: AuthUser,
    targetId: string,
    change: { role?: Role; active?: boolean },
  ): Promise<MemberView> {
    return this.db.withTenant(actor.tenantId, async (tx) => {
      // Lock the tenant's membership rows: membership changes are rare, and serialising them is what
      // makes "never leave a workspace without an owner" safe against two simultaneous demotions.
      const all = await tx.query<{ user_id: string; role: Role; active: boolean }>(
        'SELECT user_id, role, active FROM memberships WHERE tenant_id = $1 FOR UPDATE',
        [actor.tenantId],
      );
      const target = all.rows.find((m) => m.user_id === targetId);
      if (!target) throw notFound('Member');

      const nextRole = change.role ?? target.role;
      const nextActive = change.active ?? target.active;
      if (!canAssign(actor.role, target.role) || !canAssign(actor.role, nextRole)) {
        throw forbidden('ROLE_NOT_ASSIGNABLE', `A ${actor.role} cannot change a ${target.role}`);
      }
      const owners = all.rows.filter((m) => m.role === 'owner' && m.active);
      const losesOwner = target.role === 'owner' && target.active && (nextRole !== 'owner' || !nextActive);
      if (losesOwner && owners.length <= 1)
        throw unprocessable('LAST_OWNER', 'A workspace must keep at least one active owner');

      await tx.query('UPDATE memberships SET role = $3, active = $4 WHERE tenant_id = $1 AND user_id = $2', [
        actor.tenantId,
        targetId,
        nextRole,
        nextActive,
      ]);
      if (!nextActive) {
        // A removed member must not keep working with a still-valid refresh token.
        await tx.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL',
          [actor.tenantId, targetId],
        );
      }
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        action: 'member.updated',
        entityType: 'user',
        entityId: targetId,
        metadata: {
          from: { role: target.role, active: target.active },
          to: { role: nextRole, active: nextActive },
        },
      });
      const row = await tx.query<MemberRow>(
        `SELECT m.user_id, u.email, u.name, m.role, m.active, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = $1 AND m.user_id = $2`,
        [actor.tenantId, targetId],
      );
      return toView(row.rows[0] as MemberRow);
    });
  }
}
