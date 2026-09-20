/**
 * Transient messages. One at a time, never blocking, never requiring a tap —
 * the walker's hands are busy and the phone may be in a pocket.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastState {
  message: string;
  /** Bumped on each new message so the same text shown twice still re-triggers. */
  nonce: number;
  ms: number;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nonce = useRef(0);
  const show = useCallback((message: string, ms = 2800) => {
    nonce.current += 1;
    setToast({ message, nonce: nonce.current, ms });
  }, []);
  return { toast, show, dismiss: useCallback(() => setToast(null), []) };
}

export interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onDismiss, toast.ms);
    return () => clearTimeout(id);
  }, [toast, onDismiss]);

  return (
    <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">
      {toast?.message ?? ""}
    </div>
  );
}

export interface UpdateToastProps {
  /** True once a new service worker is waiting to take over. */
  available: boolean;
  onReload: () => void;
}

/**
 * "A new version is ready."
 *
 * Deliberately not automatic: reloading out from under someone mid-walk would
 * lose their scroll position and their open sheet for no reason they asked
 * for. The new version is already downloaded, so the reload is instant
 * whenever they choose it — including with no signal.
 */
export function UpdateToast({ available, onReload }: UpdateToastProps) {
  if (!available) return null;
  return (
    <div className="toast update show" role="status">
      <span>A new version is ready.</span>
      <button onClick={onReload}>Reload</button>
    </div>
  );
}
