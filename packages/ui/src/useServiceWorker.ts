/**
 * Service-worker registration and the "new version is ready" prompt.
 *
 * The apps are cache-first, which is the only way they work on a mountain
 * with no signal — but it also means a walker can sit on a cached build for
 * weeks. This watches for a worker that has installed and is waiting, and
 * lets the app offer a reload.
 *
 * The reload is offered, never forced: reloading during a walk would lose the
 * open sheet and the scroll position for no reason the walker asked for. By
 * then the new version is already downloaded, so taking the offer is instant
 * even with no connection.
 */

import { useCallback, useEffect, useState } from "react";

export interface ServiceWorkerState {
  /** A new version has downloaded and is waiting to take over. */
  updateAvailable: boolean;
  /** Activate the waiting worker and reload. */
  applyUpdate: () => void;
  /** Registration failed or service workers are unavailable. */
  unsupported: boolean;
}

export function useServiceWorker(scriptUrl: string): ServiceWorkerState {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    // An empty url means the caller does not want one at all (the native
    // shell). file:// and plain http have no service workers either, and
    // that is fine — it only means no offline, not no app.
    if (!scriptUrl || !("serviceWorker" in navigator) || !window.isSecureContext) {
      setUnsupported(true);
      return;
    }

    let registration: ServiceWorkerRegistration | null = null;
    let cancelled = false;

    const track = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener("statechange", () => {
          // "installed" with an existing controller means an update, not a
          // first install — only then is there anything to tell the user.
          if (next.state === "installed" && navigator.serviceWorker.controller) {
            setWaiting(next);
          }
        });
      });
    };

    navigator.serviceWorker
      .register(scriptUrl, { type: "module" })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        track(reg);
      })
      .catch(() => setUnsupported(true));

    // The new worker took control: everything it serves is now the new build.
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Check for a new build when the app comes back to the screen, which is
    // the moment a walker is most likely to have signal again.
    const onVisibility = () => {
      if (!document.hidden) void registration?.update();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [scriptUrl]);

  const applyUpdate = useCallback(() => {
    // The worker calls skipWaiting, which fires controllerchange above.
    waiting?.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  return { updateAvailable: waiting != null, applyUpdate, unsupported };
}
