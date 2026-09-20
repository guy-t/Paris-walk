/**
 * Routes opened from elsewhere on the phone.
 *
 * In the Android shell, tapping a .gpx in Files or in a mail attachment and
 * choosing this app brings it here: MainActivity reads the file and queues
 * it, and this collects the queue. Nothing of the sort exists in a browser,
 * where the interface is simply absent and every call is an empty list.
 *
 * It is a pull rather than a push because of when intents arrive. A cold
 * start has the file waiting before any page exists, so there is nobody to
 * push to; a warm one arrives with the page already up, and fires an event.
 * Collecting on load and on the event covers both, and collecting is
 * destructive, so the same route cannot arrive twice.
 */

/** A file handed over by the shell. */
export interface OpenedFile {
  name: string;
  text: string;
}

interface FileHandover {
  take?: () => string;
}

function handover(): FileHandover | undefined {
  return (globalThis as { SlowNavFiles?: FileHandover }).SlowNavFiles;
}

/** Whatever is waiting, clearing it. Empty everywhere but the Android shell. */
export function takeOpenedFiles(): OpenedFile[] {
  try {
    const raw = handover()?.take?.();
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is OpenedFile =>
        typeof f === "object" && f !== null &&
        typeof (f as OpenedFile).name === "string" &&
        typeof (f as OpenedFile).text === "string",
    );
  } catch {
    // A shell that hands over something unreadable must not stop the app
    // from starting; the walker can still import through the picker.
    return [];
  }
}

/**
 * Call back whenever files are waiting: now, and on every later handover.
 *
 * Also on becoming visible again, because the app is resumed by the same tap
 * that delivers the intent and a missed event would strand the file in the
 * queue until the next launch.
 */
export function onOpenedFiles(deliver: (files: OpenedFile[]) => void): () => void {
  const pump = () => {
    const files = takeOpenedFiles();
    if (files.length) deliver(files);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") pump();
  };

  window.addEventListener("slownav:openedfiles", pump);
  document.addEventListener("visibilitychange", onVisible);
  pump();

  return () => {
    window.removeEventListener("slownav:openedfiles", pump);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
