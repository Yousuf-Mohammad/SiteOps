'use client';

/**
 * A small in-app confirmation modal for lifecycle actions.
 *
 * Deliberately not `window.confirm` — a native dialog blocks the page, can't be
 * styled or matched to the action's colour, and is awkward to test. This renders
 * an overlay the caller controls: `open` toggles it, `tone` colours the confirm
 * button (green for submit/approve, red for reject).
 */
export type ConfirmTone = 'success' | 'danger';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  tone = 'success',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  tone?: ConfirmTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {message && <p className="muted" style={{ margin: 0 }}>{message}</p>}
        <div className="modal-actions">
          <button onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={tone} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
