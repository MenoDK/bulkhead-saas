import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useApi, useSession } from '../lib/ApiContext';
import { ApiError, type Role } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { isAdmin } from '../lib/permissions';
import type { Member } from '../lib/types';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES } from '../theme/tokens';
import { Dialog } from '../ui/Dialog';
import { SkeletonRows } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { Badge, Button, ErrorState, errorMessage, SelectField, TextField } from '../ui/primitives';
import { useMembers } from './queries';

const REASONS: Record<string, string> = {
  LAST_OWNER: 'A workspace must keep at least one active owner.',
  ROLE_NOT_ASSIGNABLE: 'You cannot assign that role.',
  EMAIL_TAKEN: 'That e-mail already belongs to a member.',
};
const explain = (e: unknown): string => (e instanceof ApiError && REASONS[e.code]) || errorMessage(e);

/** Roles an actor may hand out: an admin cannot mint owners (the server enforces it; the UI just does not offer it). */
export const assignableRoles = (actor: Role): Role[] =>
  actor === 'owner' ? ['owner', 'admin', 'member', 'viewer'] : ['admin', 'member', 'viewer'];

export function TeamPage() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const session = useSession();
  const { niche } = useTheme();
  const v = THEMES[niche].vocabulary;
  const members = useMembers();
  const [adding, setAdding] = useState(false);
  const role = session?.tenant.role ?? 'viewer';
  const admin = isAdmin(role);

  const update = useMutation({
    mutationFn: ({ userId, patch }: { userId: string; patch: { role?: Role; active?: boolean } }) =>
      api.request<Member>(`/members/${userId}`, { method: 'PATCH', body: patch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['members'] }),
    onError: (e) => {
      toast.notify(explain(e), 'danger');
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">People who can sign in to this workspace.</p>
        </div>
        {admin && <Button onClick={() => setAdding(true)}>Add {v.member.toLowerCase()}</Button>}
      </header>
      <section className="card">
        {members.isPending ? (
          <SkeletonRows rows={4} columns={4} />
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Team members</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.data.map((m) => (
                  <tr key={m.userId}>
                    <td>
                      <strong>{m.name}</strong>
                      <div className="muted">{m.email}</div>
                    </td>
                    <td>
                      {admin && m.userId !== session?.user.id ? (
                        <select
                          className="input"
                          aria-label={`Role for ${m.name}`}
                          value={m.role}
                          onChange={(e) =>
                            update.mutate({ userId: m.userId, patch: { role: e.target.value as Role } })
                          }
                          style={{ minWidth: '7.5rem' }}
                        >
                          {[...new Set([m.role, ...assignableRoles(role)])].map((r) => (
                            <option key={r} value={r} disabled={!assignableRoles(role).includes(r)}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge tone="brand">{m.role}</Badge>
                      )}
                    </td>
                    <td>
                      {admin && m.userId !== session?.user.id ? (
                        <Button
                          variant="ghost"
                          small
                          onClick={() => update.mutate({ userId: m.userId, patch: { active: !m.active } })}
                        >
                          {m.active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      ) : (
                        <Badge tone={m.active ? 'success' : 'danger'}>
                          {m.active ? 'active' : 'inactive'}
                        </Badge>
                      )}
                    </td>
                    <td>{formatDateTime(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {adding && <AddMemberDialog actor={role} onClose={() => setAdding(false)} />}
    </>
  );
}

function AddMemberDialog({ actor, onClose }: { actor: Role; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' as Role });
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () =>
      api.request<Member>('/members', {
        method: 'POST',
        body: { ...form, email: form.email.trim(), name: form.name.trim() },
      }),
    onSuccess: () => {
      toast.notify('Member added', 'success');
      void qc.invalidateQueries({ queryKey: ['members'] });
      onClose();
    },
    onError: (e) => setError(explain(e)),
  });
  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!form.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      return setError('Enter a name and a valid e-mail.');
    if (form.password.length < 10) return setError('The temporary password needs at least 10 characters.');
    setError(null);
    add.mutate();
  }
  return (
    <Dialog title="Add a member" onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <TextField
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <TextField
          label="E-mail"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <TextField
          label="Temporary password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          hint="Share it through a secure channel; they should change it after signing in."
        />
        <SelectField
          label="Role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
        >
          {assignableRoles(actor).map((r) => (
            <option key={r}>{r}</option>
          ))}
        </SelectField>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
            {error}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={add.isPending}>
            Add member
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
