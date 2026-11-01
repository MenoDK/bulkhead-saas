import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ApiError } from '../lib/api';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  small?: boolean;
  busy?: boolean;
};

export function Button({
  variant = 'primary',
  small,
  busy,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = ['btn', variant === 'primary' ? '' : variant, small ? 'small' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button {...rest} className={classes} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? 'Working…' : children}
    </button>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone?: 'success' | 'danger' | 'warning' | 'brand';
  children: ReactNode;
}) {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  );
}

interface FieldShell {
  label: string;
  hint?: string;
  error?: string | null;
}

/** Label, control, hint and error are wired together with ids so screen readers announce them with the input. */
function useFieldIds() {
  const id = useId();
  return { id, hintId: `${id}-hint`, errorId: `${id}-error` };
}

function describedBy(ids: { hintId: string; errorId: string }, shell: FieldShell): string | undefined {
  const parts = [shell.hint ? ids.hintId : '', shell.error ? ids.errorId : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

export function TextField({
  label,
  hint,
  error,
  ...rest
}: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const ids = useFieldIds();
  return (
    <div className="field">
      <label htmlFor={ids.id}>{label}</label>
      <input
        id={ids.id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, { label, hint, error })}
        {...rest}
      />
      {hint && (
        <span id={ids.hintId} className="hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={ids.errorId} className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...rest
}: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const ids = useFieldIds();
  return (
    <div className="field">
      <label htmlFor={ids.id}>{label}</label>
      <select
        id={ids.id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, { label, hint, error })}
        {...rest}
      >
        {children}
      </select>
      {hint && (
        <span id={ids.hintId} className="hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={ids.errorId} className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  ...rest
}: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ids = useFieldIds();
  return (
    <div className="field">
      <label htmlFor={ids.id}>{label}</label>
      <textarea
        id={ids.id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, { label, hint, error })}
        {...rest}
      />
      {hint && (
        <span id={ids.hintId} className="hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={ids.errorId} className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="card flat stack"
      style={{ textAlign: 'center', justifyItems: 'center', padding: '2.5rem 1rem' }}
    >
      <h2>{title}</h2>
      {children && (
        <p className="muted" style={{ maxWidth: '36ch' }}>
          {children}
        </p>
      )}
      {action}
    </div>
  );
}

/** Never shows internals: just the message the API chose to expose, plus the request id so support can find the log line. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return error.requestId ? `${error.message} (ref ${error.requestId})` : error.message;
  return 'Something went wrong. Check your connection and try again.';
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="card flat stack" role="alert">
      <h2>We could not load this</h2>
      <p className="muted">{errorMessage(error)}</p>
      {onRetry && (
        <div>
          <Button variant="ghost" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
