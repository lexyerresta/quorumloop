import { useEffect, useId, useRef, type ReactNode } from 'react';
import { describeError, isApiError } from '../api/client';
import type { Tone } from '../lib/domain';

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

/** Page title block. The round rule under it is the identity motif and appears once per screen. */
export function PageHead({
  title,
  sub,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {sub ? <p className="sub">{sub}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
      <div className="round-rule" aria-hidden="true" />
    </>
  );
}

/** Skeleton rows shaped like the final rows, announced to assistive technology by `label`. */
export function LoadingRows({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div className="table-wrap" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index} />
      ))}
    </div>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  what,
  onRetry,
}: {
  error: unknown;
  what: string;
  onRetry?: () => void;
}) {
  const correlation = isApiError(error) ? error.correlationId : null;
  const denied = isApiError(error) && (error.status === 403 || error.code === 'POLICY_DENIED');
  return (
    <div className="state state-error" role="alert">
      <p>
        <strong>{denied ? `You do not have access to ${what}.` : `Could not load ${what}.`}</strong>{' '}
        {describeError(error)}
      </p>
      {correlation ? <p className="correlation">Correlation id {correlation}</p> : null}
      {onRetry && !denied ? (
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Inline form error with the server's reason. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const correlation = isApiError(error) ? error.correlationId : null;
  return (
    <div className="form-error" role="alert">
      {describeError(error)}
      {correlation ? <span className="mono muted"> ({correlation})</span> : null}
    </div>
  );
}

/**
 * Native modal dialog: the browser provides the focus trap, Escape to close and focus return.
 * Rendered only while open so its form state resets between uses.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="sheet-head">
        <h2 id={headingId}>{title}</h2>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="sheet-body">{children}</div>
      {footer ? <div className="sheet-foot">{footer}</div> : null}
    </dialog>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <span className="field-error" id={`${htmlFor}-error`}>
          {error}
        </span>
      ) : hint ? (
        <span className="hint" id={`${htmlFor}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
